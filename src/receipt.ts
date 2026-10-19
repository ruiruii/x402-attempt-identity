import { hashCanonical } from './identity.js';
import { UnnormalizableMember } from './identity.js';
import {
  normalizeIssuedAt,
  normalizeNetwork,
  normalizePayer,
  normalizeResourceUrl,
  normalizeVersion,
  type Normalized,
} from './normalize.js';

function unwrap(member: string, n: Normalized): string {
  if (!n.ok) throw new UnnormalizableMember(member, n.unnormalizable);
  return n.value;
}

/**
 * `receiptId` — the same derivation rule as the attempt identity, applied to a
 * different named set. Two identifiers, one operation, one normalization table.
 *
 * Proposed in x402-foundation/x402#3821. The point of putting it in the same
 * reference implementation is to make that claim executable rather than
 * rhetorical: if the rule were bespoke, it would live in a different file with
 * a different table.
 */

export type ReceiptId = string & { readonly __receiptId: true };

export interface ReceiptIdentityInput {
  readonly version: string;
  readonly network: string;
  readonly resourceUrl?: string;
  readonly payer: string;
  readonly issuedAt?: string;
}

/**
 * R2: an absent member is omitted from the set entirely — not emitted as null,
 * empty string, or zero. This matters here in a way it does not for the
 * attempt subset, because the receipt has a genuinely optional member.
 */
export function receiptIdentitySubset(input: ReceiptIdentityInput): Record<string, string> {
  const network = unwrap('network', normalizeNetwork(input.network));
  const subset: Record<string, string> = {
    version: unwrap('version', normalizeVersion(input.version)),
    network,
    payer: unwrap('payer', normalizePayer(input.payer, network)),
  };
  if (input.resourceUrl !== undefined) {
    subset['resourceUrl'] = unwrap('resourceUrl', normalizeResourceUrl(input.resourceUrl));
  }
  if (input.issuedAt !== undefined) {
    subset['issuedAt'] = unwrap('issuedAt', normalizeIssuedAt(input.issuedAt));
  }
  return subset;
}

export function deriveReceiptId(input: ReceiptIdentityInput): ReceiptId {
  return hashCanonical(receiptIdentitySubset(input)) as ReceiptId;
}
