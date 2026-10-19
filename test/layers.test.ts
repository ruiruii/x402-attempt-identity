import test from 'node:test';
import assert from 'node:assert/strict';
import { ATTEMPT_IDENTITY_FIELDS, deriveAttemptId, hashCanonical } from '../src/identity.js';
import { jcsCanonicalize } from '../src/jcs.js';
import {
  capturedArtifactDigest,
  signedArtifactReference,
  signedContentIdentifier,
  type ReferenceDeclaration,
  type TransmittedArtifact,
} from '../src/signedref.js';
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

const BYTES: ReferenceDeclaration = {
  covers: 'captured',
  input: 'transmitted-bytes',
  version: '1',
};

const TYPED: ReferenceDeclaration = {
  covers: 'signed-content',
  input: 'eip712-typed-fields',
  version: '1',
};

test('SPEC-14: a captured reference is taken over transmitted bytes', () => {
  // An artifact as transmitted, with keys in the order the producer emitted.
  const transmitted = '{"b":1,"a":2}';
  const reference = signedArtifactReference({ bytes: transmitted }, BYTES);

  // Canonicalizing it first produces a different digest — and that digest
  // names an object nobody signed.
  const canonicalized = jcsCanonicalize(JSON.parse(transmitted));
  assert.notEqual(canonicalized, transmitted);
  assert.notEqual(hashCanonical(JSON.parse(transmitted)), reference);

  // Which is why the two rules must not be swapped: the attempt's own
  // identity survives a key order change, a captured digest does not,
  // because the signature does not.
  const reordered = '{"a":2,"b":1}';
  assert.equal(
    signedArtifactReference({ bytes: reordered }, BYTES),
    hashCanonical(JSON.parse(reordered)),
  );
  assert.notEqual(signedArtifactReference({ bytes: reordered }, BYTES), reference);
});

test('SPEC-14: two serializations of one signed message', () => {
  // The control: identical signed content, two wire forms. The keys are not in
  // canonical order, so the wire form is not the canonical form for either.
  const message = {
    fields: { payTo: '0xabc', amount: '10000' },
    domain: { name: 'Offer' },
  };
  const compact = JSON.stringify(message);
  const pretty = JSON.stringify(message, null, 2);
  assert.notEqual(compact, pretty);
  assert.notEqual(compact, jcsCanonicalize(message));

  // The capture digests differ, because two captures are two byte strings.
  assert.notEqual(capturedArtifactDigest(compact), capturedArtifactDigest(pretty));

  // The signed-content identifier is the same, because a scheme that signs a
  // message does not sign its serialization.
  assert.equal(
    signedContentIdentifier({ bytes: compact, message }, TYPED),
    signedContentIdentifier({ bytes: pretty, message }, TYPED),
  );

  // And the errors point opposite ways: hashing the wire envelope for a
  // typed-field scheme produces a value the signature check cannot honour,
  // exactly as canonicalizing first produces one a byte-signer cannot.
  assert.notEqual(
    signedContentIdentifier({ bytes: compact, message }, TYPED),
    capturedArtifactDigest(compact),
  );
  assert.notEqual(
    signedContentIdentifier({ bytes: pretty, message }, TYPED),
    capturedArtifactDigest(pretty),
  );

  // A message-signing recipe over an artifact that carries no message is an
  // error, not a fallback to the bytes.
  assert.throws(() => signedContentIdentifier({ bytes: compact }, TYPED), TypeError);
});

test('SPEC-14: a reference cannot be computed without a declaration', () => {
  // There is no overload taking only the artifact. The cast hides the point:
  // without it the call does not compile, because the format decides what was
  // signed and this code is not entitled to guess.
  const f = signedArtifactReference as unknown as (a: TransmittedArtifact) => string;
  assert.throws(() => f({ bytes: '{"a":1}' }), TypeError);
});
