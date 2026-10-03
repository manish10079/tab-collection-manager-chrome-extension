import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The working tree is LF everywhere, and `.gitattributes` is what keeps it that way.
 *
 * `.editorconfig` asks for `end_of_line = lf`, but that is only an editor hint — Git is not obliged
 * to honour it. Without the attribute below, a Windows clone with `core.autocrlf=true` checks text
 * files out as CRLF while the committed blobs stay LF, so Prettier (`endOfLine: "lf"`) flags every
 * file nobody actually edited — 37 of them on an otherwise clean tree. CI runs on Linux, where
 * `core.autocrlf` is already off, so the formatting gate stayed green while the failure was local
 * to Windows.
 *
 * The attribute is the whole fix: it takes precedence over `core.autocrlf` and `core.eol`, and
 * `text=auto` normalises on the way into the index, so a CRLF blob cannot be committed either. These
 * tests exist to stop the rule being deleted or narrowed, which would quietly bring CRLF back the
 * next time someone cloned on Windows.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const attributes = readFileSync(path.join(ROOT, '.gitattributes'), 'utf8');

describe('line endings', () => {
  it('pins every path to LF with a catch-all text=auto eol=lf rule', () => {
    expect(attributes).toMatch(/^\*\s+text=auto\s+eol=lf\s*$/m);
  });

  it('leaves the binary assets unnormalised', () => {
    for (const extension of ['png', 'ttf', 'woff2']) {
      expect(attributes, `*.${extension} is not marked binary`).toMatch(
        new RegExp(`^\\*\\.${extension}\\s+binary\\s*$`, 'm')
      );
    }
  });
});
