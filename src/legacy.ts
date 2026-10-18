import { hashCanonical } from './identity.js';

/**
 * DO NOT SHIP.
 *
 * Reproductions of the two real bugs that motivate the invariant, kept in the
 * tree only so the conformance tests can assert that a correct implementation
 * does NOT behave this way. Both are drawn from the production incidents cited
 * as the evidence anchor in x402#3776:
 *
 *   - 2026-08-25 query-encoding collision
 *   - 2026-09-11 body-binding gap
 *
 * Each has a dated fix commit in the cited repository. They are reproduced here
 * as functions rather than described in a comment so that a future change to
 * `canonicalQuery` or `idempotencyScope` cannot silently reintroduce them.
 */

/**
 * NEG-1. Joins without encoding, so `{a:'1', b:'2'}` and `{a:'1&b=2'}` both
 * serialize to `a=1&b=2`. Two different requests, one identity.
 */
export function unencodedQuery(query: Readonly<Record<string, string>>): string {
  return Object.entries(query)
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

/**
 * NEG-2. Omits the body digest from the slot, so two requests that differ only
 * in their body share one identity.
 */
export function scopeWithoutBody(path: string, query: string): string {
  return hashCanonical({ path, query });
}

/** NEG-1 and NEG-2 combined: the shape of the pre-fix implementation. */
export function legacyScope(
  path: string,
  query: Readonly<Record<string, string>>,
): string {
  return scopeWithoutBody(path, unencodedQuery(query));
}
