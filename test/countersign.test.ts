import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  counterpartyDecision,
  identityInPlay,
  observedOutputHash,
  observedSpecHash,
  type ClaimedFingerprint,
  type ObservedInteraction,
} from '../src/countersign.js';

/**
 * SPEC-12, against another implementation's published fixtures.
 *
 * These vectors are INAM's (github.com/inamprotocol/inam-protocol,
 * interop/countersigned, Apache-2.0), offered by their author for the
 * grounding conformance set. Nothing here re-implements their checker; the
 * hashes below are recomputed from the observed bytes alone, so a match is
 * real independent agreement and not a copy of their arithmetic.
 */

interface Fixture {
  readonly observed: ObservedInteraction & {
    readonly expectedSpecHash: string;
    readonly expectedOutputHash: string;
  };
  readonly cases: readonly {
    readonly id: string;
    readonly description: string;
    readonly feedbackFile: string;
    readonly expected: { readonly accepted: boolean; readonly failedChecks: readonly string[] };
  }[];
}

const fixture: Fixture = JSON.parse(
  readFileSync(new URL('../../conformance/inam-countersigned-vectors.json', import.meta.url), 'utf8'),
) as Fixture;

const OBSERVED: ObservedInteraction = {
  request: fixture.observed.request,
  response: fixture.observed.response,
};

function claimedFor(caseId: string): ClaimedFingerprint {
  const c = fixture.cases.find((x) => x.id === caseId);
  assert.ok(c, `fixture case ${caseId} must exist`);
  const receipt = (JSON.parse(c.feedbackFile) as {
    inam: { receipt: { task: { specHash: string }; result: { outputHash: string } } };
  }).inam.receipt;
  return { specHash: receipt.task.specHash, outputHash: receipt.result.outputHash };
}

/** The two checks that are in this XP's scope; the rest are INAM's. */
const IN_SCOPE = ['specHashMatchesObservedBytes', 'outputHashMatchesObservedBytes'];

test('independent recomputation reproduces the published hashes', () => {
  // The whole point of the reproducibility boundary: a party that does not
  // trust the producer's serializer arrives at the same bytes anyway.
  assert.equal(observedSpecHash(OBSERVED), fixture.observed.expectedSpecHash);
  assert.equal(observedOutputHash(OBSERVED), fixture.observed.expectedOutputHash);
});

test('POSITIVE: recomputed matches claimed, counterparty signs', () => {
  const d = counterpartyDecision(OBSERVED, claimedFor('POSITIVE'));
  assert.equal(d.signs, true);
});

test('OUTPUT-NOT-WHAT-WAS-SERVED: refused on the binding check alone', () => {
  // The case SPEC-12 exists for. Both signatures are valid here, so no
  // signature check catches it — only recomputing from observed bytes does.
  const d = counterpartyDecision(OBSERVED, claimedFor('OUTPUT-NOT-WHAT-WAS-SERVED'));
  assert.equal(d.signs, false);
  assert.deepEqual(d.mismatched, ['outputHashMatchesObservedBytes']);
  assert.ok(
    !d.mismatched.some((m) => /[Ss]ignature/.test(m)),
    'the refusal must not be explained by a bad signature',
  );
});

test('TAMPERED-OUTPUT-HASH: refused, and our scope agrees with the published expectation', () => {
  const d = counterpartyDecision(OBSERVED, claimedFor('TAMPERED-OUTPUT-HASH'));
  assert.equal(d.signs, false);
  assert.deepEqual(d.mismatched, ['outputHashMatchesObservedBytes']);
});

test('our in-scope verdict matches the published expectation on every case', () => {
  for (const c of fixture.cases) {
    const d = counterpartyDecision(OBSERVED, claimedFor(c.id));
    const theirInScope = c.expected.failedChecks.filter((m) => IN_SCOPE.includes(m));
    const ours = d.signs ? [] : [...d.mismatched];
    assert.deepEqual(
      ours.sort(),
      [...theirInScope].sort(),
      `in-scope checks must agree on ${c.id}`,
    );
  }
});

test('recomputation is verification, not a second derivation', () => {
  const claimed = claimedFor('POSITIVE');
  const accepted = counterpartyDecision(OBSERVED, claimed);
  assert.deepEqual(identityInPlay(accepted, claimed), claimed);

  const refused = counterpartyDecision(OBSERVED, claimedFor('OUTPUT-NOT-WHAT-WAS-SERVED'));
  // A refusal mints no replacement identity: there is nothing to settle under.
  assert.equal(identityInPlay(refused, claimed), null);
  assert.equal(refused.signs, false);
});
