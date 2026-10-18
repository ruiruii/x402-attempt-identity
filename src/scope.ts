import type { FrozenIngress } from './identity.js';
import { hashCanonical } from './identity.js';

/**
 * The idempotency slot.
 *
 * A pure function over three frozen ingress inputs. Re-invoking it is expected
 * and permitted — that is re-evaluation of a deterministic function, not a
 * re-derivation. What the invariant forbids is deriving identity from content
 * that was not captured at ingress, and this signature cannot do that: it has
 * no access to anything that was not frozen.
 */
export function idempotencyScope(frozen: FrozenIngress): string {
  return hashCanonical({
    path: frozen.path,
    query: frozen.query,
    bodyDigest: frozen.bodyDigest,
  });
}
