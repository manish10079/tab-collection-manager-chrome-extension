# Changelog

Notable, user-visible changes to Tab Collection Manager, newest first.

The version numbers here are the **extension** version (`manifest.json`) — the SemVer axis that
ships to the Chrome Web Store. The storage schema, the message protocol and each document's own
version are separate axes and are not tracked here (see `skill.md` §7).

Entries are append-only: a released version's notes are never rewritten.

---

## 2.6.0

No new permissions. The permission set is unchanged from 2.3.0.

### Changed

- **Destructive actions now ask inside the panel, not in a browser popup.** Deleting a collection, a
  folder or a bulk selection, restoring a session backup, and restoring or disconnecting Google
  Drive all show the extension's own confirmation dialog in place of the browser's `Confirm` box.

  It is styled like the rest of the panel, is reachable and dismissible from the keyboard (Escape,
  Tab, Enter), announces itself to screen readers as a labelled dialog, and keeps naming what will
  go — for example a folder delete still says "and the 2 collections inside it? This cannot be
  undone." Answering it no longer blocks the browser's event loop the way the native box did.

### Under the hood

- A single reusable confirmation primitive (`ConfirmProvider` and `confirmStore`) backs every one of
  those six questions, so the wording rules, the destructive-button styling and the
  dismissal-counts-as-refusal behaviour exist in one place rather than being re-argued per caller.
- 415 unit and component tests across 46 files, and 16 end-to-end Playwright specs against `dist/`
  loaded unpacked.

---

## 2.5.1

No user-visible change to the panel. This release records the project's commit rules in
`skill.md` 2.8.0: every commit now raises the extension version and names it as a trailing
`(vX.Y.Z)` token in the commit subject.

### Changed

- The extension version advances on every commit, so it follows the build rather than a curated
  set of features. The storage schema and the message protocol are untouched and no permission
  changed.

---

## 2.5.0

Bundles everything landed since `v2.3.0`. **2.4.0 was set during development but never tagged or
released**, so there is no separate entry for it and its contents are included below.

No new permissions. The permission set is unchanged from 2.3.0.

### Added

- **Colour labels for folders and collections.** Label any folder or collection from its own options
  menu, and clear the label again with the "no color" swatch. A labelled item shows a small colour
  dot in its header.

  A colour is a **shared grouping key**, not a property of one item: the same colour can tag any
  number of folders and any number of collections, and the label is stored as just a colour id so the
  palette itself stays in one place.

- **Ten built-in colours plus your own.** Red, orange, amber, green, teal, blue, indigo, purple, pink
  and gray are always available and cannot be renamed or removed. On top of those you can add up to
  40 custom colours — each a name and a shade — from **Settings → Color Labels**.

- **Create a custom colour straight from the item's menu.** The colour picker ends in a "+" swatch
  that opens a colour well and a name field. Confirming adds the colour to your palette *and* labels
  that folder or collection in a single write, so a colour you make from a menu always lands on the
  item that prompted it and never appears in the palette on its own. The new colour is then offered
  in every other picker, ready to reuse.

- **A Color filter in the controls bar.** Multi-select, so several colours can be shown at once, plus
  a "No color" option for unlabelled items. Filtering is a union: it shows folders by their own
  colour and collections by their own colour, and a collection whose folder the filter hid is
  promoted out of it so a colour never loses a member. A "no matches" message appears when nothing
  matches.

- **A Color option in the Collections sort menu.** Groups the list into colour sections, so every
  folder and collection sharing a colour sits together, with unlabelled items last.

### Fixed

- **Colour labels and your custom palette now survive every backup path.** They travel through global
  export/import and the Google Drive backup, which previously dropped them. Re-importing a backup no
  longer duplicates a colour you already have — a palette entry is reused when it matches an existing
  one by id or by name. On restore, a label that can no longer be resolved is dropped rather than
  left pointing at a colour that does not exist.

### Changed

- **The controls bar wraps instead of squeezing.** Eleven controls used to be compressed into one
  row. They now flow onto as many rows as the panel width allows — all of them on one row when the
  panel is wide enough, two or three as it narrows — and come back to one row as soon as it is
  widened again. A wrapped row lines up with the row above it rather than being indented towards the
  middle, and a single row stays centred.

- **The header subtitle keeps its own line.** "Autosave & organize your browsing sessions" no longer
  slides up beside the settings and close buttons once the panel is wide enough to fit all three at
  once; it stays on its own row under the title at every panel width.

### Under the hood

- The stylesheet is now split into per-family sheets (`base`, `shell`, `collections`, `tabs`,
  `dialogs`, `settings`, `toast`) over a shared `tokens.css`, with every class carrying its family's
  prefix. The single legacy stylesheet is gone. Recorded in `docs/decisions/ADR-0014-css-migration.md`.
- A committed **computed-style probe** (`tests/fixtures/style-probe.json`) records what each panel
  element resolves to across 14 states, so an accidental restyle fails a test rather than passing
  review unseen.
- Storage schema `3`, additive: migration `0003-colors.js` adds the `customColors` setting and the
  `color` field. A profile from an earlier version upgrades in place and simply starts with no
  labels.
- 401 unit and component tests across 44 files, and 16 end-to-end Playwright specs against `dist/`
  loaded unpacked.

### Chrome Web Store listing notes

- **Permissions diff: none.** Same eight permissions as 2.3.0 (`tabs`, `tabGroups`, `storage`,
  `contextMenus`, `favicon`, `sidePanel`, `alarms`, `identity`).
- Listing copy worth highlighting for this release: colour labels for folders and collections, custom
  colours, and colour filtering and grouping.

---
