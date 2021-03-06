// Copyright (C) 2016 The Android Open Source Project
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
(function() {
  'use strict';

  var COMMIT_MESSAGE_PATH = '/COMMIT_MSG';

  Polymer({
    is: 'gr-file-list',

    properties: {
      patchRange: {
        type: Object,
        observer: '_updateSelected',
      },
      patchNum: String,
      changeNum: String,
      comments: Object,
      drafts: Object,
      revisions: Object,
      projectConfig: Object,
      selectedIndex: {
        type: Number,
        notify: true,
      },
      keyEventTarget: {
        type: Object,
        value: function() { return document.body; },
      },
      change: Object,
      diffViewMode: {
        type: String,
        notify: true,
      },
      _files: {
        type: Array,
        observer: '_filesChanged',
        value: function() { return []; },
      },
      _loggedIn: {
        type: Boolean,
        value: false,
      },
      _reviewed: {
        type: Array,
        value: function() { return []; },
      },
      _diffAgainst: String,
      _diffPrefs: Object,
      _userPrefs: Object,
      _localPrefs: Object,
      _showInlineDiffs: Boolean,
      _numFilesShown: {
        type: Number,
        value: 75,
      },
      _patchChange: {
        type: Object,
        computed: '_calculatePatchChange(_files)',
      },
      _fileListIncrement: {
        type: Number,
        readOnly: true,
        value: 75,
      },
      _hideChangeTotals: {
        type: Boolean,
        computed: '_shouldHideChangeTotals(_patchChange)',
      },
      _hideBinaryChangeTotals: {
        type: Boolean,
        computed: '_shouldHideBinaryChangeTotals(_patchChange)',
      },
      _shownFiles: {
        type: Array,
        computed: '_computeFilesShown(_numFilesShown, _files.*)',
      },
      // Caps the number of files that can be shown and have the 'show diffs' /
      // 'hide diffs' buttons still be functional.
      _maxFilesForBulkActions: {
        type: Number,
        readOnly: true,
        value: 225,
      },
    },

    behaviors: [
      Gerrit.KeyboardShortcutBehavior,
      Gerrit.PatchSetBehavior,
      Gerrit.URLEncodingBehavior,
    ],

    keyBindings: {
      'shift+left': '_handleShiftLeftKey',
      'shift+right': '_handleShiftRightKey',
      'i': '_handleIKey',
      'shift+i': '_handleCapitalIKey',
      'down j': '_handleDownKey',
      'up k': '_handleUpKey',
      'c': '_handleCKey',
      '[': '_handleLeftBracketKey',
      ']': '_handleRightBracketKey',
      'o enter': '_handleEnterKey',
      'n': '_handleNKey',
      'p': '_handlePKey',
      'shift+a': '_handleCapitalAKey',
    },

    reload: function() {
      if (!this.changeNum || !this.patchRange.patchNum) {
        return Promise.resolve();
      }
      this._collapseAllDiffs();
      var promises = [];
      var _this = this;

      promises.push(this._getFiles().then(function(files) {
        _this._files = files;
      }));
      promises.push(this._getLoggedIn().then(function(loggedIn) {
        return _this._loggedIn = loggedIn;
      }).then(function(loggedIn) {
        if (!loggedIn) { return; }

        return _this._getReviewedFiles().then(function(reviewed) {
          _this._reviewed = reviewed;
        });
      }));

      this._localPrefs = this.$.storage.getPreferences();
      promises.push(this._getDiffPreferences().then(function(prefs) {
        this._diffPrefs = prefs;
      }.bind(this)));

      promises.push(this._getPreferences().then(function(prefs) {
        this._userPrefs = prefs;
        if (!this.diffViewMode) {
          this.set('diffViewMode', prefs.default_diff_view);
        }
      }.bind(this)));
    },

    get diffs() {
      return Polymer.dom(this.root).querySelectorAll('gr-diff');
    },

    _calculatePatchChange: function(files) {
      var filesNoCommitMsg = files.filter(function(files) {
        return files.__path !== '/COMMIT_MSG';
      });

      return filesNoCommitMsg.reduce(function(acc, obj) {
        var inserted = obj.lines_inserted ? obj.lines_inserted : 0;
        var deleted = obj.lines_deleted ? obj.lines_deleted : 0;
        var total_size = (obj.size && obj.binary) ? obj.size : 0;
        var size_delta_inserted =
            obj.binary && obj.size_delta > 0 ? obj.size_delta : 0;
        var size_delta_deleted =
            obj.binary && obj.size_delta < 0 ? obj.size_delta : 0;

        return {
          inserted: acc.inserted + inserted,
          deleted: acc.deleted + deleted,
          size_delta_inserted: acc.size_delta_inserted + size_delta_inserted,
          size_delta_deleted: acc.size_delta_deleted + size_delta_deleted,
          total_size: acc.total_size + total_size,
        };
      }, {inserted: 0, deleted: 0, size_delta_inserted: 0,
        size_delta_deleted: 0, total_size: 0});
    },

    _getDiffPreferences: function() {
      return this.$.restAPI.getDiffPreferences();
    },

    _getPreferences: function() {
      return this.$.restAPI.getPreferences();
    },

    _computePatchSets: function(revisionRecord) {
      var revisions = revisionRecord.base;
      var patchNums = [];
      for (var commit in revisions) {
        if (revisions.hasOwnProperty(commit)) {
          patchNums.push({
            num: revisions[commit]._number,
            desc: revisions[commit].description,
          });
        }
      }
      return patchNums.sort(function(a, b) { return a.num - b.num; });
    },

    _computePatchSetDisabled: function(patchNum, currentPatchNum) {
      return parseInt(patchNum, 10) >= parseInt(currentPatchNum, 10);
    },

    _handleHiddenChange: function(e) {
      var model = e.model;
      model.set('file.__expanded', !model.file.__expanded);
    },

    _handlePatchChange: function(e) {
      var patchRange = Object.assign({}, this.patchRange);
      patchRange.basePatchNum = Polymer.dom(e).rootTarget.value;
      page.show(this.encodeURL('/c/' + this.changeNum + '/' +
          this._patchRangeStr(patchRange), true));
    },

    _forEachDiff: function(fn) {
      var diffs = this.diffs;
      for (var i = 0; i < diffs.length; i++) {
        fn(diffs[i]);
      }
    },

    /**
     * Until upgrading to Polymer 2.0, manual management of reflection between
     * _shownFiles and _files is necessary. Performance of linkPaths is very
     * poor.
     */
    _expandAllDiffs: function(e) {
      this._showInlineDiffs = true;
      for (var i = 0; i < this._shownFiles.length; i++) {
        this.set(['_shownFiles', i, '__expanded'], true);
        this.set(['_files', i, '__expanded'], true);
      }
    },

    _collapseAllDiffs: function(e) {
      this._showInlineDiffs = false;
      for (var i = 0; i < this._shownFiles.length; i++) {
        this.set(['_shownFiles', i, '__expanded'], false);
        this.set(['_files', i, '__expanded'], false);
      }
      this.$.diffCursor.handleDiffUpdate();
    },

    _computeCommentsString: function(comments, patchNum, path) {
      return this._computeCountString(comments, patchNum, path, 'comment');
    },

    _computeDraftsString: function(drafts, patchNum, path) {
      return this._computeCountString(drafts, patchNum, path, 'draft');
    },

    _computeCountString: function(comments, patchNum, path, noun) {
      if (!comments) { return ''; }

      var patchComments = (comments[path] || []).filter(function(c) {
        return parseInt(c.patch_set, 10) === parseInt(patchNum, 10);
      });
      var num = patchComments.length;
      if (num === 0) { return ''; }
      return num + ' ' + noun + (num > 1 ? 's' : '');
    },

    _computeReviewed: function(file, _reviewed) {
      return _reviewed.indexOf(file.__path) !== -1;
    },

    _handleReviewedChange: function(e) {
      var path = Polymer.dom(e).rootTarget.getAttribute('data-path');
      var index = this._reviewed.indexOf(path);
      var reviewed = index !== -1;
      if (reviewed) {
        this.splice('_reviewed', index, 1);
      } else {
        this.push('_reviewed', path);
      }

      this._saveReviewedState(path, !reviewed).catch(function(err) {
        alert('Couldn’t change file review status. Check the console ' +
            'and contact the PolyGerrit team for assistance.');
        throw err;
      }.bind(this));
    },

    _saveReviewedState: function(path, reviewed) {
      return this.$.restAPI.saveFileReviewed(this.changeNum,
          this.patchRange.patchNum, path, reviewed);
    },

    _getLoggedIn: function() {
      return this.$.restAPI.getLoggedIn();
    },

    _getReviewedFiles: function() {
      return this.$.restAPI.getReviewedFiles(this.changeNum,
          this.patchRange.patchNum);
    },

    _getFiles: function() {
      return this.$.restAPI.getChangeFilesAsSpeciallySortedArray(
          this.changeNum, this.patchRange).then(function(files) {
            // Append UI-specific properties.
            return files.map(function(file) {
              file.__expanded = false;
              return file;
            });
          });
    },

    _handleShiftLeftKey: function(e) {
      if (this.shouldSuppressKeyboardShortcut(e)) { return; }
      if (!this._showInlineDiffs) { return; }

      e.preventDefault();
      this.$.diffCursor.moveLeft();
    },

    _handleShiftRightKey: function(e) {
      if (this.shouldSuppressKeyboardShortcut(e)) { return; }
      if (!this._showInlineDiffs) { return; }

      e.preventDefault();
      this.$.diffCursor.moveRight();
    },

    _handleIKey: function(e) {
      if (this.shouldSuppressKeyboardShortcut(e) ||
          this.modifierPressed(e) ||
          this.$.fileCursor.index === -1) { return; }

      e.preventDefault();
      var expanded = this._files[this.$.fileCursor.index].__expanded;
      // Until Polymer 2.0, manual management of reflection between _files
      // and _shownFiles is necessary.
      this.set(['_shownFiles', this.$.fileCursor.index, '__expanded'],
          !expanded);
      this.set(['_files', this.$.fileCursor.index, '__expanded'], !expanded);
    },

    _handleCapitalIKey: function(e) {
      if (this.shouldSuppressKeyboardShortcut(e)) { return; }

      e.preventDefault();
      this._toggleInlineDiffs();
    },

    _handleDownKey: function(e) {
      if (this.shouldSuppressKeyboardShortcut(e)) { return; }
      e.preventDefault();
      if (this._showInlineDiffs) {
        this.$.diffCursor.moveDown();
      } else {
        this.$.fileCursor.next();
        this.selectedIndex = this.$.fileCursor.index;
      }
    },

    _handleUpKey: function(e) {
      if (this.shouldSuppressKeyboardShortcut(e)) { return; }

      e.preventDefault();
      if (this._showInlineDiffs) {
        this.$.diffCursor.moveUp();
      } else {
        this.$.fileCursor.previous();
        this.selectedIndex = this.$.fileCursor.index;
      }
    },

    _handleCKey: function(e) {
      if (this.shouldSuppressKeyboardShortcut(e) ||
          this.modifierPressed(e)) { return; }

      var isRangeSelected = this.diffs.some(function(diff) {
        return diff.isRangeSelected();
      }, this);
      if (this._showInlineDiffs && !isRangeSelected) {
        e.preventDefault();
        this._addDraftAtTarget();
      }
    },

    _handleLeftBracketKey: function(e) {
      if (this.shouldSuppressKeyboardShortcut(e) ||
          this.modifierPressed(e)) { return; }

      e.preventDefault();
      this._openSelectedFile(this._files.length - 1);
    },

    _handleRightBracketKey: function(e) {
      if (this.shouldSuppressKeyboardShortcut(e) ||
          this.modifierPressed(e)) { return; }

      e.preventDefault();
      this._openSelectedFile(0);
    },

    _handleEnterKey: function(e) {
      if (this.shouldSuppressKeyboardShortcut(e) ||
          this.modifierPressed(e)) { return; }

      e.preventDefault();
      if (this._showInlineDiffs) {
        this._openCursorFile();
      } else {
        this._openSelectedFile();
      }
    },

    _handleNKey: function(e) {
      if (this.shouldSuppressKeyboardShortcut(e) ||
          this.modifierPressed(e)) { return; }
      if (!this._showInlineDiffs) { return; }

      e.preventDefault();
      if (e.shiftKey) {
        this.$.diffCursor.moveToNextCommentThread();
      } else {
        this.$.diffCursor.moveToNextChunk();
      }
    },

    _handlePKey: function(e) {
      if (this.shouldSuppressKeyboardShortcut(e) ||
          this.modifierPressed(e)) { return; }
      if (!this._showInlineDiffs) { return; }

      e.preventDefault();
      if (e.shiftKey) {
        this.$.diffCursor.moveToPreviousCommentThread();
      } else {
        this.$.diffCursor.moveToPreviousChunk();
      }
    },

    _handleCapitalAKey: function(e) {
      if (this.shouldSuppressKeyboardShortcut(e)) { return; }

      e.preventDefault();
      this._forEachDiff(function(diff) {
        diff.toggleLeftDiff();
      });
    },

    _toggleInlineDiffs: function() {
      if (this._showInlineDiffs) {
        this._collapseAllDiffs();
      } else {
        this._expandAllDiffs();
      }
    },

    _openCursorFile: function() {
      var diff = this.$.diffCursor.getTargetDiffElement();
      page.show(this._computeDiffURL(diff.changeNum, diff.patchRange,
          diff.path));
    },

    _openSelectedFile: function(opt_index) {
      if (opt_index != null) {
        this.$.fileCursor.setCursorAtIndex(opt_index);
      }
      page.show(this._computeDiffURL(this.changeNum, this.patchRange,
          this._files[this.$.fileCursor.index].__path));
    },

    _addDraftAtTarget: function() {
      var diff = this.$.diffCursor.getTargetDiffElement();
      var target = this.$.diffCursor.getTargetLineElement();
      if (diff && target) {
        diff.addDraftAtLine(target);
      }
    },

    _shouldHideChangeTotals: function(_patchChange) {
      return _patchChange.inserted === 0 && _patchChange.deleted === 0;
    },

    _shouldHideBinaryChangeTotals: function(_patchChange) {
      return _patchChange.size_delta_inserted === 0 &&
          _patchChange.size_delta_deleted === 0;
    },

    _computeFileStatus: function(status) {
      return status || 'M';
    },

    _computeDiffURL: function(changeNum, patchRange, path) {
      return this.encodeURL('/c/' + changeNum + '/' +
          this._patchRangeStr(patchRange) + '/' + path, true);
    },

    _patchRangeStr: function(patchRange) {
      return patchRange.basePatchNum !== 'PARENT' ?
          patchRange.basePatchNum + '..' + patchRange.patchNum :
          patchRange.patchNum + '';
    },

    _computeFileDisplayName: function(path) {
      return path === COMMIT_MESSAGE_PATH ? 'Commit message' : path;
    },

    _computeTruncatedFileDisplayName: function(path) {
      return path === COMMIT_MESSAGE_PATH ?
          'Commit message' : util.truncatePath(path);
    },

    _formatBytes: function(bytes) {
      if (bytes == 0) return '+/-0 B';
      var bits = 1024;
      var decimals = 1;
      var sizes = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
      var exponent = Math.floor(Math.log(Math.abs(bytes)) / Math.log(bits));
      var prepend = bytes > 0 ? '+' : '';
      return prepend + parseFloat((bytes / Math.pow(bits, exponent))
          .toFixed(decimals)) + ' ' + sizes[exponent];
    },

    _formatPercentage: function(size, delta) {
      var oldSize = size - delta;

      if (oldSize === 0) { return ''; }

      var percentage = Math.round(Math.abs(delta * 100 / oldSize));
      return '(' + (delta > 0 ? '+' : '-') + percentage + '%)';
    },

    _computeBinaryClass: function(delta) {
      if (delta === 0) { return; }
      return delta >= 0 ? 'added' : 'removed';
    },

    _computeClass: function(baseClass, path) {
      var classes = [baseClass];
      if (path === COMMIT_MESSAGE_PATH) {
        classes.push('invisible');
      }
      return classes.join(' ');
    },

    _computePathClass: function(expanded) {
      return expanded ? 'path expanded' : 'path';
    },

    _computeShowHideText: function(expanded) {
      return expanded ? '▼' : '◀';
    },

    _computeFilesShown: function(numFilesShown, files) {
      return files.base.slice(0, numFilesShown);
    },

    _filesChanged: function() {
      this.async(function() {
        var diffElements = Polymer.dom(this.root).querySelectorAll('gr-diff');

        // Overwrite the cursor's list of diffs:
        this.$.diffCursor.splice.apply(this.$.diffCursor,
            ['diffs', 0, this.$.diffCursor.diffs.length].concat(diffElements));

        var files = Polymer.dom(this.root).querySelectorAll('.file-row');
        this.$.fileCursor.stops = files;
        this.$.fileCursor.setCursorAtIndex(this.selectedIndex);
      }.bind(this), 1);
    },

    _incrementNumFilesShown: function() {
      this._numFilesShown += this._fileListIncrement;
    },

    _computeFileListButtonHidden: function(numFilesShown, files) {
      return numFilesShown >= files.length;
    },

    _computeIncrementText: function(numFilesShown, files) {
      if (!files) { return ''; }
      var text =
          Math.min(this._fileListIncrement, files.length - numFilesShown);
      return 'Show ' + text + ' more';
    },

    _computeShowAllText: function(files) {
      if (!files) { return ''; }
      return 'Show all ' + files.length + ' files';
    },

    _showAllFiles: function() {
      this._numFilesShown = this._files.length;
    },

    _updateSelected: function(patchRange) {
      this._diffAgainst = patchRange.basePatchNum;
    },

    /**
     * _getDiffViewMode: Get the diff view (side-by-side or unified) based on
     * the current state.
     *
     * The expected behavior is to use the mode specified in the user's
     * preferences unless they have manually chosen the alternative view.
     *
     * Use side-by-side if there is no view mode or preferences.
     *
     * @return {String}
     */
    _getDiffViewMode: function(diffViewMode, userPrefs) {
      if (diffViewMode) {
        return diffViewMode;
      } else if (userPrefs) {
        return this.diffViewMode = userPrefs.default_diff_view;
      }
      return 'SIDE_BY_SIDE';
    },

    _fileListActionsVisible: function(numFilesShown, maxFilesForBulkActions) {
      return numFilesShown <= maxFilesForBulkActions;
    },

    _computePatchSetDescription: function(revisions, patchNum) {
      var rev = this.getRevisionByPatchNum(revisions, patchNum);
      return (rev && rev.description) ? rev.description : '';
    },
  });
})();
