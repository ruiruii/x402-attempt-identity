import { createHash } from 'node:crypto';
import { jcsCanonicalize } from './jcs.js';
import {
  normalizeAddress,
  normalizeNetwork,
  normalizeVersion,
} from './normalize.js';

/**
 * A branded string: an AttemptId is not interchangeable with any other hex
 * digest floating around a facilitator, and the type system says so.
 */
export type AttemptId = string & { readonly __attemptId: true };

/**
 * The named set an attempt's identity is derived over. Not the wire payload.
 *
 * This is the SPEC-6 field list from the XP: method, path, canonical query,
 * decoded body digest, and the resolved payTo / asset / network / amount /
 * scheme, plus the SPEC-7 domain identifier.
 *
 * Request layer, not outcome layer: the set includes the request's own frozen
 * content, because two requests that differ in content are two attempts and
 * must not share an identity. The receipt set is the mirror image — it carries
 * `issuedAt` and no request content, because a receipt states a fact that has
 * already happened.
 *
 * `amount` is deliberately typed as a string. Numbers are where independent
 * JCS implementations drift, and an identity that differs by implementation is
 * worse than no identity.
 */
export interface AttemptIdentityInput {
  /** SPEC-7 domain identifier. */
  readonly version: string;
  readonly method: string;
  readonly path: string;
  /** Canonical query string, already encoded. */
  readonly query: string;
  /** Hex digest of the decoded body, captured once at ingress. */
  readonly bodyDigest: string;
  readonly payTo: string;
  readonly asset: string;
  readonly network: string;
  readonly amount: string;
  readonly scheme: string;
}

export const ATTEMPT_IDENTITY_FIELDS = [
  'version',
  'method',
  'path',
  'query',
  'bodyDigest',
  'payTo',
  'asset',
  'network',
  'amount',
  'scheme',
] as const;

/** SHA-256 of the JCS-canonical (RFC 8785) form, over UTF-8 bytes. */
export function hashCanonical(value: unknown): string {
  return createHash('sha256').update(jcsCanonicalize(value), 'utf8').digest('hex');
}

/**
 * Extract the named subset and normalize it (N1, N2, N4, N5).
 * Extraction is over decoded values only — no transmitted bytes reach here.
 */
export function attemptIdentitySubset(input: AttemptIdentityInput): Record<string, string> {
  const network = normalizeNetwork(input.network);
  return {
    version: normalizeVersion(input.version),
    method: input.method,
    path: input.path,
    query: input.query,
    bodyDigest: input.bodyDigest,
    payTo: normalizeAddress(input.payTo, network),
    asset: input.asset,
    network,
    amount: input.amount,
    scheme: input.scheme,
  };
}

export function deriveAttemptId(input: AttemptIdentityInput): AttemptId {
  return hashCanonical(attemptIdentitySubset(input)) as AttemptId;
}

/**
 * What ingress freezes.
 *
 * The design point: this carries the derived identity and the three inputs
 * every downstream path needs. It deliberately does NOT carry the request
 * body, the raw query object, or any handle back to the request. A settle,
 * refusal or replay path handed one of these has no way to re-derive from
 * request content even if it wanted to — the violation is not forbidden by
 * convention here, it is unrepresentable.
 *
 * That is the whole argument for freezing at ingress rather than asking
 * implementers to remember not to re-read.
 */
export interface FrozenIngress {
  /** Derived once, at ingress. Never derived again. */
  readonly attemptId: AttemptId;
  readonly path: string;
  /** Canonical, already-encoded query string. */
  readonly query: string;
  /** Hex digest of the decoded body, captured once at ingress. */
  readonly bodyDigest: string;
}
