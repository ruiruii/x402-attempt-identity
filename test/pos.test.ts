import { test } from 'node:test';
import assert from 'node:assert/strict';

import { captureAtIngress, canonicalQuery, type DecodedRequest } from '../src/ingress.js';
import { DOWNSTREAM_PATHS, refusal, scopeAt } from '../src/paths.js';
import { idempotencyScope } from '../src/scope.js';
import { deriveAttemptId } from '../src/identity.js';

const BASE = {
  version: '1',
  method: 'POST',
  network: 'eip155:8453',
  path: '/v1/report',
  payTo: '0x8ba1f109551bD432803012645Ac136ddd64DBA72',
  asset: 'USDC',
  amount: '1000000',
  scheme: 'exact',
};

const request: DecodedRequest = { ...BASE, query: { a: '1', b: '2' }, body: { amount: '1' } };

/** The identity named set, for the derivation tests that call it directly. */
const IDENTITY_BASE = {
  ...BASE,
  query: 'a=1&b=2',
  bodyDigest: 'deadbeef',
};

/**
 * POS-1. The compliant behaviour, stated as a test: one interaction, one value
 * across every downstream consumer. Re-evaluation of a pure function over
 * frozen inputs is expected; a second identity is not.
 */
test('POS-1: all five downstream paths resolve one value', () => {
  const frozen = captureAtIngress(request);
  const scopes = DOWNSTREAM_PATHS.map((p) => scopeAt(frozen, p));
  assert.equal(new Set(scopes).size, 1, 'five call sites produced more than one scope');
});

test('POS-1b: refusal resolves the same value as the settle path', () => {
  const frozen = captureAtIngress(request);
  assert.equal(refusal(frozen).scope, scopeAt(frozen, 'settleOrChallengeQuote'));
  assert.equal(refusal(frozen).settled, false);
});

test('POS-1c: re-invoking the scope function is stable across many calls', () => {
  const frozen = captureAtIngress(request);
  const first = idempotencyScope(frozen);
  for (let i = 0; i < 50; i += 1) {
    assert.equal(idempotencyScope(frozen), first);
  }
});

test('attempt identity comes from named decoded fields, not wire bytes', () => {
  const asReceived = captureAtIngress({ ...request, body: { x: 1, y: 2 } });
  const reordered = captureAtIngress({ ...request, body: { y: 2, x: 1 } });
  assert.equal(asReceived.attemptId, reordered.attemptId);
  assert.equal(asReceived.bodyDigest, reordered.bodyDigest, 'JCS must be order-independent');
});

/**
 * Request layer: the identity includes the frozen request content, so two
 * requests that differ in content are two attempts. The receipt set is the
 * mirror image — it would not distinguish these.
 */
test('a different body is a different attempt', () => {
  const one = captureAtIngress({ ...request, body: { amount: '1' } });
  const two = captureAtIngress({ ...request, body: { amount: '2' } });
  assert.notEqual(one.attemptId, two.attemptId, 'different content must be different attempts');
  assert.notEqual(one.bodyDigest, two.bodyDigest);
  assert.notEqual(idempotencyScope(one), idempotencyScope(two));
});

test('a different query is a different attempt', () => {
  const one = captureAtIngress({ ...request, query: { a: '1', b: '2' } });
  const two = captureAtIngress({ ...request, query: { a: '1&b=2' } });
  assert.notEqual(one.attemptId, two.attemptId);
  assert.notEqual(idempotencyScope(one), idempotencyScope(two));
});

test('ingress output is frozen — the snapshot cannot be mutated downstream', () => {
  const frozen = captureAtIngress(request);
  assert.throws(() => {
    (frozen as { path: string }).path = '/v1/other';
  }, TypeError);
});

test('N1: checksum casing does not mint two identities for one address', () => {
  const mixed = deriveAttemptId({ ...IDENTITY_BASE, payTo: '0x8ba1f109551bD432803012645Ac136ddd64DBA72' });
  const lower = deriveAttemptId({ ...IDENTITY_BASE, payTo: '0x8ba1f109551bd432803012645ac136ddd64dba72' });
  assert.equal(mixed, lower);
});

test('N2: CAIP-2 namespace casing does not mint two identities', () => {
  const upper = deriveAttemptId({ ...IDENTITY_BASE, network: 'EIP155:8453' });
  const lower = deriveAttemptId({ ...IDENTITY_BASE, network: 'eip155:8453' });
  assert.equal(upper, lower);
});

test('N2b: eip155 chain reference is normalized (no leading zeros)', () => {
  const padded = deriveAttemptId({ ...IDENTITY_BASE, network: 'eip155:08453' });
  const plain = deriveAttemptId({ ...IDENTITY_BASE, network: 'eip155:8453' });
  assert.equal(padded, plain);
});

test('canonical query is order-independent and encoded', () => {
  assert.equal(canonicalQuery({ a: '1', b: '2' }), canonicalQuery({ b: '2', a: '1' }));
  // Both '&' and '=' are encoded, so neither can smuggle in structure.
  assert.equal(canonicalQuery({ a: '1&b=2' }), 'a=1%26b%3D2');
});
