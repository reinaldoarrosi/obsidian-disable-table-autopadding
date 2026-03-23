const { Plugin } = require("obsidian");

/**
 * Must return the prototype object that *owns* the table methods (e.g. Table.prototype).
 * The previous check `typeof obj.setCellFocus === "function"` is true on *instances* too
 * (inherited), so we returned one table instance and patched only that object — other
 * tables still used stock prototype code, so preserving serializers never ran.
 */
function findTableWidgetPrototype(obj) {
  for (let p = obj; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    if (!Object.prototype.hasOwnProperty.call(p, "setCellFocus")) continue;
    if (
      typeof p.setCellFocus === "function" &&
      typeof p.dispatchTable === "function" &&
      typeof p.rebuildTable === "function" &&
      typeof p.receiveCellFocus === "function" &&
      typeof p.updateCell === "function" &&
      typeof p.getTableString === "function" &&
      typeof p.makeAlignmentRow === "function"
    ) {
      return p;
    }
  }
  return null;
}

const SAFE_GETTER_KEYS = new Set([
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

function enqueueEditorSurfaces(ed, enqueue) {
  if (!ed || typeof ed !== "object") return;
  enqueue(ed);
  for (const k of ["cm", "tableCell", "content", "view"]) {
    try {
      enqueue(ed[k]);
    } catch {
      /* ignore */
    }
  }
}

function discoverTablePrototype(app, maxSteps = 20000) {
  const visited = new WeakSet();
  const queue = [];

  function enqueue(v) {
    if (v == null) return;
    const t = typeof v;
    if (t !== "object" && t !== "function") return;
    if (visited.has(v)) return;
    visited.add(v);
    queue.push(v);
  }

  try {
    enqueue(app);
    enqueue(app.workspace);
    const w = app.workspace;
    enqueue(w.activeLeaf);
    enqueue(w.activeEditor);
    try {
      enqueueEditorSurfaces(w.activeEditor?.editor, enqueue);
    } catch {
      /* ignore */
    }
    for (const leaf of w.getLeavesOfType("markdown")) {
      enqueue(leaf);
      enqueue(leaf.view);
      try {
        enqueue(leaf.view?.editMode);
        enqueue(leaf.view?.previewMode);
        enqueueEditorSurfaces(leaf.view?.editor, enqueue);
      } catch {
        /* ignore */
      }
    }
    try {
      enqueueEditorSurfaces(w.activeLeaf?.view?.editor, enqueue);
    } catch {
      /* ignore */
    }
  } catch {
    /* ignore */
  }

  let steps = 0;
  while (queue.length && steps++ < maxSteps) {
    const cur = queue.shift();
    const hit = findTableWidgetPrototype(cur);
    if (hit) return hit;

    let keys;
    try {
      keys = Reflect.ownKeys(cur);
    } catch {
      continue;
    }

    for (const key of keys) {
      if (typeof key === "symbol") continue;
      let desc;
      try {
        desc = Object.getOwnPropertyDescriptor(cur, key);
      } catch {
        continue;
      }
      if (!desc) continue;

      if (typeof desc.get === "function") {
        if (SAFE_GETTER_KEYS.has(String(key))) {
          try {
            enqueue(desc.get.call(cur));
          } catch {
            /* ignore */
          }
        }
        continue;
      }

      const val = desc.value;
      if (val == null) continue;

      if (Array.isArray(val)) {
        const cap = Math.min(val.length, 64);
        for (let i = 0; i < cap; i++) enqueue(val[i]);
        continue;
      }

      if (typeof val === "object") enqueue(val);
    }
  }

  return null;
}

function minimalUpdateCell(cell, newText) {
  const oldLen = cell.text.length;
  const from = cell.start + cell.padStart;
  const to = cell.start + cell.padStart + oldLen;
  const delta = newText.length - oldLen;

  cell.text = newText;
  cell.dirty = true;

  if (delta !== 0) {
    let passed = false;
    const rows = this.rows;
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let c = 0; c < row.length; c++) {
        const ch = row[c];
        if (passed) {
          ch.start += delta;
          ch.end += delta;
        }
        if (ch === cell) passed = true;
      }
    }
  }

  cell.end += delta;
  return [{ from, to, insert: newText }];
}

function preservingGetTableString(bounds) {
  const t = this.validateSelectionBounds(bounds);
  const n = t.minRow;
  const i = t.maxRow;
  const r = t.minCol;
  const o = t.maxCol;
  const rows = this.rows;
  let u = "";
  for (let h = n; h <= i; h++) {
    const p = rows[h];
    for (let d = r; d <= o; d++) {
      const cell = p[d];
      u += "|" + cell.getTextWithPadding();
    }
    u += "|";
    if (h === n) u += "\n" + this.makeAlignmentRow(r, o);
    if (h !== i) u += "\n";
  }
  return u;
}

function preservingMakeAlignmentRow(fromCol, toCol) {
  const MIN_COL_RENDER_WIDTH = 5;
  const alignments = this.alignments;
  let r = "";
  
  for (let col = fromCol; col <= toCol; col++) {
    switch (alignments[col]) {
      case "left":
        r += "| :" + "-".repeat(Math.max(1, MIN_COL_RENDER_WIDTH - 3)) + " ";
        break;
      case "center":
        r += "| :" + "-".repeat(Math.max(1, MIN_COL_RENDER_WIDTH - 4)) + ": ";
        break;
      case "right":
        r += "| " + "-".repeat(Math.max(1, MIN_COL_RENDER_WIDTH - 3)) + ": ";
        break;
      default:
        r += "| " + "-".repeat(Math.max(1, MIN_COL_RENDER_WIDTH - 2)) + " ";
    }
  }
  return r + "|";
}

/**
 * Same as stock rebuildTable but builds the markdown via preservingGetTableString so
 * dispatchTable/insertRow always hit the preserving path even if getTableString were
 * bound differently.
 */
function preservingRebuildTable() {
  const e = this;
  const t = e.editor;
  const n = e.rows;
  const i = e.alignments;
  const r = preservingGetTableString.call(e, {
    minRow: 0,
    maxRow: n.length - 1,
    minCol: 0,
    maxCol: i.length - 1,
  });
  const o = t.cm;
  const a = (e.doc = o.state.toText(r));
  if (r) this.render();
  return a;
}

module.exports = class DisableTableAutopaddingPlugin extends Plugin {
  /** @type {{ proto: object, originals: object } | null} */
  patch = null;
  intervalId = null;

  onload() {
    const run = () => this.applyTablePatches();

    run();
    this.registerEvent(this.app.workspace.on("active-leaf-change", run));
    this.registerEvent(this.app.workspace.on("layout-change", run));
    this.registerEvent(this.app.workspace.on("file-open", run));

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

    const proto = discoverTablePrototype(this.app);
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

    proto.setCellFocus = function (row, col, selectionFn) {
      return this.receiveCellFocus(row, col, selectionFn, true);
    };

    proto.updateCell = minimalUpdateCell;
    proto.getTableString = preservingGetTableString;
    proto.makeAlignmentRow = preservingMakeAlignmentRow;
    proto.rebuildTable = preservingRebuildTable;

    this.patch = { proto, originals };
  }

  onunload() {
    if (this.intervalId != null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (!this.patch) return;
    const { proto, originals } = this.patch;
    proto.setCellFocus = originals.setCellFocus;
    proto.updateCell = originals.updateCell;
    proto.getTableString = originals.getTableString;
    proto.makeAlignmentRow = originals.makeAlignmentRow;
    proto.rebuildTable = originals.rebuildTable;
    this.patch = null;
  }
}
