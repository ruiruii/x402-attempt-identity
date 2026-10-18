import { deriveAttemptId, type FrozenIngress, hashCanonical } from './identity.js';

/** A request after decoding. The only thing allowed to reach ingress. */
export interface DecodedRequest {
  readonly version: string;
  readonly method: string;
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  /** Decoded body — not the transmitted bytes. */
  readonly body: unknown;
  readonly payTo: string;
  readonly asset: string;
  readonly network: string;
  /** String-typed on purpose; see the note on `AttemptIdentityInput`. */
  readonly amount: string;
  readonly scheme: string;
}

/**
 * Canonical query string.
 *
 * Every key and value is encoded before joining. Skipping this is the
 * 2026-08-25 query-encoding collision: `{a:'1', b:'2'}` and `{a:'1&b=2'}`
 * both serialize to `a=1&b=2`, two different requests folding into one
 * identity. See test/neg.test.ts (NEG-1).
 */
export function canonicalQuery(query: Readonly<Record<string, string>>): string {
  return Object.entries(query)
    .map(([k, v]) => [k, v] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

/**
 * The single derivation point.
 *
 * Everything downstream receives the FrozenIngress this returns. Nothing
 * downstream receives the DecodedRequest, so nothing downstream can derive a
 * second identity from request content — not because it is told not to, but
 * because the request is no longer in scope.
 */
export function captureAtIngress(request: DecodedRequest): FrozenIngress {
  const query = canonicalQuery(request.query);
  const bodyDigest = hashCanonical(request.body);

  const attemptId = deriveAttemptId({
    version: request.version,
    method: request.method,
    path: request.path,
    query,
    bodyDigest,
    payTo: request.payTo,
    asset: request.asset,
    network: request.network,
    amount: request.amount,
    scheme: request.scheme,
  });

  return Object.freeze({ attemptId, path: request.path, query, bodyDigest });
}
