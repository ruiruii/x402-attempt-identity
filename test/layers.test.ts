import test from 'node:test';
import assert from 'node:assert/strict';
import { ATTEMPT_IDENTITY_FIELDS, deriveAttemptId, hashCanonical } from '../src/identity.js';
import { jcsCanonicalize } from '../src/jcs.js';
import { signedArtifactReference } from '../src/signedref.js';
import { deriveReceiptId } from '../src/receipt.js';

/**
 * SPEC-13 and SPEC-14: the two halves of "request layer vs outcome layer",
 * plus the one place where the wire-byte rule reverses.
 */

const base = {
  version: 'x402-attempt-identity/1',
  method: 'POST',
  path: '/v1/translate',
  query: '',
  bodyDigest: 'ab'.repeat(32),
  payTo: '0xAbCdEf0000000000000000000000000000000001',
  asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  network: 'eip155:8453',
  amount: '10000',
  scheme: 'exact',
};

test('SPEC-13: nothing produced after ingress reaches the attempt identity', () => {
  // Cast, because the interesting part is the runtime assertion. Worth noting
  // what the cast is hiding: without it, `ATTEMPT_IDENTITY_FIELDS.includes(
  // 'issuedAt')` fails to compile at all — the literal union has no such
  // member, so an implementation cannot even ask whether an outcome field is
  // in the set. The compiler rejects the question, not just the answer.
  const fields = ATTEMPT_IDENTITY_FIELDS as readonly string[];
  assert.ok(!fields.includes('issuedAt'));
  assert.ok(!fields.includes('transaction'));
  assert.ok(!fields.includes('resultDigest'));
  assert.ok(!fields.includes('deliveredMeasurements'));

  // And the set carries request content, so two attempts that differ in what
  // was requested cannot share one identity.
  const a = deriveAttemptId(base);
  const b = deriveAttemptId({ ...base, amount: '20000' });
  assert.notEqual(a, b);
});

test('SPEC-13: request layer and outcome layer are two named sets, one operation', () => {
  const receipt = (issuedAt: string) =>
    deriveReceiptId({
      version: 'x402-receipt/2',
      network: 'eip155:8453',
      resourceUrl: 'https://api.example/v1/translate',
      payer: '0xabcDEF0000000000000000000000000000000002',
      issuedAt,
    });

  // Same operation (named fields -> JCS -> SHA-256), different sets. The
  // attempt names the request; the receipt states a fact that has happened.
  assert.notEqual(deriveAttemptId(base), receipt('2026-10-01T10:00:00Z'));

  // The receipt set carries the outcome timestamp and no request content. So
  // request content cannot reach it: there is no slot to put it in, and an
  // implementation that folded it in would produce an identifier no
  // counterparty holding only the receipt could recompute.
  assert.equal(receipt('2026-10-01T10:00:00Z'), receipt('2026-10-01T10:00:00Z'));

  // The outcome timestamp does distinguish two facts about one resource.
  assert.notEqual(receipt('2026-10-01T10:00:00Z'), receipt('2026-10-01T10:00:01Z'));
});

test('SPEC-14: a signed reference is taken over transmitted bytes', () => {
  // An artifact as transmitted, with keys in the order the producer emitted.
  const transmitted = '{"b":1,"a":2}';
  const reference = signedArtifactReference(transmitted);

  // Canonicalizing it first produces a different digest — and that digest
  // names an object nobody signed.
  const canonicalized = jcsCanonicalize(JSON.parse(transmitted));
  assert.notEqual(canonicalized, transmitted);
  assert.notEqual(hashCanonical(JSON.parse(transmitted)), reference);

  // Which is why the two rules must not be swapped: the attempt's own
  // identity survives a key order change, a reference to a signed artifact
  // does not, because the signature does not.
  const reordered = '{"a":2,"b":1}';
  assert.equal(signedArtifactReference(reordered), hashCanonical(JSON.parse(reordered)));
  assert.notEqual(signedArtifactReference(reordered), reference);
});
