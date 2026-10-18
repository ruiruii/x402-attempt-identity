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
 *
 * And the case that makes the clause itself non-trivial: a counterparty that
 * cannot recompute at all. Two absent values do not differ. A clause phrased
 * only as "refuse if the value differs" is therefore satisfied by a verifier
 * that never compares, because the condition for refusal is never met. Absence
 * is not difference, so absence must be its own reason for refusal — and it
 * must be distinguishable from a mismatch, because they are different facts
 * about the world.
 */

/** The bytes an HTTP interaction is identified by, as observed. */
export interface ObservedInteraction {
  readonly request: { readonly method: string; readonly url: string; readonly body: string };
  readonly response: { readonly status: number; readonly body: string };
}

/**
 * What a counterparty may actually hold. Both members are optional because a
 * verifier frequently has one and not the other: a record format can carry the
 * request and omit the response, or carry neither.
 */
export interface PartialObservation {
  readonly request?: ObservedInteraction['request'];
  readonly response?: ObservedInteraction['response'];
}

/** The fingerprint the producer claims, taken from the carried receipt. */
export interface ClaimedFingerprint {
  readonly specHash: string;
  readonly outputHash: string;
}

/**
 * Why a counterparty refused. A single refusal collapses two different facts
 * into one, so they are named apart.
 */
export type RefusalReason =
  /** Recomputed, and it differs. Something is wrong with the record. */
  | 'mismatched'
  /** Could not recompute. Nothing is known about the record either way. */
  | 'unmeasurable';

export type CounterpartyDecision =
  | { readonly signs: true; readonly recomputed: ClaimedFingerprint }
  | {
      readonly signs: false;
      readonly recomputed: Partial<ClaimedFingerprint>;
      readonly mismatched: readonly string[];
      readonly unavailable: readonly string[];
      readonly refusal: RefusalReason;
    };

function sha256Prefixed(bytes: string): string {
  return `sha256:${createHash('sha256').update(bytes, 'utf8').digest('hex')}`;
}

function specBytes(request: ObservedInteraction['request']): string {
  const url = new URL(request.url);
  const target = url.search ? `${url.pathname}?${url.search.slice(1)}` : url.pathname;
  return `${request.method} ${target}\n${request.body}`;
}

/**
 * `METHOD path?query\n` + request body, over the bytes as observed.
 *
 * The query separator is emitted only when a query is present: a request with
 * no query must not acquire a trailing `?` that the caller never sent.
 */
export function observedSpecHash(observed: ObservedInteraction): string {
  return sha256Prefixed(specBytes(observed.request));
}

/** The response body as observed — not as described, not as re-serialized. */
export function observedOutputHash(observed: ObservedInteraction): string {
  return sha256Prefixed(observed.response.body);
}

/**
 * Recompute from observed bytes and decide.
 *
 * Refuses when the values differ, and also refuses when they cannot be
 * computed — with `refusal` saying which. A verifier with nothing to compare
 * against does not get to sign by default.
 */
export function counterpartyDecision(
  observed: PartialObservation,
  claimed: ClaimedFingerprint,
): CounterpartyDecision {
  const unavailable: string[] = [];

  const specHash = observed.request ? sha256Prefixed(specBytes(observed.request)) : undefined;
  if (specHash === undefined) unavailable.push('specHashMatchesObservedBytes');

  const outputHash = observed.response ? sha256Prefixed(observed.response.body) : undefined;
  if (outputHash === undefined) unavailable.push('outputHashMatchesObservedBytes');

  // Absence is not difference. This branch is the whole reason `refusal`
  // exists: without it, an implementation that never compares satisfies a
  // clause that only forbids signing on a mismatch.
  if (specHash === undefined || outputHash === undefined) {
    return {
      signs: false,
      recomputed: {
        ...(specHash === undefined ? {} : { specHash }),
        ...(outputHash === undefined ? {} : { outputHash }),
      },
      mismatched: [],
      unavailable,
      refusal: 'unmeasurable',
    };
  }

  const recomputed: ClaimedFingerprint = { specHash, outputHash };
  const mismatched: string[] = [];
  if (specHash !== claimed.specHash) mismatched.push('specHashMatchesObservedBytes');
  if (outputHash !== claimed.outputHash) mismatched.push('outputHashMatchesObservedBytes');

  return mismatched.length === 0
    ? { signs: true, recomputed }
    : { signs: false, recomputed, mismatched, unavailable: [], refusal: 'mismatched' };
}

/** Narrow a decision to its refusal half, so the reason can be read. */
export function isRefusal(
  d: CounterpartyDecision,
): d is Extract<CounterpartyDecision, { signs: false }> {
  return d.signs === false;
}

/**
 * The property that separates verification from derivation: whatever the
 * decision, the identity in play is the one the producer derived. A refusal
 * mints no replacement.
 */
export function identityInPlay(
  decision: CounterpartyDecision,
  claimed: ClaimedFingerprint,
): ClaimedFingerprint | null {
  return decision.signs ? claimed : null;
}
