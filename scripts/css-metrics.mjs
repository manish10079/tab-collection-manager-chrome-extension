// Stylesheet metrics for the CSS migration (css-migration-plan.md, Phase 0).
//
// The Phase 0 ratchet needs numbers that only ever go down, so they have to be measured honestly
// rather than counted with a line grep: `!important` inside a comment, a `:has()` in a declaration
// value or a selector-like string in a comment would all be false positives. So this module walks
// the stylesheet as CSS — tracking brace depth so declaration bodies are skipped and `@keyframes`
// steps (`from`, `to`, `50%`) are not mistaken for selectors — and exposes each metric as a plain
// number. `tests/styles.test.js` ratchets them; `npm run css:metrics` prints them to refresh a
// baseline on purpose.
//
// Pure and dependency-free (skill.md §3.3): it reads text, it touches nothing else.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The directory the CLI measures by default. */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const STYLES_DIR = 'src/styles';

/**
 * The stylesheet allowed to hold colour literals. It does not exist yet — Phase 1 creates it — so
 * every literal counts against the ratchet until then, which is what makes Phase 1 measurable.
 */
export const TOKEN_STYLESHEET = 'tokens.css';

/** The pre-React stylesheet the migration is retiring. It may only shrink, then be deleted. */
export const LEGACY_STYLESHEET = 'panel.css';

/**
 * Prefixes `skill.md` §5.3 recognises, once the Phase 3 amendment writes the full map down. `rs-`
 * is deliberately absent: it is the convention `shell.css` invented for itself, and the plan
 * replaces it with `sh-`, so counting it as known would hide the work.
 */
export const KNOWN_PREFIXES = ['cc-', 'tab-', 'sh-', 'dl-', 'set-', 'ts-', 'ut-'];

/**
 * The metrics the ratchet compares. Each may only decrease; a new one is added to the baseline
 * deliberately, in the commit that needs it.
 */
export const RATCHET_KEYS = [
  'panelCssLines',
  'colourLiterals',
  'important',
  'deepSelectors',
  'tagSelectors',
  'hasSelectors',
  'unprefixedClasses',
];

/**
 * Strip CSS block comments, so a comment cannot inflate a count.
 *
 * @param {string} css
 * @returns {string}
 */
export function stripComments(css) {
  // Comments do not nest, so a single non-greedy pass is enough.
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Lines in a file, counted the way `wc -l` counts them (newlines), so a reader comparing the
 * baseline against the shell cannot end up one out on a file with no trailing newline.
 *
 * @param {string} text
 * @returns {number}
 */
export function countLines(text) {
  return (text.match(/\n/g) ?? []).length;
}

/**
 * Every style rule's selector, as written, with the depth it sits at.
 *
 * A prelude is recorded only when it is a selector: `@media`/`@supports` preludes (and any other
 * at-rule) are skipped because they start with `@`, and anything inside `@keyframes` is skipped
 * because its steps are not selectors.
 *
 * @param {string} css
 * @returns {Array<{selector: string, depth: number}>}
 */
export function parseRules(css) {
  const clean = stripComments(css);
  /** @type {Array<{selector: string, depth: number}>} */
  const rules = [];
  /** @type {Array<{isKeyframes: boolean}>} */
  const stack = [];
  let buffer = '';

  for (const char of clean) {
    if (char === '{') {
      const prelude = buffer.trim();
      buffer = '';
      const inKeyframes = stack.some((frame) => frame.isKeyframes);
      // `[` opens an attribute selector' value, which can contain a `{`; CSS escapes it, so no
      // special case is needed here.
      if (!prelude.startsWith('@') && !inKeyframes) {
        rules.push({ selector: prelude, depth: stack.length });
      }
      stack.push({
        isKeyframes: inKeyframes || /^@(-\w+-)?keyframes/i.test(prelude),
      });
    } else if (char === '}') {
      stack.pop();
      buffer = '';
    } else if (char === ';' && stack.length === 0) {
      buffer = ''; // A top-level at-statement such as `@import …;`
    } else {
      buffer += char;
    }
  }

  return rules;
}

/**
 * Split a selector list on its top-level commas, keeping each part as written. Commas nested in
 * `:is(.a, .b)` or in an attribute value are not separators, so the paren/bracket/quote depth is
 * tracked rather than assumed.
 *
 * @param {string} selector
 * @returns {string[]}
 */
export function splitSelectorList(selector) {
  const parts = [];
  let depth = 0;
  let quote = '';
  let current = '';

  for (const char of selector) {
    if (quote) {
      current += char;
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth = Math.max(0, depth - 1);

    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);

  return parts.map((part) => part.trim()).filter(Boolean);
}

/**
 * The compound selectors of one selector — its parts between combinators (` `, `>`, `+`, `~`).
 * Parenthesised and bracketed content is neutralised first, so a space inside `:not(a b)` or in an
 * attribute value does not read as a descendant combinator.
 *
 * @param {string} selector
 * @returns {string[]}
 */
export function compoundParts(selector) {
  return selector
    .replace(/\([^()]*\)/g, '()')
    .replace(/\[[^\]]*\]/g, '[]')
    .replace(/"[^"]*"/g, '""')
    .split(/\s*[>+~]\s*|\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Whether a compound selector's subject is an element tag rather than a class, id, attribute,
 * pseudo or the universal selector.
 *
 * @param {string} compound
 * @returns {boolean}
 */
export function isTagSelector(compound) {
  return /^[a-zA-Z][a-zA-Z0-9-]*($|[.:[\s])/.test(compound);
}

/**
 * Every distinct class name referenced by these selectors.
 *
 * @param {Array<{selector: string}>} rules
 * @returns {string[]}
 */
export function classNames(rules) {
  const names = new Set();
  for (const rule of rules) {
    for (const match of stripComments(rule.selector).matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
      names.add(match[1]);
    }
  }
  return [...names].sort();
}

/** @param {string} name */
export function isPrefixed(name) {
  return KNOWN_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/**
 * Every `.css` file in the styles directory, with its text.
 *
 * @param {string} [stylesDir]
 * @returns {Promise<Array<{file: string, css: string}>>}
 */
export async function listStylesheets(stylesDir = path.join(ROOT, STYLES_DIR)) {
  const entries = await readdir(stylesDir, { withFileTypes: true });
  const sheets = [];
  for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith('.css'))) {
    sheets.push({
      file: entry.name,
      css: await readFile(path.join(stylesDir, entry.name), 'utf8'),
    });
  }
  return sheets.sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * Measure a set of stylesheets.
 *
 * The ratcheted numbers sit at the top level; the rest is context for whoever reads a failure, and
 * is deliberately not compared — a legitimate new feature adds rules and lines, which would make a
 * ratcheted `rules` count fail for the wrong reason.
 *
 * @param {Array<{file: string, css: string}>} sheets
 * @param {string} [measuredAt] ISO date for the baseline
 * @returns {Record<string, any>}
 */
export function measure(sheets, measuredAt = new Date().toISOString().slice(0, 10)) {
  const legacy = sheets.find((sheet) => sheet.file === LEGACY_STYLESHEET);
  const owned = sheets.filter((sheet) => sheet.file !== LEGACY_STYLESHEET);

  const colourLiteralsByFile = {};
  let important = 0;
  let deepSelectors = 0;
  let tagSelectors = 0;
  let hasSelectors = 0;
  let rules = 0;
  let totalLines = 0;

  for (const sheet of sheets) {
    const clean = stripComments(sheet.css);
    rules += parseRules(sheet.css).length;
    totalLines += countLines(sheet.css);
    // A token file is where literals belong; everything else must consume `var(--…)`.
    if (sheet.file !== TOKEN_STYLESHEET) {
      const literals = clean.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g) ?? [];
      colourLiteralsByFile[sheet.file] = literals.length;
    }
    important += clean.match(/!important/g)?.length ?? 0;
    hasSelectors += clean.match(/:has\(/g)?.length ?? 0;

    for (const rule of parseRules(sheet.css)) {
      for (const single of splitSelectorList(rule.selector)) {
        const parts = compoundParts(single);
        if (parts.length > 3) deepSelectors += 1;
        if (parts.length > 0 && isTagSelector(parts[0])) tagSelectors += 1;
      }
    }
  }

  const unprefixedNames = classNames(owned.flatMap((sheet) => parseRules(sheet.css))).filter(
    (name) => !isPrefixed(name)
  );

  return {
    measuredAt,
    panelCssLines: legacy ? countLines(legacy.css) : 0,
    colourLiterals: Object.values(colourLiteralsByFile).reduce((total, n) => total + n, 0),
    important,
    deepSelectors,
    tagSelectors,
    hasSelectors,
    unprefixedClasses: unprefixedNames.length,
    info: {
      stylesheets: sheets.map((sheet) => sheet.file),
      rules,
      totalLines,
      colourLiteralsByFile,
      unprefixedClassNames: unprefixedNames,
    },
  };
}

/** Measure the repository's stylesheets. @returns {Promise<Record<string, any>>} */
export async function measureRepository() {
  return measure(await listStylesheets());
}

/**
 * Compare a measurement against a baseline.
 *
 * Both directions fail on purpose. A metric that rose is a regression; a metric that fell means
 * the baseline is stale, and leaving it stale would let the next commit spend the improvement.
 *
 * @param {Record<string, any>} actual
 * @param {Record<string, any>} baseline
 * @returns {{regressions: string[], stale: string[]}}
 */
export function compareToBaseline(actual, baseline) {
  const regressions = [];
  const stale = [];
  for (const key of RATCHET_KEYS) {
    const before = baseline[key];
    const now = actual[key];
    if (typeof before !== 'number' || typeof now !== 'number') continue;
    if (now > before) regressions.push(`${key}: ${before} → ${now}`);
    else if (now < before) stale.push(`${key}: ${before} → ${now}`);
  }
  return { regressions, stale };
}

/**
 * The baseline shape written to `tests/fixtures/css-baseline.json`: the ratcheted numbers plus the
 * context that makes them reviewable.
 *
 * @param {Record<string, any>} metrics
 * @returns {Record<string, any>}
 */
export function toBaseline(metrics) {
  /** @type {Record<string, any>} */
  const baseline = {
    note:
      'CSS migration ratchet (css-migration-plan.md, Phase 0). These numbers may only go DOWN. ' +
      'A rise is a regression; a fall means this file is stale and must be lowered in the same ' +
      'commit — the intention is that progress can never be spent silently. `info` is context and ' +
      'is not compared: a legitimate feature adds rules and lines, so those are not ratcheted.',
    measuredAt: metrics.measuredAt,
    version: 1,
  };
  for (const key of RATCHET_KEYS) baseline[key] = metrics[key];
  baseline.info = metrics.info;
  return baseline;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const metrics = await measureRepository();

  if (args.has('--baseline')) {
    console.log(JSON.stringify(toBaseline(metrics), null, 2));
    return;
  }

  if (args.has('--json')) {
    console.log(JSON.stringify(metrics, null, 2));
    return;
  }

  const { info } = metrics;
  console.log(
    `[css] stylesheets        ${info.stylesheets.length} (${info.stylesheets.join(', ')})`
  );
  console.log(`[css] rules / lines      ${info.rules} rules, ${info.totalLines} lines`);
  for (const key of RATCHET_KEYS) {
    console.log(`[css] ${key.padEnd(20)} ${metrics[key]}`);
  }
  const colours = Object.entries(info.colourLiteralsByFile)
    .map(([file, count]) => `${file} ${count}`)
    .join(', ');
  console.log(`[css] colour literals    ${colours}`);
  if (info.unprefixedClassNames.length > 0 && args.has('--verbose')) {
    console.log(`[css] unprefixed classes ${info.unprefixedClassNames.join(', ')}`);
  }
}

// Only run when invoked directly, so the test can import the functions without the CLI output.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('[css] failed:', error.message);
    process.exitCode = 1;
  });
}
