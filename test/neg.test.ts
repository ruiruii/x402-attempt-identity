import { test } from 'node:test';
import assert from 'node:assert/strict';

import { captureAtIngress, canonicalQuery, type DecodedRequest } from '../src/ingress.js';
import { idempotencyScope } from '../src/scope.js';
import { hashCanonical } from '../src/identity.js';
import { deriveReceiptId } from '../src/receipt.js';
import { normalizeIssuedAt } from '../src/normalize.js';
import { legacyScope, scopeWithoutBody, unencodedQuery } from '../src/legacy.js';

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

/** Receipt-set values, for the tests that exercise `deriveReceiptId` directly. */
const URL = 'https://api.example.com/v1/report';
const PAYER = '0x8ba1f109551bD432803012645Ac136ddd64DBA72';

/**
 * NEG-1 — 2026-08-25 query-encoding collision.
 *
 * `{a:'1', b:'2'}` and `{a:'1&b=2'}` are different requests. Joined without
 * encoding they serialize to the same string, so they share one identity.
 */
test('NEG-1: unencoded query join collapses two different requests', () => {
  const a = { a: '1', b: '2' };
  const b = { a: '1&b=2' };

  assert.equal(unencodedQuery(a), unencodedQuery(b), 'the bug: both become "a=1&b=2"');
  assert.notEqual(canonicalQuery(a), canonicalQuery(b), 'the invariant: they must not');
});

test('NEG-1b: under the legacy scope those two requests collide end to end', () => {
  const path = BASE.path;
  assert.equal(legacyScope(path, { a: '1', b: '2' }), legacyScope(path, { a: '1&b=2' }));

  const fa = captureAtIngress({ ...BASE, query: { a: '1', b: '2' }, body: { amount: '1' } });
  const fb = captureAtIngress({ ...BASE, query: { a: '1&b=2' }, body: { amount: '2' } });
  assert.notEqual(idempotencyScope(fa), idempotencyScope(fb));
});

/**
 * NEG-2 — 2026-09-11 body-binding gap.
 *
 * A slot that omits the body digest gives two requests differing only in body
 * the same identity.
 */
test('NEG-2: a slot without the body digest collapses two requests', () => {
  const fa = captureAtIngress({ ...BASE, query: {}, body: { amount: '1' } });
  const fb = captureAtIngress({ ...BASE, query: {}, body: { amount: '2' } });

  assert.equal(
    scopeWithoutBody(fa.path, fa.query),
    scopeWithoutBody(fb.path, fb.query),
    'the bug: identical slot for different bodies',
  );
  assert.notEqual(idempotencyScope(fa), idempotencyScope(fb));
});

/** R2: an absent member is omitted, never emitted as null. */
test('R2: omitting a member and nulling it are different, and only one is correct', () => {
  const omitted = deriveReceiptId({
    version: '1',
    network: 'eip155:8453',
    resourceUrl: URL,
    payer: PAYER,
  });

  const nulled = hashCanonical({
    version: '1',
    network: 'eip155:8453',
    resourceUrl: URL,
    payer: '0x8ba1f109551bd432803012645ac136ddd64dba72',
    issuedAt: null,
  });

  assert.notEqual(omitted, nulled);
  assert.equal(omitted, '97dc2862d2882d555feeff073b11e8f2891e1907e0f0b595af28c7145833ca65');
});

/** N3: one instant, one identifier. */
test('N3: three spellings of one instant produce one identifier', () => {
  const forms = [
    '2026-10-15T11:41:25Z',
    '2026-10-15T11:41:25+00:00',
    '2026-10-15T19:41:25+08:00',
  ];
  const ids = forms.map((issuedAt) =>
    deriveReceiptId({
      version: '1',
      network: 'eip155:8453',
      resourceUrl: URL,
      payer: PAYER,
      issuedAt,
    }),
  );
  assert.equal(new Set(ids).size, 1, 'one instant produced more than one identifier');
  for (const f of forms) assert.equal(normalizeIssuedAt(f), '2026-10-15T11:41:25Z');
});

/** N1 and N2, asserted as negative vectors: skipping them changes the value. */
test('N1/N2: skipping normalization yields a different, wrong identifier', () => {
  const canonical = deriveReceiptId({
    version: '1',
    network: 'eip155:8453',
    resourceUrl: URL,
    payer: PAYER,
    issuedAt: '2026-10-15T11:41:25Z',
  });

  const skippedN1 = hashCanonical({
    version: '1',
    network: 'eip155:8453',
    resourceUrl: URL,
    payer: PAYER,
    issuedAt: '2026-10-15T11:41:25Z',
  });
  const skippedN2 = hashCanonical({
    version: '1',
    network: 'EIP155:8453',
    resourceUrl: URL,
    payer: '0x8ba1f109551bd432803012645ac136ddd64dba72',
    issuedAt: '2026-10-15T11:41:25Z',
  });

  assert.notEqual(skippedN1, canonical);
  assert.notEqual(skippedN2, canonical);
  assert.notEqual(skippedN1, skippedN2);
});

/** The JCS number guard: refuse rather than emit a serialization others may not match. */
test('JCS: numbers outside the accepted range are refused, not coerced', () => {
  assert.throws(() => hashCanonical({ n: 1e21 }), RangeError);
  assert.throws(() => hashCanonical({ n: Number.POSITIVE_INFINITY }), TypeError);
});

/**
 * N0 — the field set outran the rule.
 *
 * N1 was written about the receipt set, where exactly one address exists, and
 * says "the payer is lowercased". The attempt set has two address-valued
 * fields. `payTo` was covered because it is the field the sentence names;
 * `asset` was not, and nothing failed — checksum casing on the asset minted a
 * second attempt for the same request.
 *
 * This is not the same failure as the others in this file. Those are rules
 * whose trigger can be made unreachable. This is a rule that stayed reachable
 * and simply never applied to a member that was added after it was written.
 */
test('a normalization rule stated per field stops covering the set when the set grows', () => {
  const one: DecodedRequest = {
    version: '1',
    method: 'GET',
    path: '/v1/report',
    query: { a: '1' },
    body: { n: 1 },
    payTo: '0x8ba1f109551bd432803012645ac136ddd64dba72',
    asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    network: 'eip155:8453',
    amount: '1000',
    scheme: 'exact',
  };
  const lowerAsset: DecodedRequest = { ...one, asset: one.asset.toLowerCase() };

  assert.notEqual(one.asset, lowerAsset.asset, 'the two inputs differ in casing only');
  assert.equal(
    captureAtIngress(one).attemptId,
    captureAtIngress(lowerAsset).attemptId,
    'checksum casing on asset must not mint a second attempt',
  );
});

/**
 * SPEC-6c — an unnormalizable member must not pass as a normalized one.
 *
 * The case: `network` arrives in a form N2 does not cover (`8453`, no CAIP-2
 * namespace). `normalizeNetwork` returns it unchanged, so `payTo` is left at
 * whatever casing it arrived in, because the lowercasing is gated on the
 * namespace being `eip155`. The resulting attemptId is well-formed, stable and
 * agrees with itself forever — which is the failure, not a side effect.
 *
 * The assertion is about distinguishability, not about which value is correct:
 * an implementation may refuse, or resolve to an explicit unmeasurable outcome,
 * but it must not emit an identity that looks like a successful normalization.
 */
test('an unnormalizable member cannot pass as a normalized one', () => {
  const canonical: DecodedRequest = {
    version: '1',
    method: 'POST',
    path: '/v1/pay',
    query: { a: '1' },
    body: { n: 1 },
    payTo: '0xabcdEf0000000000000000000000000000000001',
    asset: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    network: 'eip155:8453',
    amount: '1000',
    scheme: 'exact',
  };

  // Same request, network in a form N2 has no rule for.
  const unnormalizable: DecodedRequest = { ...canonical, network: '8453' };

  // The normalized path lowercases the payer; the unnormalized path cannot,
  // because the namespace test is what decides whether to lowercase at all.
  const normalizedPayer = captureAtIngress({ ...canonical, payTo: canonical.payTo.toLowerCase() }).attemptId;
  const raw = captureAtIngress(canonical).attemptId;
  assert.equal(raw, normalizedPayer, 'checksum casing on a covered network is normalized away');

  // The unnormalizable input DOES change the value (the network string is
  // hashed as-is, so nothing collapses), but the change is not a reported one:
  // the caller gets a well-formed attemptId with no indication that the payer
  // was left at whatever casing it arrived in. `normalizeNetwork` has no third
  // return position, so the skip is unrepresentable to the caller.
  //
  // That is the SPEC-6c defect, stated where it can be tested: not "the value
  // is wrong" but "the failure has no output". The assertion below holds the
  // current behaviour so the test documents it rather than hiding it; the test
  // for the clause itself is the one that must be written when a return
  // position exists.
  // Measured, and the measurement is the point of this test:
  //
  //   network 'eip155:8453'  checksum vs lowercase  -> SAME  (N1 applied)
  //   network '8453'         checksum vs lowercase  -> DIFF  (N1 skipped)
  //
  // The second row is the defect. It is not that the two inputs collide — the
  // network string itself still separates them, which is precisely why nobody
  // notices. It is that the skip is unobservable from outside: the caller
  // receives a well-formed attemptId and no signal that a rule was not applied.
  //
  // This test asserts the defect, not the fix, because the fix needs a third
  // return position (`{ value } | { unnormalizable }`) that the pure normalizer
  // does not have. It goes red the day that position is added, which is the
  // intended trigger for rewriting it against SPEC-6c.
  const withChecksum = captureAtIngress(unnormalizable).attemptId;
  const withLower = captureAtIngress({ ...unnormalizable, payTo: canonical.payTo.toLowerCase() }).attemptId;
  assert.notEqual(
    withChecksum,
    withLower,
    'DEFECT: on an uncovered network the payer is left as received, and no path reports it',
  );
  assert.notEqual(withChecksum, raw, 'the uncovered network string still separates the identity');
});
