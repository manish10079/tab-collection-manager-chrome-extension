# ADR-0009: Vendor assets are self-hosted, the panel stylesheet is swept, and the panel is keyboard-labelled

- Status: accepted
- Date: 2026-10-01
- Context: `react-migration-plan.md` §8, Phase 5.4 ("Polish")

> **Amendment (2026-10-02, plan v1.12.0).** The stylesheet this ADR calls `popup.css` was renamed to
> `src/styles/panel.css` once nothing else in the repository was called "popup". The decisions above
> are unchanged — only the path in the Prettier exclusion and in the references to the stylesheet
> moved. Historical ADRs and changelog rows keep the old name.

## Context

Three loose ends survived Phase 5.3. They are unrelated in kind but share one cause — the panel was
assembled by hand before the migration, so nothing had ever needed to *own* them.

- **Two CDN `<link>`s.** `popup.html` loaded Font Awesome and Inter from `cdnjs` and
  `fonts.googleapis`. That is a remote asset load on every panel open and the exact "remote code /
  remote resource" pattern extension review flags. It is also a hard dependency on someone else's
  uptime for a panel that otherwise works offline.
- **The stylesheet still carried the legacy shell's dead rules.** (Then `popup.css`, now
  `src/styles/panel.css` — see the amendment above.) It is 2,800+ lines and was the one file Prettier
  and ESLint still excluded. Phase 5.2/5.3 replaced the markup that consumed it, so
  rules for classes only the deleted markup ever set had no consumer — but nothing failed when they
  stayed.
- **The React shell had no explicit accessible names and no focus-return path.** Every icon-only
  control (header, controls bar, sort menu, search results) was a button whose entire content is a
  Font Awesome glyph, named only by a `title` tooltip. The search and create slides moved focus into
  their input on open but, unlike the Modal primitive, did not give it back on close.

## Decision

### Vendor assets

- **Font Awesome is a runtime dependency, pinned to `6.4.0`** — the version the CDN served. FA 7
  renames glyphs, so the pin is the contract that keeps the 59 `fa-*` classes in the React tree
  rendering the same icons. `src/main.jsx` imports `css/all.min.css`, byte-identical to the copy the
  CDN served.
- **Import the combined stylesheet, not per-style files.** `solid.min.css` alone is 625 B but carries
  no glyphs: the `content` declarations live in `fontawesome.css` (plus `brands.css` / `regular.css`),
  and `all.min.css` is the only file that also declares the legacy `'Font Awesome 5 Free'` family two
  `::before` icons in `src/styles/panel.css` still ask for (lines using that family were kept
  deliberately).
- **Inter is self-hosted as static weights 400/500/600/700** via `@fontsource/inter`, one CSS import
  each. Only these weights appear in `panel.css` and `shell.css`. The CDN requested 300, which nothing
  used; the variable-font package was tried and rejected because it renders weights slightly
  differently, which would make the "visual diff clean" acceptance unverifiable.
- **The build ships woff2 only.** Vite emits every `src` a font's `@font-face` lists, so
  `@fontsource` and FA both bring a legacy `.woff`/`.ttf` beside each `.woff2`. `scripts/build.mjs`
  deletes the non-woff2 font files after the bundle, halving `dist/` (2.5 MB → 1.15 MB) with
  byte-identical rendering on any Chrome MV3 target.
- **The build proves the trim was safe.** A new `assertReferencedAssetsExist()` reads every
  `url(...)`, `src=` and `href=` in the emitted HTML and CSS and fails if a referenced asset is
  missing — a trimmed legacy format is allowed only when a `.woff2` of the same logical font
  survived. This turns "I removed the fallback" into a checked property rather than a hope.

### The stylesheet sweep

- **Remove only rules with no consumer in `src/`.** Each candidate was checked against every
  `.js`/`.jsx`/`.html` file, including class strings built by template literals and conditional
  expressions, so a class applied as `` `expand-btn${open ? ' rotated' : ''}` `` counts as used.
  Removed: the `.select` block (no `<select>` or `.select` class exists), `.btn-primary` and its
  hover (secondary/outline remain, sharing the base rule), `.auto-save-section`,
  `.settings-action-btn`, the `.restore-tooltip*` trio and its hover trigger, and the
  `.search-hidden` / `.search-fade-in` / `.search-highlight` filter-animation rules.
- **Keep shared animation keyframes.** `@keyframes searchFadeIn` lost its original consumer but three
  other rules still call it, so it stays with a comment saying so.
- **`src/styles/panel.css` stays Prettier- and ESLint-excluded.** It is not React source and
  reformatting it would bury a real diff in whitespace.

### Accessibility

- **Every icon-only control gets an `aria-label`**, and its decorative `<i>` gets
  `aria-hidden="true"`. The `title` attributes stay as tooltips; the label is the accessible name.
  That covers the header, the whole controls bar, the sort trigger (which already exposed
  `aria-haspopup` / `aria-expanded` and its menu now gets `aria-labelledby`), the search-results
  "open tab" button and the modal close button.
- **The search and create inputs get `aria-label`s**, so they are not named by a placeholder.
- **A new `useRestoreFocus` hook gives focus back to the trigger** when a slide unmounts, matching
  what the Modal primitive already did for dialogs. It is a hook rather than a slice-local `useEffect`
  because both slides need it and the Modal pattern showed the capture must happen before the input
  moves focus.
- **Escape routing is unchanged and re-confirmed**: a visible dialog wins (the Modal stack handles it
  and the global handler defers via `isAnyModalOpen()`), a slide closes itself and stops propagation
  so the global handler does not also fire, and open menus dismiss through `useDismissable`.

## Consequences

- `dist/` loads nothing from the network. The only `https://` strings left are the FA licence comment
  and the Google Drive API endpoints the worker legitimately calls.
- `dist/` is 1.15 MB instead of 2.5 MB, with one `.woff2` per face.
- The panel is unchanged visually: no colour, size, spacing or font-weight rule was touched, and the
  current markup was the source of truth for what is still reachable.
- Tests grew to 196 (25 files): `ControlsBar` now covers focus-into-slide / focus-back-to-trigger and
  asserts the icon controls expose accessible names.
- Adding a new icon-only control now means adding a label; nothing enforces that automatically, so it
  stays a review point.
- A future FA major bump is a deliberate change: the version pin is what protects the glyph names.

## Alternatives considered

- **Keep the CDN links and add a `connect-src` / CSP allowance.** Rejected: it is precisely the
  remote-asset dependency Phase 5.4 exists to remove, and it fails offline.
- **Import individual Font Awesome glyph files / a subset build.** Rejected: the panel uses 59 distinct
  `fa-*` classes across four styles plus CSS-set `::before` glyphs, and FA's own `all.css` is the
  supported bundle. A subset build would need regeneration on every icon change.
- **Switch Inter to `@fontsource-variable/inter`.** Rejected: it would change weight rendering versus
  the static faces the CDN served, which the phase's acceptance ("visual diff clean") cannot absorb.
- **Convert the fonts to WOFF2 at build time instead of shipping what the packages emit.** Rejected:
  the packages already ship woff2; the work was deleting the alternates, not transcoding.
- **Delete the `@font-face` fallback `src` entries from the CSS as well.** Rejected: editing emitted
  vendor CSS means forking it. Deleting the files and asserting the woff2 sibling survived keeps the
  vendor stylesheet untouched and the invariant checked.
- **Prettier-format the panel stylesheet while sweeping it.** Rejected: it would rewrite thousands of
  lines and make the actual deletions unreviewable.
- **Give the slides a full ARIA dialog/combobox treatment.** Rejected as scope: they replace a
  toolbar row in place and are not modal; a label, focus-into and focus-back is what matches the
  behaviour and the Modal pattern already in the codebase.
- **Enforce accessible names with a lint rule** (e.g. `control-has-associated-label`). Deferred: it
  would fire across the pre-React-free parts of the tree in one commit; the shell was fixed by hand
  and the rule can be scoped later.
