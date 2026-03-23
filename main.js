const { Plugin } = require("obsidian");

/** Prototype shape of Obsidian’s in-editor markdown table widget (names preserved in release builds). */
function findTableWidgetPrototype(obj) {
  for (
    let p = obj;
    p && p !== Object.prototype;
    p = Object.getPrototypeOf(p)
  ) {
    if (
      typeof p.setCellFocus === "function" &&
      typeof p.dispatchTable === "function" &&
      typeof p.rebuildTable === "function" &&
      typeof p.receiveCellFocus === "function"
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

/**
 * Walks a bounded object graph from workspace roots to find the table widget prototype.
 * Getters are only invoked for a small whitelist to avoid side effects from arbitrary accessors.
 */
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
      const v = w.activeLeaf?.view;
      enqueueEditorSurfaces(v?.editor, enqueue);
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

module.exports = class DisableTableAutopaddingPlugin extends Plugin {
  /** @type {{ proto: object, original: function } | null} */
  patch = null;

  onload() {
    const run = () => this.applyTableFocusPatch();

    run();
    this.registerEvent(this.app.workspace.on("active-leaf-change", run));
    this.registerEvent(this.app.workspace.on("layout-change", run));
    this.registerEvent(this.app.workspace.on("file-open", run));
  }

  applyTableFocusPatch() {
    if (this.patch) return;

    const proto = discoverTablePrototype(this.app);
    if (!proto) return;

    const original = proto.setCellFocus;
    if (typeof original !== "function") return;

    proto.setCellFocus = function (row, col, selectionFn) {
      return this.receiveCellFocus(row, col, selectionFn, true);
    };

    this.patch = { proto, original };
  }

  onunload() {
    if (this.patch) {
      this.patch.proto.setCellFocus = this.patch.original;
      this.patch = null;
    }
  }
}
