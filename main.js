const { Plugin, TFile, PluginSettingTab, Setting } = require("obsidian");

const DEFAULT_SETTINGS = {
  autoNormalizeOnSave: false,
};

function isFenceLine(trimmed) {
  return trimmed.startsWith("```") || trimmed.startsWith("~~~");
}

function countBackticks(line, start) {
  let count = 0;
  while (start + count < line.length && line[start + count] === "`") {
    count++;
  }
  return count;
}

function splitByPipes(line) {
  const cells = [];
  let current = "";
  let i = 0;
  let inWikilink = false;
  let inCode = false;
  let codeTicks = 0;

  while (i < line.length) {
    const ch = line[i];
    const next = i + 1 < line.length ? line[i + 1] : "";

    if (!inCode && !inWikilink && ch === "\\" && next === "|") {
      current += "\\|";
      i += 2;
      continue;
    }

    if (!inCode && ch === "[" && next === "[") {
      inWikilink = true;
      current += "[[";
      i += 2;
      continue;
    }

    if (inWikilink && ch === "]" && next === "]") {
      inWikilink = false;
      current += "]]";
      i += 2;
      continue;
    }

    if (!inWikilink && ch === "`") {
      const ticks = countBackticks(line, i);
      current += "`".repeat(ticks);
      i += ticks;
      if (!inCode) {
        inCode = true;
        codeTicks = ticks;
      } else if (ticks === codeTicks) {
        inCode = false;
        codeTicks = 0;
      }
      continue;
    }

    if (!inCode && !inWikilink && ch === "|") {
      cells.push(current);
      current = "";
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  cells.push(current);
  return cells;
}

function formatCell(text) {
  if (text.length === 0) return " ";
  return ` ${text} `;
}

function isSeparatorCell(text) {
  return /^:?-{3,}:?$/.test(text);
}

function normalizeSeparatorCell(text) {
  const trimmed = text.trim();
  const left = trimmed.startsWith(":");
  const right = trimmed.endsWith(":");
  if (left && right) return ":---:";
  if (left) return ":---";
  if (right) return "---:";
  return "---";
}

function normalizeTableLine(line) {
  const prefixMatch = line.match(/^(\s*(?:>+\s*)*)/);
  const prefix = prefixMatch ? prefixMatch[1] : "";
  const content = line.slice(prefix.length);
  const trimmed = content.trim();

  if (!trimmed.includes("|")) return line;
  if (!(trimmed.startsWith("|") && trimmed.endsWith("|"))) return line;

  const rawCells = splitByPipes(trimmed);
  if (rawCells.length < 3) return line;

  let cells = rawCells;
  cells = cells.slice(1, cells.length - 1);
  const normalizedCells = cells.map((cell) => cell.trim());
  const isSeparatorRow = normalizedCells.every(isSeparatorCell);
  const finalCells = isSeparatorRow
    ? normalizedCells.map(normalizeSeparatorCell)
    : normalizedCells;
  const normalized = `${prefix}|${finalCells.map(formatCell).join("|")}|`;

  return normalized;
}

function normalizeTables(text) {
  const lines = text.split(/\r?\n/);
  const result = [];
  let inFence = false;
  let fenceMarker = "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (isFenceLine(trimmed)) {
      if (!inFence) {
        inFence = true;
        fenceMarker = trimmed.startsWith("```") ? "```" : "~~~";
      } else if (trimmed.startsWith(fenceMarker)) {
        inFence = false;
        fenceMarker = "";
      }
      result.push(line);
      continue;
    }

    if (inFence) {
      result.push(line);
      continue;
    }

    result.push(normalizeTableLine(line));
  }

  return result.join("\n");
}

class TableAutopaddingSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName("Auto-normalize tables on save")
      .setDesc(
        "When enabled, tables in the current file are normalized (padding removed) automatically whenever you save the file."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoNormalizeOnSave)
          .onChange(async (value) => {
            this.plugin.settings.autoNormalizeOnSave = value;
            await this.plugin.saveSettings();
          })
      );
  }
}

module.exports = class TableAutopaddingRemover extends Plugin {
  get settings() {
    return this._settings || DEFAULT_SETTINGS;
  }

  set settings(value) {
    this._settings = value;
  }

  async loadSettings() {
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData()) };
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  onload() {
    this.processing = new Set();
    this.loadSettings();

    this.addSettingTab(new TableAutopaddingSettingTab(this.app, this));

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (!this.settings.autoNormalizeOnSave) return;
        if (!(file instanceof TFile) || file.extension !== "md") return;
        this.normalizeFile(file);
      })
    );

    this.addCommand({
      id: "normalize-current-file",
      name: "Normalize tables in current file",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (checking) return true;
        this.normalizeFile(file);
        return true;
      },
    });

    this.addCommand({
      id: "normalize-all-files",
      name: "Normalize tables in all markdown files",
      callback: () => this.normalizeAllFiles(),
    });
  }

  async normalizeFile(file) {
    if (!(file instanceof TFile)) return;
    if (file.extension !== "md") return;
    if (this.processing.has(file.path)) return;

    const text = await this.app.vault.read(file);
    const normalized = normalizeTables(text);
    if (normalized === text) return;

    this.processing.add(file.path);
    try {
      await this.app.vault.modify(file, normalized);
    } finally {
      this.processing.delete(file.path);
    }
  }

  async normalizeAllFiles() {
    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      // Sequential to avoid heavy vault churn
      // eslint-disable-next-line no-await-in-loop
      await this.normalizeFile(file);
    }
  }
};
