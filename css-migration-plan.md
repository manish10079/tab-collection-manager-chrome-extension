# CSS migration plan — retiring `panel.css`

| Field | Value |
| --- | --- |
| Document version | 1.2.0 |
| Status | In progress — Phases 0-1 landed (ratchet, coverage tool, tokens.css); Phases 2-6 not started |
| Last updated | 2026-10-02 |
| Owner | Maintainer (`@mkn`) |
| Extends | `react-migration-plan.md` (the React migration is complete through Phase 8; this finishes the only artifact it left behind) |
| Governing rules | `skill.md` §5.3 (CSS), §4.1 (one stylesheet per component), §6 (verification), §11 (amending `skill.md`) |

## 1. Why this plan exists

The React migration replaced every line of vanilla JavaScript and HTML. The panel's **styling was
never migrated**: `src/styles/panel.css` is still the pre-React stylesheet, loaded by
`src/sidepanel.html`, deliberately excluded from Prettier, and pointed at by class names that React
components render on purpose — `.collection`, `.collection-header`, `.icon-btn`, `.modal-overlay`,
`.dropdown-option`. `src/styles/shell.css` (304 lines) is the only React-owned rules layer.

That is a working arrangement, not a finished one, and it has a measurable cost. Every styling bug
in the 2.1/2.2 line traced back to the seam between the two files:

| Incident | Cause | Where |
| --- | --- | --- |
| Folder menu invisible on a short folder | `.folder` set `overflow: hidden` while the dropdown hangs below its box | `shell.css` vs `panel.css` |
| Folder menu painted under the next card | `:has()` stacking fix in `panel.css` covered `.collection` only, not `.folder` | `panel.css` |
| Folder collections picked up grid-card layout | `.collections-container.grid-view .collection` is a descendant selector, so it matched **nested** cards too | `panel.css` |

### The measured state

| Metric | `panel.css` | `shell.css` | `skill.md` §5.3 target |
| --- | --- | --- | --- |
| Lines / rules | 2,803 / 375 | 304 / 39 | one stylesheet per component |
| Hard-coded colours | 168 occurrences, **98 distinct** | 3 | design tokens only |
| Design tokens defined / used | 35 / 301 `var()` | — | tokens live in `styles/tokens.css` |
| `!important` | **60** | 0 | forbidden |
| Selectors deeper than 3 combinators | **1** | 0 | forbidden |
| `:has()` cascade workarounds | 6 | 0 | none needed |
| Element-tag selectors | 3 (`body`, `body.panel-closing`, `mark.search-hl`) | 0 | forbidden |
| Prefixed classes | 0 | **1 of 24** (`.rs-error`) | prefixed by feature (`cc-`, `tab-`, `set-`) |
| Media queries | 0 | 0 | — (the side panel is a fixed surface; nothing to port) |
| ID selectors in CSS | 0 | 0 | — |
| Prettier | excluded | formatted | enforced |

**Re-measured by Phase 0's tool.** The table above is the initial hand measurement, kept for
context. `npm run css:metrics` is now the source of truth, and it disagrees on three counts because
it counts *style* rules only — skipping `@media`/at-rule preludes and `@keyframes` steps — counts
`:has(` occurrences, and counts distinct un-prefixed class names rather than selectors. Its
baseline: 2,803 lines and **347 rules** in `panel.css`, 304 lines and 39 rules in `shell.css`;
**171** colour literals (168 + 3), **60** `!important`, **1** selector past three compound parts
(`.duplicate-dialog .modal-header h3 i`), **7** `:has()`, **3** tag selectors and **35** un-prefixed
classes in the React-owned sheet. Phase 1 has since moved the token declarations into `tokens.css`
and derived the status tints from them, so the live figures are now the ones in
`tests/fixtures/css-baseline.json` — **65** colour literals and 2,727 lines of `panel.css`.

Two findings worth stating plainly, because they are why this is a plan and not a tidy-up:

1. **`shell.css` does not follow its own convention.** Its header comment claims "Class prefix `rs-`
   avoids collisions with the migrated panel stylesheet (skill.md §5.3)", yet 23 of its 24 selectors
   are unprefixed. The rule the file cites does not exist in `skill.md` §5.3 — that section names
   `cc-`, `tab-` and `set-`, and `rs-` appears only in this comment. The React-owned sheet has been
   inventing a convention.
2. **Tokens already exist and are already ignored.** There is a `--danger: #ff5c7a` token, while
   `.rs-error` hard-codes `#ff6b6b` — a *different* red for the same meaning, three lines apart in
   intent. Two further literals sit beside it. This is token drift inside 20 lines of React-owned
   CSS, which is a fair proxy for what the remaining 2,800 lines look like.

### Where the rules live today

`panel.css` keeps a 25-section internal map, which is the split this plan reuses (line numbers at
plan time): theme variables (1-161), header (162-196), controls bar and slides (197-408), buttons
and restore/sort (493-606), collections (607-979), grid view (615-980), tabs (980-1283), dropdowns
and stacking (1284-1410), modals (1411-1693), toasts (1699-1744), scrollbars and drag/drop
(1745-1808), duplicates dialog (1809-1888), search results (1889-2116), sort dropdown (2117-2225),
pinning (2226-2307), settings and shortcuts (2308-2660), stat/misc (2634-2690), view-collection
modal (2691-2748), settings/history/cloud modals (2749-2803).

## 2. Target state

```text
src/styles/
├─ tokens.css            # every --* declaration, nothing else (the one file allowed raw colour)
├─ base.css              # reset, body/panel open-close animation, scrollbars, .container
├─ index.css             # the single ordered entry: tokens -> base -> components
src/features/<feature>/components/<Component>.css
src/features/<feature>/lib/*.css        # only where rules genuinely span components
src/components/Modal.css
```

Rules that make this the target:

- **`tokens.css` is the only place a colour literal may appear.** Every other sheet consumes
  `var(--…)`. Two themes stay as they are today (dark default + `[data-theme="light"]` override).
- **One stylesheet per component** (`skill.md` §5.3), colocated with the component it styles and
  imported from that component's module — the mechanism `shell.css` already uses, just per-feature.
  Vite still emits **one** bundled CSS asset, so `dist/` layout and the size budget are unaffected.
- **Prefixed classes**, per a prefix map that has to be written down (see §4 Phase 3).
- **No `!important`, no tag selectors, no selector deeper than 3 combinators, no `:has()`
  cascade workarounds.**
- `panel.css` **deleted**, and removed from `.prettierignore` with it.

## 3. Principles

1. **Guards before refactors.** Phase 0 lands the checks that make progress measurable and
   self-enforcing. Nothing else starts until they exist, for the same reason
   `tests/legacy-shell-removed.test.js` was written while the legacy shell was still being deleted.
2. **Shippable at every commit.** Each phase ends in a state that passes the full gate and looks
   identical in the browser. No long-lived branch (`skill.md` §4.3).
3. **Mechanical before semantic.** Split and format the file *before* renaming anything, so renames
   happen in small files with small diffs.
4. **Rename one family at a time, JSX and CSS in the same commit.** A class rename is a breaking
   change between a component and its stylesheet; splitting it across commits creates a window where
   the panel renders unstyled.
5. **The user-visible result is the acceptance test.** This is a pure refactor, so "the tests pass"
   is not sufficient evidence — see §6.

## 4. Phases

Each phase lists its exit criterion. Effort is in developer-days.

### Phase 0 — Instrument and ratchet (0.5 d)

Goal: make the numbers in §1 enforceable, so they can only improve.

- Add `tests/styles.test.js` with a committed baseline fixture (`tests/fixtures/css-baseline.json`)
  recording: hard-coded colours per file, `!important` count, rules deeper than 3 combinators,
  `:has()` count, tag selectors, un-prefixed classes in React-owned sheets, and the line count of
  `panel.css`. The test fails if **any** number goes up, and also fails if the baseline is stale
  (a number improved but was not lowered), so the ratchet cannot silently drift.
- Add `scripts/css-coverage.mjs`: load `dist/` in Playwright, exercise the golden paths (create,
  expand, search, grid view, a folder, each modal, toasts), then for every rule in
  `document.styleSheets` record whether any element ever matched it. Output a report of **rules
  never matched** — the empirical dead-rule list Phase 5 will act on. This is the only reliable way
  to find dead CSS; grepping class names against JSX produces false "alive" results because dynamic
  and conditional class names are assembled from strings.
- Wire `npm run css:coverage` into `package.json` (not CI — it needs a built `dist/`, like `e2e`).

*Exit:* both exist; the ratchet passes on today's tree; the coverage report reproduces the three
known-buggy areas as *matched* (a sanity check that the tool is not lying).

*Risk:* low. Additive only.

### Phase 1 — Extract `tokens.css` (1 d)

Goal: one source of truth for design values, with zero visual change.

- Move the three declaration blocks (`:root` dark, `[data-theme="light"]`, the shared common block)
  out of `panel.css` into `src/styles/tokens.css`, **keeping the existing variable names verbatim**.
  Do not rename a token in this phase.
- Import it first from a new `src/styles/index.css`, and drop the `<link>` in `sidepanel.html` in
  favour of that one entry so the cascade order is explicit rather than split between HTML and JS.
- Then, and only then, replace literals that a token already covers — starting with the three in
  `.rs-error`, which become `var(--danger)` and `color-mix(in srgb, var(--danger) …)`, matching what
  `.selection-delete` already does.

*Exit:* `tokens.css` holds every `--*` declaration; no literal remains where a token exists;
computed styles for the golden paths are byte-identical (see §6); the ratchet's colour count has
dropped by the number replaced.

*Risk:* low, but the cascade-order change is real — the entry file must preserve the current order,
and the computed-style comparison in §6 is what proves it.

### Phase 2 — Split `panel.css` by family, without renaming (2 d)

Goal: small files, still legacy class names, still one bundled stylesheet.

- Cut `panel.css` along its own section map into family sheets, following the **feature** boundaries
  rather than the old document order: `shell` (header, controls, slides, buttons, sort menu, empty
  state), `collections` (list, cards, folders, drag/drop, section headings), `tabs`, `dialogs`
  (modals, duplicates, history, shortcuts help, view-collection), `settings`, `toast`, `base`
  (reset, body, scrollbars, animations).
- **Run `prettier --write` on each sheet as it is created**, and delete the corresponding
  `.prettierignore` entry at the end of the phase once `panel.css` is empty and removed. Formatting
  is mechanical, so it belongs in its own commits, never mixed with a rename (`skill.md` §4.3).
- Keep the rules' relative order inside each family identical to their order in `panel.css`.

*Exit:* `panel.css` no longer exists; every sheet is Prettier-formatted; `.prettierignore` names no
stylesheet; the cascade still resolves identically (computed-style comparison, both themes, list and
grid, modals open).

*Risk:* **medium — this is the phase that can silently change rendering.** CSS resolves ties by
order, and splitting one file into eight changes which rules meet which. Mitigations: one family per
commit, the computed-style comparison on every commit, and the explicit `index.css` order as the
single place cascade order is decided.

### Phase 3 — Prefix and rename, one family at a time (5-7 d)

Goal: `skill.md` §5.3's naming rule, actually applied.

First, a `docs(skill):` amendment (§11 of `skill.md`) that writes down the full prefix map, because
the current text names only three prefixes and the panel needs more:

| Prefix | Owns | Today's classes (examples) |
| --- | --- | --- |
| `cc-` | collections list, cards, folders, sections, drag/drop | `.collection`, `.collection-header`, `.folder`, `.folder-body`, `.section-heading`, `.select-checkbox` |
| `tab-` | tab rows and everything inside a collection | `.tab-item`, `.tab-title`, `.tab-url`, `.tab-checkbox`, `.tab-dropdown-menu` |
| `sh-` | header, controls bar, slides, sort menu, empty/error state | `.header`, `.icon-btn`, `.actions-bar-default`, `.sort-dropdown-menu`, `.rs-error` |
| `dl-` | every modal and dialog, plus `components/Modal.jsx` | `.modal-overlay`, `.modal-header`, `.duplicate-*`, `.history-*` |
| `set-` | settings screens | `.settings-*`, `.toggle-*`, `.shortcut-*` |
| `ts-` | toasts | `.toast*` |
| `ut-` | shared utilities that belong to no feature | `.hidden`, `.empty-state`, `.drag-over` |

- Migrate **one family per commit**: rename in that family's stylesheet, rename in the JSX that
  renders it, run the coverage tool before and after to confirm the matched-rule set is unchanged,
  and run the E2E suite. A family that cannot be renamed in one commit is a sign it is not really
  one component.
- Delete `.rs-error`'s prefix along the way — `sh-` replaces it — so the invented convention in
  `shell.css`'s header comment disappears rather than spreading.
- Prefixes are also the point at which `.folder-body .collection-header`-style override chains can
  go: with `cc-` classes and per-component sheets, the grid-view rules can be scoped to direct
  children instead of relying on four-class specificity, which is what caused the third bug in §1.

*Exit:* no unprefixed class in any React-owned sheet; the ratchet's prefix counter is zero; each
family's commit shows an unchanged coverage report and a green E2E suite.

*Risk:* **high — the largest and most mechanical-touch phase.** Every rename touches JSX, so this is
where a typo ships an unstyled control. Mitigations: one family per commit; the coverage tool as a
diff-based check (matched rules must not decrease); E2E after each family; the existing component
tests already assert DOM structure and class names for folders and selection, so they will fail
loudly on a missed rename.

### Phase 4 — Kill dead rules (1 d)

Goal: stop shipping CSS nothing reaches.

- Take the coverage tool's never-matched list, delete those rules, and re-run the tool to confirm the
  matched set is unchanged. Review the list by hand first: a rule can be unmatched simply because no
  golden path exercises it (an error state, a hover), which is a gap in the walk, not dead CSS.
- Extend the E2E walk where the report shows a genuinely reachable-but-unexercised state (hover
  states, the storage-error banner, empty states) so the tool's signal stays trustworthy.

*Exit:* the report lists no rule that a reachable state would match; line count down materially;
ratchet lowered.

*Risk:* low-medium — deleting a rule that is reachable only in an untested state. Mitigated by
extending the walk before deleting, not after.

### Phase 5 — Flatten the cascade (1-2 d)

Goal: remove the over-depth selector, the 60 `!important`s and the 7 `:has()` workarounds.

- Replace `!important` with either a more specific *component-scoped* selector or a token, one
  family at a time. Most of the 60 exist to beat an earlier rule in the same file; after Phase 2's
  split, each collision is local and visible.
- Replace `:has()` stacking fixes with a single documented approach (a stacking context on the open
  menu's ancestor) instead of per-class copies — today `.collection` and `.folder` each carry a
  variant of the same rule, which is why the second one was missing in the first place.
- Flatten remaining deep selectors to direct-child selectors (`>`) where the intent is "this
  component's own children".

*Exit:* the ratchet's `!important`, depth and `:has()` counters are zero; the two folder-menu E2E
regression specs still pass and still fail when the fix is reverted.

*Risk:* medium — removing `!important` can change rendering somewhere unwatched. The
computed-style comparison and the screenshot baselines (§6) are the guard.

### Phase 6 — Close out (0.5 d)

- Add `docs/decisions/ADR-0013-css-migration.md` (tokens, per-component sheets, the prefix map, and
  why the legacy sheet was retired rather than kept).
- Update `skill.md` §3.2/§3.3 to show `styles/tokens.css` + `index.css` and the colocated
  component sheets; bump the document version.
- Update `react-migration-plan.md` (the "Retained artifacts" note now says the stylesheet is gone)
  and its changelog; update `README.md`'s technical section.
- Confirm `.prettierignore` no longer lists any CSS file and `npm run format:check` covers every
  stylesheet.

*Exit:* no reference to `panel.css` remains anywhere in the repo (add that assertion to the Phase 0
guard), and the full gate is green.

## 5. What the guards look like

`tests/styles.test.js` follows the two guards the repo already trusts —
`tests/version-alignment.test.js` (drift) and `tests/legacy-shell-removed.test.js` (removed-code
assertions) — rather than introducing a new toolchain. No stylelint, no PostCSS plugin: the checks
are plain assertions over the files on disk, so they run in the existing `npm test`.

| Check | Fails when |
| --- | --- |
| `tokens.css` is the only file with a colour literal | a hex/`rgb()` appears in another sheet |
| Ratchet vs `css-baseline.json` | any metric rises, or improves without the baseline being lowered |
| No `panel.css` | the file exists, or is referenced from `sidepanel.html`, `main.jsx` or `.prettierignore` |
| Prefix map | a class in a React-owned sheet carries no known prefix |
| One stylesheet per component | a JSX file with a `.css` sibling is missing it, or a component imports another component's sheet |
| No tag selectors / depth > 3 / `!important` | the rule appears |

## 6. Verification strategy

`panel.css` has no unit tests, and cannot get them — CSS is not behaviour, so the evidence has to be
rendering-based. Three layers, in increasing cost:

1. **Computed-style comparison (every commit).** A small script that loads `dist/` and dumps the
   resolved `getComputedStyle` for a fixed list of probe elements (header, controls bar, a
   collection card, a folder, a nested collection, an expanded tab row, each modal, a toast) in both
   themes and both layouts, then diffs against a committed baseline. This is what makes Phases 1-2
   mechanical-but-safe: it catches a cascade-order change that no test would. Compare colours by
   resolved pixel value, not by serializer string: Chrome serialises a `color-mix()` result as
   `color(srgb …)` even when it is numerically identical to the `rgba()` it replaced, so a string
   diff would report a change that is not there (Phase 1's 28 conversions are pixel-identical).
2. **Cascade order assertion.** `index.css` declares the order; a test asserts each sheet is imported
   exactly once and that the order matches the documented list, so a future import cannot silently
   reorder the cascade.
3. **Screenshot baselines (Playwright).** The repo has no visual regression today. Add one spec that
   captures the panel in dark and light, list and grid, and with the settings, add-tabs and history
   dialogs open. Pixel diffs are noisy, so cap it: baseline per *phase*, not per commit, reviewed by
   eye before accepting.
4. **The existing E2E suite** (11 specs) stays the behavioural guard, including the three regression
   specs written for the folder bugs above.

What this plan explicitly does **not** claim: that the refactor is proven by unit tests. It is
proven by the panel looking and composing identically, which is why the three folder-bug specs and
the computed-style diff matter more here than the ratchet.

## 7. Risk register

| Risk | Phase | Mitigation |
| --- | --- | --- |
| Cascade order changes on split | 1-2 | `index.css` as the single declared order + computed-style diff per commit |
| A rename ships an unstyled control | 3 | One family per commit; coverage diff; component tests that assert class names |
| A "dead" rule is only reachable in an untested state | 4 | Extend the E2E walk *before* deleting; hand-review the report |
| Removing `!important` regresses a hidden state | 5 | Tokens first, screenshots + computed styles, regression specs |
| The refactor is large enough to conflict with feature work | all | Small commits, `panel.css` split early so features land in small files, `skill.md` §4.3's <2-day branch rule |
| Prefix churn breaks user CSS or docs that name classes | 3 | Nothing outside the extension consumes these classes; `skill.md`'s docs are updated in the same phase |

## 8. Versioning and release impact

Per `skill.md` §7's four independent axes:

- **Storage / message protocol: no change at all.** This touches no persisted shape and no command,
  so `schemaVersion` stays 1 and no migration is involved. That is also why the work is safe to do
  in small commits.
- **Extension version: no bump for the refactor itself.** A pure refactor is not user-visible, so it
  is not a MINOR (and is not a PATCH either — nothing is fixed). It rides along inside the next
  release that has a reason to exist. The one exception: if the `!important`/`:has()` clean-up
  repairs a real rendering defect, that fix carries its own `fix(...)` commit and is called out.
- **Documentation axis: moves.** `css-migration-plan.md` (this file) gets its own changelog;
  `skill.md` and `react-migration-plan.md` bump when Phases 3 and 6 touch them.

## 9. Effort and sequencing

| Phase | Effort | Depends on |
| --- | --- | --- |
| 0 Instrument and ratchet | 0.5 d | — |
| 1 Extract `tokens.css` | 1 d | 0 |
| 2 Split by family | 2 d | 1 |
| 3 Prefix and rename | 5-7 d | 2 |
| 4 Kill dead rules | 1 d | 2 (benefits from 3) |
| 5 Flatten the cascade | 1-2 d | 2-3 |
| 6 Close out | 0.5 d | all |
| **Total** | **~11-14 developer-days** | |

Sequencing rationale: instrumentation first so every later phase is measurable; tokens before the
split so the split moves declarations rather than magic values; split before renames so renames
happen in small files; dead-rule removal after the split because the coverage report is only
actionable once files are small; cascade flattening last because it is the phase most likely to
change rendering and it benefits from everything before it.

Phases 0-2 (~3.5 d) are the high-value core: they delete the Prettier exclusion, remove the
two-file seam, and make every subsequent feature commit land in a small stylesheet. If the budget
stops there, the panel is still materially better off, and Phase 3 can be scheduled per family
alongside feature work rather than as one block.

## 10. Non-goals

- **A visual redesign.** The panel must look identical; this plan is about where rules live, not
  what they say.
- **A CSS framework or a preprocessor.** `skill.md` §5.3 asks for tokens and per-component sheets,
  both of which plain CSS provides. No Tailwind, no Sass, no CSS-in-JS.
- **Renaming tokens.** Phase 1 moves them verbatim; renaming is a separate, later decision with its
  own review.
- **Touching `background/`.** It renders nothing.
- **Adding a lint toolchain.** The guards are repo-native tests, matching how the previous two
  migrations were enforced.

## Changelog

| Version | Date | Change |
| --- | --- | --- |
| 1.2.0 | 2026-10-02 | Phase 1 landed: the design tokens have one home. The three declaration blocks — dark `:root`, the light `[data-theme="light"]` override and the values both themes share — moved verbatim out of `panel.css` into `src/styles/tokens.css` (names unchanged; this phase renames nothing). A new `src/styles/index.css` imports `tokens.css` → `panel.css` → `shell.css` and is imported by `src/main.jsx`, replacing the `<link>` in `sidepanel.html`, so cascade order is decided in one file instead of being split between the page and the JS; `tests/styles.test.js` now asserts every sheet is imported exactly once, in that order. On top of that the hard-coded colours a token already covered were swapped for the token: 41 `rgba()` tints of `--accent`/`--success`/`--warning`/`--danger` became `color-mix(in srgb, var(--…) N%, transparent)`, and `.rs-error` — the drift the §1 audit named — now derives its border, background and colour from `--danger` like `.selection-delete` does, which is the one intended rendering change (a different red, `#ff6b6b` → `--danger`). Every one of the 28 converted literals was confirmed pixel-identical in Chromium; these are the `color-mix` ↔ `rgba` pairs whose `colorspace` serialisation differs even though the bytes do not, which the §6 comparison must handle by comparing values rather than strings. The ratchet was lowered in the same commit: `colourLiterals` 171 → 65 and `panelCssLines` 2,803 → 2,727; `!important`, depth, `:has()`, tag selectors and un-prefixed classes are unchanged. Full gate green, 322 tests in 38 files, 12 E2E. |
| 1.1.0 | 2026-10-02 | Phase 0 landed: the guards the rest of the migration depends on. `tests/styles.test.js` ratchets seven metrics against `tests/fixtures/css-baseline.json` in both directions — a rise is a regression, and a fall without lowering the baseline fails too, so an improvement cannot be banked and spent silently. `scripts/css-metrics.mjs` is the measurement module and CLI behind it (`npm run css:metrics`, `--baseline`/`--json`/`--verbose`); `scripts/css-coverage.mjs` (`npm run css:coverage`) loads the built `dist/` in Playwright, walks the golden paths and reports which `src/styles/` rules never matched a live element — the empirical dead-rule list Phase 5 will act on. First run: 369 rules from `src/styles`, 222 matched, 133 unexercised, 0 whose classes appear nowhere in `src/`. The tool also corrected the plan's own hand measurement, which had overstated selector depth as 45 (it is 1) and rule counts (`@media` preludes are not rules); the §1 note records the authoritative numbers. No rule changed and no storage or protocol axis moved. |
| 1.0.0 | 2026-10-02 | Initial plan. Measured the legacy stylesheet (2,803 lines / 375 rules / 168 colour literals / 60 `!important` / 45 over-depth selectors) and split the work into a guard-first Phase 0 (ratchet test + Playwright coverage tool), then tokens, family split, prefix rename, dead-rule removal, cascade flattening and close-out. Notes that `shell.css` follows its own invented `rs-` convention rather than §5.3's, that no media queries or ID selectors exist, and that the refactor moves no storage or protocol axis. |
