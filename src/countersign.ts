import { createHash } from 'node:crypto';

/**
 * SPEC-12: the countersignature obligation.
 *
 * A counterparty asked to countersign an artifact MUST independently recompute
 * the fingerprint from the bytes it observed, and MUST refuse to sign if the
 * recomputed value differs from the value the producer derived.
 *
 * The distinction this file exists to make executable: recomputation is a
 * verification obligation, NOT a second derivation. It produces no new
 * identity. Either the recomputed value equals the claimed one and the
 * counterparty signs the identity the producer already derived, or it differs
 * and nothing is signed. There is no third outcome in which a second identity
 * comes into existence and is used.
 *
 * The case that makes this non-trivial is the one where every signature is
 * valid. A counterparty that only checks signatures accepts a record whose
 * outputHash commits to bytes it never received. Only the binding check —
 * recompute from what I saw, compare against what you claim — catches it.
 */

/** The bytes an HTTP interaction is identified by, as observed. */
export interface ObservedInteraction {
  readonly request: { readonly method: string; readonly url: string; readonly body: string };
  readonly response: { readonly status: number; readonly body: string };
}

/** The fingerprint the producer claims, taken from the carried receipt. */
export interface ClaimedFingerprint {
  readonly specHash: string;
  readonly outputHash: string;
}

export type CounterpartyDecision =
  | { readonly signs: true; readonly recomputed: ClaimedFingerprint }
  | {
      readonly signs: false;
      readonly recomputed: ClaimedFingerprint;
      readonly mismatched: readonly string[];
    };

function sha256Prefixed(bytes: string): string {
  return `sha256:${createHash('sha256').update(bytes, 'utf8').digest('hex')}`;
}

/**
 * `METHOD path?query\n` + request body, over the bytes as observed.
 *
 * The query separator is emitted only when a query is present: a request with
 * no query must not acquire a trailing `?` that the caller never sent.
 */
export function observedSpecHash(observed: ObservedInteraction): string {
  const url = new URL(observed.request.url);
  const target = url.search ? `${url.pathname}?${url.search.slice(1)}` : url.pathname;
  return sha256Prefixed(`${observed.request.method} ${target}\n${observed.request.body}`);
}

/** The response body as observed — not as described, not as re-serialized. */
export function observedOutputHash(observed: ObservedInteraction): string {
  return sha256Prefixed(observed.response.body);
}

/**
 * Recompute from observed bytes and decide.
 *
 * `signaturesValid` is carried in the result rather than taken as an input
 * because its only job is to make the interesting case visible: a decision to
 * refuse that is NOT explained by a bad signature. A record can be perfectly
 * signed and still bind to something the requester never received.
 */
export function counterpartyDecision(
  observed: ObservedInteraction,
  claimed: ClaimedFingerprint,
): CounterpartyDecision {
  const recomputed: ClaimedFingerprint = {
    specHash: observedSpecHash(observed),
    outputHash: observedOutputHash(observed),
  };

  const mismatched: string[] = [];
  if (recomputed.specHash !== claimed.specHash) mismatched.push('specHashMatchesObservedBytes');
  if (recomputed.outputHash !== claimed.outputHash) {
    mismatched.push('outputHashMatchesObservedBytes');
  }

  return mismatched.length === 0
    ? { signs: true, recomputed }
    : { signs: false, recomputed, mismatched };
}

/**
 * The property that separates verification from derivation: whatever the
 * decision, the identity in play is the one the producer derived. A refusal
 * does not mint a replacement.
 */
export function identityInPlay(
  decision: CounterpartyDecision,
  claimed: ClaimedFingerprint,
): ClaimedFingerprint | null {
  return decision.signs ? claimed : null;
}
