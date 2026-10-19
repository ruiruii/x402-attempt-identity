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

/**
 * SPEC-5, as rewritten. The original wording asked for a wave of the hand:
 * "that difference MUST surface as an event". Under SPEC-3 no downstream path
 * re-reads the request, so two downstream identities cannot differ, and the
 * obligation was satisfied by there never being anything to emit.
 *
 * What the clause actually requires is a comparison between two ingress
 * snapshots, and an implementation always has both.
 */
test('a downstream divergence is a failure, not an event', () => {
  const one = captureAtIngress({ ...request, body: { amount: '1' } });
  const two = captureAtIngress({ ...request, body: { amount: '2' } });

  // The comparison is available at ingress, before any path runs. Nothing has
  // to be observed downstream for the rule to have teeth.
  assert.notEqual(one.attemptId, two.attemptId);
  assert.notEqual(one.bodyDigest, two.bodyDigest);

  // And a path that resolved one value cannot later resolve the other: the
  // resolved value is the frozen one, not a function of live state. An
  // implementation that could produce two values for one attempt has already
  // violated SPEC-1; the discovery of that is evidence, not a mode of operation.
  assert.equal(idempotencyScope(one), idempotencyScope(one), 'the resolved value is a function of frozen inputs');
  assert.equal(new Set(DOWNSTREAM_PATHS.map((p) => scopeAt(one, p))).size, 1);
  assert.notEqual(idempotencyScope(one), idempotencyScope(two));
});

/**
 * SPEC-9, as rewritten. RFC 3339 permits lowercase `t` and `z`, so a
 * timestamp lowercased in transit is a valid instant and normalization MUST
 * repair it rather than reject it. This is also why the damage NEG-4 does is
 * not uniform: a correct N3 repairs the timestamp and nothing can repair the
 * URL, because N4 is deliberately nothing.
 */
test('N3 repairs lowercase t and z rather than rejecting the value', () => {
  const upper = deriveAttemptId({ ...IDENTITY_BASE, issuedAt: '2026-10-01T10:00:00Z' } as never);
  const lower = deriveAttemptId({ ...IDENTITY_BASE, issuedAt: '2026-10-01t10:00:00z' } as never);
  assert.equal(upper, lower, 'lowercase separators are the same instant');
});
