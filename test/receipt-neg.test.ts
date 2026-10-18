import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { jcsCanonicalize } from '../src/jcs.js';
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

test('NEG-4 (decode order): normalizing the text instead of the values', () => {
  // Lowercasing the serialized JSON before parsing is the cheap way to satisfy
  // N1. It does three separate kinds of damage, and none of them raises.
  const lowered = JSON.parse(JSON.stringify(PAYLOAD).toLowerCase());

  // (a) the key is destroyed, so the member is silently absent — and under R2
  // an absent member is omitted rather than nulled, which is correct behaviour
  // applied to a value that should never have been missing.
  assert.equal(lowered.resourceUrl, undefined);
  const keyDestroyed = deriveReceiptId({
    version: lowered.version,
    network: lowered.network,
    resourceUrl: lowered.resourceUrl,
    payer: lowered.payer,
    issuedAt: lowered.issuedAt,
  });
  assert.notEqual(keyDestroyed, CORRECT);
  assert.equal(keyDestroyed, 'ae47e7509030ebcd5f169d8f478cdd8ca805c815d8870e73a483f8b692c3abc3');

  // (b) reaching for the lowercased key gets the member back but mangles the
  // value, which is exactly what N4 exists to prevent: path and query casing
  // can be semantically significant.
  assert.equal(lowered.resourceurl, 'https://api.example/v1/translate?text=hello');
  const valueMangled = deriveReceiptId({
    version: lowered.version,
    network: lowered.network,
    resourceUrl: lowered.resourceurl,
    payer: lowered.payer,
    issuedAt: lowered.issuedAt,
  });
  assert.notEqual(valueMangled, CORRECT);
  assert.notEqual(valueMangled, keyDestroyed);
  assert.equal(valueMangled, 'ccc8f2332e2acf6fe02ac2d5f6e74895569844e5d14d87ce4adbba469514e19d');

  // (c) and it takes the timestamp with it — the key is gone too, and the
  // value has lost the delimiters N3 depends on. Both are silent.
  assert.equal(lowered.issuedAt, undefined);
  assert.equal(lowered.issuedat, '2026-10-01t10:00:00z');
});

test('NEG-3 and NEG-4 are distinct from each other and from every published value', () => {
  const neg = [
    '13583b72bd106dfa8ad5a8dd21971e683a7bacf8cb334ce5ddd06462ab386a1f',
    'ae47e7509030ebcd5f169d8f478cdd8ca805c815d8870e73a483f8b692c3abc3',
    'ccc8f2332e2acf6fe02ac2d5f6e74895569844e5d14d87ce4adbba469514e19d',
  ];
  assert.notEqual(new Set([...neg, CORRECT]).size, neg.length + 1 - 1, 'all four must be distinct');
  assert.equal(new Set([...neg, CORRECT]).size, neg.length + 1);
});
