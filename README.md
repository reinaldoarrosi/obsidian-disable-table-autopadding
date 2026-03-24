# Disable Table Autopadding

An [Obsidian](https://obsidian.md) plugin that disables table auto-padding performed by Obsidian whenever a table is focused/edited.

## ⚠️ Remarks

This plugin works by patching Obsidian's code dynamically.
This means that it relies on non-public APIs which means that it can break if Obisidian changes its internal code.

This is not really a problem, but it may lead to instability (although this should be rare).

Use at your own discretion.

## Installation

### From the community plugins list (when published)

1. Open **Settings → Community plugins** and disable Safe Mode.
2. Click **Browse** and search for “Disable Table Autopadding”.
3. Install the plugin and enable it.

### Manual install

1. Download the latest release (or clone this repo).
2. Copy `main.js`, and `manifest.json` into your vault’s `.obsidian/plugins/obsidian-disable-table-autopadding/` folder (if the folder does not exists yet, create it).
3. In Obsidian, open **Settings → Community plugins** and enable **Disable Table Autopadding**.

## License

MIT © Reinaldo Arrosi
