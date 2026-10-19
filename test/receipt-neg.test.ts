import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { jcsCanonicalize } from '../src/jcs.js';
import { normalizeIssuedAt, normalizeResourceUrl } from '../src/normalize.js';
import { deriveReceiptId } from '../src/receipt.js';

/**
 * The two negative vectors promised in x402#3821: field set, and decode order.
 *
 * Both classes share the property that makes them worth publishing: each
 * produces a well-formed hex digest that its author has no way to tell apart
 * from a correct one. Nothing throws, nothing is empty, and the value will
 * agree with itself forever. That is what "looks right" means here.
 */

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

const PAYLOAD = {
  version: 'x402-receipt/2',
  network: 'eip155:8453',
  resourceUrl: 'https://api.example/v1/Translate?Text=Hello',
  payer: '0xAbCdEf0000000000000000000000000000000001',
  payTo: '0x1111111111111111111111111111111111111111',
  issuedAt: '2026-10-01T10:00:00Z',
  transaction: '0xdeadbeef',
};

const CORRECT = deriveReceiptId({
  version: PAYLOAD.version,
  network: PAYLOAD.network,
  resourceUrl: PAYLOAD.resourceUrl,
  payer: PAYLOAD.payer,
  issuedAt: PAYLOAD.issuedAt,
});

test('NEG-3 (field set): hashing the whole decoded payload is not the same operation', () => {
  // It looks safer — nothing is omitted — and it is wrong for a structural
  // reason: the identifier then depends on every member the payload happens to
  // carry, so adding one optional member rewrites every identifier issued
  // before the change.
  const fullPayload = sha256(jcsCanonicalize(PAYLOAD));
  assert.notEqual(fullPayload, CORRECT);
  assert.equal(fullPayload, '13583b72bd106dfa8ad5a8dd21971e683a7bacf8cb334ce5ddd06462ab386a1f');

  const withOptional = sha256(jcsCanonicalize({ ...PAYLOAD, facilitator: 'https://fac.example' }));
  assert.notEqual(withOptional, fullPayload, 'the full-payload form drifts when a member is added');
  assert.equal(
    deriveReceiptId({
      version: PAYLOAD.version,
      network: PAYLOAD.network,
      resourceUrl: PAYLOAD.resourceUrl,
      payer: PAYLOAD.payer,
      issuedAt: PAYLOAD.issuedAt,
    }),
    CORRECT,
    'the named-subset form does not',
  );
});

/**
 * NEG-4 (decode order): normalizing the text instead of the values.
 *
 * Lowercasing the serialized JSON before parsing is the cheap way to satisfy
 * N1. It does three separate kinds of damage, and none of them raises — and
 * four different objects can be read out of the phrase "read the lowercased
 * key". All four are published below, because that is the finding.
 *
 * A published vector is the triple **(input, operation, expected)**. Published
 * as (name, expected) it is not reproducible, because a name does not
 * determine an input. Three independent readers — including one of ours —
 * produced three different objects from the same sentence. Our own error is
 * recorded here rather than quietly corrected: `ccc8f233` was published under
 * the name NEG-4b and described as "value present and mangled". It is neither.
 * The number was right for an input we did not name; the name described an
 * input we did not compute.
 */
const loweredRaw = JSON.parse(
  JSON.stringify(PAYLOAD).toLowerCase(),
) as Record<string, string | undefined>;

/** The members as they survive the lowercase, indexed by the key they now have. */
const LOWERED = {
  version: loweredRaw['version'] as string,
  network: loweredRaw['network'] as string,
  payer: loweredRaw['payer'] as string,
  resourceurl: loweredRaw['resourceurl'] as string,
  issuedat: loweredRaw['issuedat'] as string,
};

/** Every published NEG-4 input, as the exact object handed to the hash. */
const NEG4 = {
  /** resourceUrl and issuedAt both read by their original keys: both absent. */
  a: { version: LOWERED.version, network: LOWERED.network, payer: LOWERED.payer },
  /** All five read by their lowercased keys, N1-N5 applied. */
  b: {
    version: LOWERED.version,
    network: LOWERED.network,
    payer: LOWERED.payer,
    resourceUrl: LOWERED.resourceurl,
    issuedAt: LOWERED.issuedat,
  },
  /** All five by their lowercased keys, N3 skipped. */
  c: {
    version: LOWERED.version,
    network: LOWERED.network,
    payer: LOWERED.payer,
    resourceUrl: LOWERED.resourceurl,
    issuedAt: '2026-10-01t10:00:00z',
  },
  /** resourceUrl by its lowercased key, issuedAt by its original key. */
  d: {
    version: LOWERED.version,
    network: LOWERED.network,
    payer: LOWERED.payer,
    resourceUrl: LOWERED.resourceurl,
  },
} as const;

const NEG4_PUBLISHED = {
  a: 'ae47e7509030ebcd5f169d8f478cdd8ca805c815d8870e73a483f8b692c3abc3',
  b: 'fe714ba1f47c7152dbd37762c968637ad6005caf79a6c3f99a5d1104743938a6',
  c: '2e9dcd1bfe51bb9161e2b896c0eab53b860fef2194be6619e5785a64d4b68ab3',
  d: 'ccc8f2332e2acf6fe02ac2d5f6e74895569844e5d14d87ce4adbba469514e19d',
} as const;

test('NEG-4 (decode order): normalizing the text instead of the values', () => {
  // Lowercasing the serialized JSON before parsing destroys the keys, so
  // `resourceUrl` and `issuedAt` are both no longer reachable by name.
  assert.equal(loweredRaw['resourceUrl'], undefined);
  assert.equal(loweredRaw['issuedAt'], undefined);
  assert.equal(LOWERED.resourceurl, 'https://api.example/v1/translate?text=hello');
  assert.equal(LOWERED.issuedat, '2026-10-01t10:00:00z');

  // (a) under R2 an absent member is omitted rather than nulled, so both
  // members vanish and the identifier is computed over three. Nothing raised.
  assert.equal(deriveReceiptId(NEG4.a), NEG4_PUBLISHED.a);

  // (b) reaching for the lowercased keys gets both members back. resourceUrl
  // stays mangled — that is what N4 exists to prevent — but issuedAt is
  // repaired by N3, because RFC 3339 permits lowercase t and z.
  assert.equal(deriveReceiptId(NEG4.b), NEG4_PUBLISHED.b);
  assert.equal(normalizeIssuedAt('2026-10-01t10:00:00z'), '2026-10-01T10:00:00Z');

  // (c) the same five members with N3 skipped. This is the value an
  // independent reproducer reached from the published name, and it is a
  // correct hash of a correct object — just not the one the name described.
  assert.equal(sha256(jcsCanonicalize(NEG4.c)), NEG4_PUBLISHED.c);

  // (d) the hybrid: resourceUrl recovered and mangled, issuedAt lost. This is
  // what our own test was actually computing when it claimed (b).
  assert.equal(deriveReceiptId(NEG4.d), NEG4_PUBLISHED.d);

  for (const k of ['a', 'b', 'c', 'd'] as const) {
    assert.notEqual(NEG4_PUBLISHED[k], CORRECT, `NEG-4${k} must differ from the correct value`);
  }
});

test('the damage NEG-4 does is not uniform across members', () => {
  // resourceUrl is damaged permanently; issuedAt is repaired by a conformant
  // N3. So the recovery of a manged record depends on which member you look
  // at, and "the record is mangled" is not one fact.
  assert.notEqual(NEG4_PUBLISHED.b, NEG4_PUBLISHED.c, 'with and without N3 are different');
  assert.equal(normalizeIssuedAt(LOWERED.issuedat), PAYLOAD.issuedAt);
  assert.notEqual(normalizeResourceUrl(LOWERED.resourceurl), PAYLOAD.resourceUrl);
});

test('NEG-3 and NEG-4 are distinct from each other and from every published value', () => {
  const neg = [
    '13583b72bd106dfa8ad5a8dd21971e683a7bacf8cb334ce5ddd06462ab386a1f',
    ...Object.values(NEG4_PUBLISHED),
  ];
  assert.equal(
    new Set([...neg, CORRECT]).size,
    neg.length + 1,
    'all five negative values and the correct value must be mutually distinct',
  );
});
