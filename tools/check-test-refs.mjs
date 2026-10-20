#!/usr/bin/env node
/**
 * Every backticked identifier on a `*Test:*` line must resolve to something
 * that exists. Written because the reverse check was skipped twice: `grep` for
 * a removed test name finds nothing only if you think to run it.
 *
 * Three kinds of reference are legal on a Test: line:
 *   1. a test title, matched exactly against `test('…'`;
 *   2. a vector id (POS-…, NEG-…, V…), which lives in the conformance set;
 *   3. a path or an example value, which is not an identifier at all.
 *
 * Anything else is reported. The rule is blunt on purpose: a reference with no
 * referent reads exactly like one with a referent, and only a machine tells
 * them apart.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SPEC = 'specs/xps/0000-attempt-identity.md';
const spec = readFileSync(SPEC, 'utf8');

const titles = new Set();
let testSrc = '';
for (const f of readdirSync('test')) {
  if (!f.endsWith('.test.ts')) continue;
  const src = readFileSync(join('test', f), 'utf8');
  testSrc += src;
  for (const m of src.matchAll(/test\('([^']+)'/g)) titles.add(m[1]);
}

const VECTOR = /^(POS|NEG|V|R)[0-9-]/;
// A vector id is legal shorthand for a test title, and the way to tell whether
// it names one is the character that follows it in the title. In
//   \`POS-1: all five downstream paths…\`   the next char is ':'  -> names it
//   \`POS-1b: refusal resolves…\`          the next char is 'b'  -> different id
// so \`POS-1\` resolves and \`NEG-1\` does not, even though both appear as prefixes.
// The earlier version asked "is this a unique prefix", which is the wrong
// question: \`POS-1\` has three titles starting with it and names exactly one.
const DELIM = new Set([':', ' ', '\u2014', '\u2013', '-', '(']);
const resolvesAsId = (t) => {
  if (!VECTOR.test(t)) return false;
  const hits = [...titles].filter(
    (title) => title.startsWith(t) && DELIM.has(title[t.length]),
  );
  return hits.length === 1;
};
// Rule names (N1, N2b), field names (network, issuedAt) and code identifiers are
// not test references. They appear on Test: lines as shorthand for which rule a
// test exercises, and an earlier version of this checker flagged them all.
const NOT_A_TITLE = /^([A-Z][0-9][a-z]?|[a-z][A-Za-z0-9]*|[A-Z][A-Za-z0-9]+)$/;
const NOT_AN_ID = (t) =>
  t.includes('/') || t.startsWith('{') || t.endsWith('.json') || t.includes('://') ||
  // A constant declared in the test source is not a test title, and it is not a
  // vector id either. It resolves or it does not, but not against this list.
  new RegExp(`\\b(const|let)\\s+${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(testSrc);

// "the vector `NEG-2` (…)" labels that token as a vector id. The label has to be
// the word immediately before the backtick: searching the whole line accepted a
// renamed test whenever an unrelated `V1` elsewhere in the line said "vector".
const labelledAsVector = (t, line) => {
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('\\bvector(?: id)?\\s+`' + esc + '`', 'i').test(line);
};

let checked = 0;
const unresolved = [];
for (const line of spec.split('\n')) {
  if (!line.includes('*Test:*')) continue;
  for (const m of line.matchAll(/`([^`]+)`/g)) {
    const t = m[1];
    checked++;
    if (titles.has(t) || NOT_AN_ID(t) || NOT_A_TITLE.test(t)) continue;
    if (resolvesAsId(t)) continue;
    // An id the prose labels as a vector id in the same clause is legal even
    // when no test carries it: `NEG-4a` is an id inside `NEG4_PUBLISHED`, not a
    // title. The label has to be adjacent — a blanket `spec.includes('vector
    // id')` let a renamed test through, because the spec says the phrase
    // somewhere and a whole-document search cannot tell where.
    if (VECTOR.test(t) && labelledAsVector(t, line)) continue;
    unresolved.push(`${t}  <-- ${line.trim().slice(0, 80)}`);
  }
}

if (unresolved.length) {
  console.error(`${unresolved.length} unresolved reference(s) of ${checked} checked:`);
  for (const u of unresolved) console.error('  ' + u);
  process.exit(1);
}
console.log(`${checked} references on *Test:* lines, all resolved (${titles.size} test titles known).`);
