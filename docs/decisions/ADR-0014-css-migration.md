# ADR-0014: The panel's styles are split into tokens and family sheets

- Status: accepted
- Date: 2026-10-02
- Context: `css-migration-plan.md` (Phases 0-6), `src/styles/`, `tests/styles.test.js`,
  `tests/fixtures/css-baseline.json`, `scripts/css-coverage.mjs`, `scripts/css-probe.mjs`,
  `skill.md` §3.1 and §5.3

## Context

The React migration replaced the panel's markup and behaviour, but not its styling. The pre-React
`panel.css` — roughly 2,800 lines and 375 rules — still carried the whole visual language, loaded
beside a small React-owned `shell.css` that had invented a class prefix (`rs-`) `skill.md` never
defined. The seam had a measurable cost: every styling defect in the 2.1/2.2 line traced to it,
including a folder menu whose `:has()` stacking fix covered `.collection` but not `.folder`, and
nested collections that picked up grid-card layout because
`.collections-container.grid-view .collection` is a descendant selector.

The file also carried the escape hatches a 2,800-line cascade accumulates: **60** `!important`s,
**7** `:has()` stacking workarounds, one selector four combinators deep (past §5.3's limit), 168
hand-written colour literals, and a Prettier exclusion that made it the one unformatted file in the
repository.

## Decision

### Tokens get one home

- Every `--*` declaration moves into `src/styles/tokens.css` — the dark `:root`, the light
  `[data-theme="light"]` override, and the values both themes share — with the names unchanged. It is
  the only sheet allowed to declare a raw colour (Phase 1).
- The literals a token already covered become `color-mix(in srgb, var(--…) N%, transparent)`. Chrome
  serialises a `color-mix()` as `color(srgb …)`, so any comparison has to key on the resolved colour
  value rather than the string — which is why `scripts/css-probe.mjs` canonicalises every colour to
  8-bit `rgb(r g b / a)` before diffing.

### The stylesheet is split by feature family, then renamed by family

- `panel.css` is cut along its own section map into `base`, `shell`, `collections`, `tabs`,
  `dialogs`, `settings` and `toast`, with `tokens.css` first and every sheet imported in one
  documented order by `src/styles/index.css` (Phase 2). Because CSS resolves ties by source order,
  the split was checked against a computed-style diff rather than assumed cascade-neutral.
- The prefix map `skill.md` §5.3 named only partly is written down as a closed set — `cc-`
  collections, `tab-` tab rows, `sh-` shell, `dl-` dialogs, `set-` settings, `ts-` toasts, `ut-`
  shared utilities — and applied one family per commit, JSX and CSS together (Phase 3). The invented
  `rs-` is retired in favour of `sh-`.

### The escape hatches go, and a ratchet keeps them gone

- The `!important`s are replaced by correctly-scoped selectors or by source order; the `:has()`
  stacking fixes collapse to `:focus-within` on the open menu's ancestor; the over-depth selector is
  flattened (Phase 5). `.hidden` becomes `.hidden.hidden`, a specificity floor that needs no
  `!important`.
- `tests/styles.test.js` ratchets the §5.3-facing metrics against
  `tests/fixtures/css-baseline.json` in **both** directions: a regression fails, and an unrecorded
  improvement fails too, so a gain cannot be spent silently later.
- The two tools that make the refactor safe are committed rather than ad hoc:
  `scripts/css-coverage.mjs` drives the built extension and reports which rules never match a live
  element, so dead rules are deleted from evidence rather than by grep (Phase 4); and
  `scripts/css-probe.mjs` diffs resolved computed styles across a fixed set of panel states against a
  committed baseline, so a cascade change no unit test can see is caught (Phase 6).

### The legacy sheet is retired, not kept as a fallback

- `panel.css` is deleted outright. Keeping it beside the family sheets would leave two cascades to
  reason about and a second place a rule could hide; the coverage and probe tools are what make the
  deletion safe, not a fallback.
- The retirement is asserted rather than trusted: `tests/styles.test.js` checks the file is gone and
  that nothing live — sources, build scripts, config or the page — names it again. The plans, ADRs
  and changelogs that record the retirement keep the name as append-only history.

## Consequences

- Cascade order is decided in exactly one place (`index.css`) and asserted by a test, so a new sheet
  cannot silently reorder it.
- A class name now says which family owns it, and each sheet is small enough to read; a rename is one
  family per commit instead of one 2,800-line edit.
- The panel renders identically — the computed-style probe and the E2E suite are the evidence — so
  the refactor moves no user-visible behaviour, no storage shape, no message and no manifest field.
  The extension version does not move for it (skill.md §7).
- The cost is indirection: a rule now lives in a family sheet, not one greppable file, so finding it
  means knowing the family. The prefix map and the one-entry import order are what make that
  predictable.

## Alternatives considered

- **Keep `panel.css` and layer React CSS on top.** Rejected: that was the status quo, and the seam
  was the source of every styling bug in the 2.1/2.2 line — two cascades to reason about with no
  declaration of which wins.
- **A CSS framework or preprocessor (Tailwind, Sass, CSS-in-JS).** Rejected: `skill.md` §5.3 asks for
  tokens and per-component sheets, both of which plain CSS provides; the refactor changes where rules
  live, not what they are written in.
- **Rename every class in one commit.** Rejected: a rename is a breaking change between a component
  and its stylesheet, so doing all seven families at once would leave a window where large parts of
  the panel render unstyled. One family per commit keeps each rename reviewable and revertible.
- **Delete dead rules from the coverage report without extending the walk first.** Rejected: the
  report was lying about reachability (it sampled dialogs only after they closed), so the walk was
  fixed and re-run before anything was deleted — and the matched set was proven unchanged.
- **Rename the design tokens while moving them.** Rejected: Phase 1 moves them verbatim so the move
  is provably behaviour-neutral; renaming is a separate decision with its own review.
