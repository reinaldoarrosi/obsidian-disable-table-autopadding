# Disable Table Autopadding

An [Obsidian](https://obsidian.md) plugin that lets you control how markdown tables are padded. Normalize table formatting so cells have consistent spacing, either automatically on save or on demand.

This project was based off of https://github.com/ar-siddiqui/table-autopadding-remover

## Features

- **Auto-normalize on save** — When enabled, tables in the file are normalized whenever you save (optional, off by default).
- **Normalize current file** — Command to normalize all tables in the active note.
- **Normalize all files** — Command to normalize tables in every markdown file in your vault.

Normalization keeps tables valid while applying consistent padding (spaces around cell content and separator alignment). Code blocks, wikilinks `[[...]]`, and escaped pipes `\|` are left unchanged.

## Installation

### From the community plugins list (when published)

1. Open **Settings → Community plugins** and disable Safe Mode.
2. Click **Browse** and search for “Disable Table Autopadding”.
3. Install the plugin and enable it.

### Manual install

1. Download the latest release (or clone this repo).
2. Copy `main.js`, `manifest.json`, and `styles.css` (if present) into your vault’s `.obsidian/plugins/obsidian-disable-table-autopadding/` folder.
3. In Obsidian, open **Settings → Community plugins** and enable **Disable Table Autopadding**.

## Usage

1. Open **Settings → Community plugins** and ensure the plugin is enabled.
2. In **Settings**, find **Disable Table Autopadding** to:
   - Turn **Auto-normalize tables on save** on or off.
3. Use **Command palette** (Ctrl/Cmd + P) and run:
   - **Normalize tables in current file** — normalize the active note.
   - **Normalize tables in all markdown files** — normalize the whole vault.

## Requirements

- Obsidian 1.5.0 or newer.

## License

MIT © Reinaldo Arrosi
