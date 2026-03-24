const { Plugin } = require("obsidian");

module.exports = class DisableTableAutopaddingPlugin extends Plugin {
  SAFE_GETTER_KEYS = new Set([
    "activeEditor",
    "activeLeaf",
    "cm",
    "containerEl",
    "editMode",
    "editor",
    "leaf",
    "mode",
    "parent",
    "previewMode",
    "view",
  ]);

  patch = null;
  intervalId = null;

  findTableWidgetPrototype(obj) {
    // Walk prototypes until we find the object that defines the full table API (not an instance).
    for (let cursor = obj; cursor && cursor !== Object.prototype; cursor = Object.getPrototypeOf(cursor)) {
      if (!Object.prototype.hasOwnProperty.call(cursor, "setCellFocus")) continue;

      if (
        typeof cursor.setCellFocus === "function" &&
        typeof cursor.dispatchTable === "function" &&
        typeof cursor.rebuildTable === "function" &&
        typeof cursor.receiveCellFocus === "function" &&
        typeof cursor.updateCell === "function" &&
        typeof cursor.getTableString === "function" &&
        typeof cursor.makeAlignmentRow === "function"
      ) {
        return cursor;
      }
    }

    return null;
  }

  enqueueEditorSurfaces(editor, enqueue) {
    // Queue the editor object and nested surfaces that may hold table widgets.
    if (!editor || typeof editor !== "object") return;

    enqueue(editor);

    for (const key of ["cm", "tableCell", "content", "view"]) {
      try {
        enqueue(editor[key]);
      } catch {
        /* ignore */
      }
    }
  }

  discoverTablePrototype(app, maxSteps = 20000) {
    const visited = new WeakSet();
    const queue = [];

    // Breadth-first enqueue: only objects/functions, skip duplicates.
    function enqueue(value) {
      const valueType = typeof value;
      
      if (value == null) return;
      if (valueType !== "object" && valueType !== "function") return;
      if (visited.has(value)) return;

      visited.add(value);
      queue.push(value);
    }

    // Seed from app, workspace, open markdown leaves, and editor surfaces.
    try {
      const workspace = app.workspace;

      enqueue(app);
      enqueue(workspace);
      enqueue(workspace.activeLeaf);
      enqueue(workspace.activeEditor);

      try {
        this.enqueueEditorSurfaces(workspace.activeEditor?.editor, enqueue);
      } catch {
        /* ignore */
      }

      for (const leaf of workspace.getLeavesOfType("markdown")) {
        enqueue(leaf);
        enqueue(leaf.view);

        try {
          enqueue(leaf.view?.editMode);
          enqueue(leaf.view?.previewMode);

          this.enqueueEditorSurfaces(leaf.view?.editor, enqueue);
        } catch {
          /* ignore */
        }
      }

      try {
        this.enqueueEditorSurfaces(workspace.activeLeaf?.view?.editor, enqueue);
      } catch {
        /* ignore */
      }
    } catch {
      /* ignore */
    }

    let steps = 0;
    while (queue.length && steps++ < maxSteps) {
      const current = queue.shift();
      
      // First object in the graph that matches the table widget prototype wins.
      const tableProto = this.findTableWidgetPrototype(current);
      if (tableProto) {
        return tableProto;
      }

      // Expand own properties; invoke whitelisted getters only (avoids side effects).
      let keys;
      try {
        keys = Reflect.ownKeys(current);
      } catch {
        continue;
      }

      for (const key of keys) {
        if (typeof key === "symbol") continue;
        
        let descriptor;
        
        try {
          descriptor = Object.getOwnPropertyDescriptor(current, key);
        } catch {
          continue;
        }
        
        if (!descriptor) continue;

        if (typeof descriptor.get === "function") {
          if (this.SAFE_GETTER_KEYS.has(String(key))) {
            try {
              enqueue(descriptor.get.call(current));
            } catch {
              /* ignore */
            }
          }

          continue;
        }

        const value = descriptor.value;
        if (value == null) continue;

        // Cap array traversal so huge arrays do not dominate the search budget.
        if (Array.isArray(value)) {
          const cap = Math.min(value.length, 64);
          
          for (let index = 0; index < cap; index++) {
            enqueue(value[index]);
          }

          continue;
        }

        if (typeof value === "object") enqueue(value);
      }
    }

    return null;
  }

  minimalUpdateCell(cell, newText) {
    // Compute CM change range from current cell span and padding.
    const oldLen = cell.text.length;
    const from = cell.start + cell.padStart;
    const to = cell.start + cell.padStart + oldLen;
    const delta = newText.length - oldLen;

    cell.text = newText;
    cell.dirty = true;

    // If length changed, shift start/end for every cell after the edited one in document order.
    if (delta !== 0) {
      let passedEditedCell = false;
      const rows = this.rows;

      for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        const row = rows[rowIndex];

        for (let colIndex = 0; colIndex < row.length; colIndex++) {
          const rowCell = row[colIndex];

          if (passedEditedCell) {
            rowCell.start += delta;
            rowCell.end += delta;
          }

          passedEditedCell = passedEditedCell || (rowCell === cell);
        }
      }
    }

    cell.end += delta;
    return [{ from, to, insert: newText }];
  }

  preservingGetTableString(bounds) {
    // Clamp selection to valid row/column ranges, then emit pipe-separated rows.
    const selection = this.validateSelectionBounds(bounds);
    const minRow = selection.minRow;
    const maxRow = selection.maxRow;
    const minCol = selection.minCol;
    const maxCol = selection.maxCol;
    const rows = this.rows;
    
    let markdown = "";

    for (let rowIndex = minRow; rowIndex <= maxRow; rowIndex++) {
      const rowCells = rows[rowIndex];

      for (let colIndex = minCol; colIndex <= maxCol; colIndex++) {
        const cell = rowCells[colIndex];
        markdown += "|" + cell.getTextWithPadding();
      }

      markdown += "|";

      if (rowIndex === minRow) markdown += "\n" + this.makeAlignmentRow(minCol, maxCol);
      if (rowIndex !== maxRow) markdown += "\n";
    }

    return markdown;
  }

  preservingMakeAlignmentRow(fromCol, toCol) {
    const MIN_COL_RENDER_WIDTH = 5;
    const alignments = this.alignments;
    let alignmentRow = "";

    // One markdown alignment segment per column, matching Obsidian’s column width rules.
    for (let col = fromCol; col <= toCol; col++) {
      switch (alignments[col]) {
        case "left":
          alignmentRow +=
            "| :" +
            "-".repeat(Math.max(1, MIN_COL_RENDER_WIDTH - 3)) +
            " ";
          break;
        case "center":
          alignmentRow +=
            "| :" +
            "-".repeat(Math.max(1, MIN_COL_RENDER_WIDTH - 4)) +
            ": ";
          break;
        case "right":
          alignmentRow +=
            "| " +
            "-".repeat(Math.max(1, MIN_COL_RENDER_WIDTH - 3)) +
            ": ";
          break;
        default:
          alignmentRow +=
            "| " +
            "-".repeat(Math.max(1, MIN_COL_RENDER_WIDTH - 2)) +
            " ";
      }
    }

    return alignmentRow + "|";
  }

  preservingRebuildTable() {
    const tableWidget = this;
    const editor = tableWidget.editor;
    const rows = tableWidget.rows;
    const alignments = tableWidget.alignments;
    
    // Build full-table markdown through preservingGetTableString (not stock getTableString).
    const markdownText = DisableTableAutopaddingPlugin.prototype.preservingGetTableString.call(
      tableWidget,
      {
        minRow: 0,
        maxRow: rows.length - 1,
        minCol: 0,
        maxCol: alignments.length - 1,
      }
    );

    // Push text into the CodeMirror doc and re-render the table widget if non-empty.
    const cm = editor.cm;
    const doc = (tableWidget.doc = cm.state.toText(markdownText));
    if (markdownText) this.render();
    
    return doc;
  }

  onload() {
    const run = () => this.applyTablePatches();

    run();
    this.registerEvent(this.app.workspace.on("active-leaf-change", run));
    this.registerEvent(this.app.workspace.on("layout-change", run));
    this.registerEvent(this.app.workspace.on("file-open", run));

    // Retry until the table prototype appears; then stop polling after a fixed window.
    this.intervalId = window.setInterval(run, 1500);
    window.setTimeout(() => {
      if (this.intervalId != null) {
        window.clearInterval(this.intervalId);
        this.intervalId = null;
      }
    }, 120000);
  }

  applyTablePatches() {
    if (this.patch) return;

    // Locate Obsidian’s table widget prototype once; swap in preserving implementations.
    const proto = this.discoverTablePrototype(this.app);
    if (!proto) return;

    const originals = {
      setCellFocus: proto.setCellFocus,
      updateCell: proto.updateCell,
      getTableString: proto.getTableString,
      makeAlignmentRow: proto.makeAlignmentRow,
      rebuildTable: proto.rebuildTable,
    };

    if (
      typeof originals.setCellFocus !== "function" ||
      typeof originals.updateCell !== "function" ||
      typeof originals.getTableString !== "function" ||
      typeof originals.makeAlignmentRow !== "function" ||
      typeof originals.rebuildTable !== "function"
    ) {
      return;
    }

    const pluginPrototype = DisableTableAutopaddingPlugin.prototype;

    proto.setCellFocus = function (row, col, selectionFn) {
      return this.receiveCellFocus(row, col, selectionFn, true);
    };

    proto.updateCell = pluginPrototype.minimalUpdateCell;
    proto.getTableString = pluginPrototype.preservingGetTableString;
    proto.makeAlignmentRow = pluginPrototype.preservingMakeAlignmentRow;
    proto.rebuildTable = pluginPrototype.preservingRebuildTable;

    this.patch = { proto, originals };
  }

  onunload() {
    if (this.intervalId != null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }

    if (!this.patch) return;

    // Restore original prototype methods so other plugins get stock behavior.
    const { proto, originals } = this.patch;
    proto.setCellFocus = originals.setCellFocus;
    proto.updateCell = originals.updateCell;
    proto.getTableString = originals.getTableString;
    proto.makeAlignmentRow = originals.makeAlignmentRow;
    proto.rebuildTable = originals.rebuildTable;

    this.patch = null;
  }
};
