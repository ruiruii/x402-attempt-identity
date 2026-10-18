import { hashCanonical } from './identity.js';
import {
  normalizeIssuedAt,
  normalizeNetwork,
  normalizePayer,
  normalizeResourceUrl,
  normalizeVersion,
} from './normalize.js';

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
  const network = normalizeNetwork(input.network);
  const subset: Record<string, string> = {
    version: normalizeVersion(input.version),
    network,
    payer: normalizePayer(input.payer, network),
  };
  if (input.resourceUrl !== undefined) {
    subset['resourceUrl'] = normalizeResourceUrl(input.resourceUrl);
  }
  if (input.issuedAt !== undefined) {
    subset['issuedAt'] = normalizeIssuedAt(input.issuedAt);
  }
  return subset;
}

export function deriveReceiptId(input: ReceiptIdentityInput): ReceiptId {
  return hashCanonical(receiptIdentitySubset(input)) as ReceiptId;
}
