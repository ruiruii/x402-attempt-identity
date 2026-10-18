import type { FrozenIngress } from './identity.js';
import { idempotencyScope } from './scope.js';

/**
 * The five downstream consumers, mirroring the call sites of the shipped
 * implementation cited as the evidence anchor in x402#3776.
 *
 * Every one of them takes a FrozenIngress and nothing else. None can re-read
 * the request, because none is given the request. Each recomputes
 * `idempotencyScope` fresh — a pure function invoked again — and that is
 * exactly the "permitted re-evaluation, forbidden re-derivation" split the §5.5
 * text was narrowed to draw.
 */

export function preSettlementResolutionCheck(frozen: FrozenIngress): string {
  return idempotencyScope(frozen);
}

export function replayLookup(frozen: FrozenIngress): string {
  return idempotencyScope(frozen);
}

export function recordedPurchaseCheck(frozen: FrozenIngress): string {
  return idempotencyScope(frozen);
}

export function settleOrChallengeQuote(frozen: FrozenIngress): string {
  return idempotencyScope(frozen);
}

export function postSettlementCacheWrite(frozen: FrozenIngress): string {
  return idempotencyScope(frozen);
}

/** All five, in the order an interaction actually touches them. */
export const DOWNSTREAM_PATHS = [
  'preSettlementResolutionCheck',
  'replayLookup',
  'recordedPurchaseCheck',
  'settleOrChallengeQuote',
  'postSettlementCacheWrite',
] as const;

export function scopeAt(frozen: FrozenIngress, path: (typeof DOWNSTREAM_PATHS)[number]): string {
  switch (path) {
    case 'preSettlementResolutionCheck':
      return preSettlementResolutionCheck(frozen);
    case 'replayLookup':
      return replayLookup(frozen);
    case 'recordedPurchaseCheck':
      return recordedPurchaseCheck(frozen);
    case 'settleOrChallengeQuote':
      return settleOrChallengeQuote(frozen);
    case 'postSettlementCacheWrite':
      return postSettlementCacheWrite(frozen);
  }
}

/**
 * Refusal. Present because it is where a second derivation would be invisible:
 * nothing settles, so no one is looking, so a divergent identity is never
 * compared against anything. Refusal gets the same FrozenIngress and the same
 * scope, and that is the point.
 */
export function refusal(frozen: FrozenIngress): { settled: false; scope: string } {
  return { settled: false, scope: idempotencyScope(frozen) };
}
