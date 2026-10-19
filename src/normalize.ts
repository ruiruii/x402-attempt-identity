/**
 * Normalization table N1-N5.
 *
 * Published in x402-foundation/x402#3821 as part of the `receiptId` derivation
 * rule, and reused here for the attempt-identity subset: the two identifiers
 * are the same operation (named-field extraction -> JCS -> SHA-256) applied to
 * different named sets, so they share one normalization table rather than two.
 *
 * The reason this is a table and not a prose sentence: every line below exists
 * because skipping it mints two identifiers for one receipt or one attempt.
 * Each has a negative vector in test/neg.test.ts.
 */

const EVM_NAMESPACES: ReadonlySet<string> = new Set(['eip155']);

function splitCaip2(network: string): { namespace: string; reference: string } | null {
  const i = network.indexOf(':');
  if (i <= 0 || i === network.length - 1) return null;
  return { namespace: network.slice(0, i), reference: network.slice(i + 1) };
}

/** N1. Address-checksum casing must not make one address into two identities. */
export function normalizeAddress(address: string, network: string): string {
  const parts = splitCaip2(network);
  if (parts && EVM_NAMESPACES.has(parts.namespace)) return address.toLowerCase();
  return address;
}

/** N1, named for the receipt set where the field is the payer. */
export const normalizePayer = normalizeAddress;

/**
 * N2. CAIP-2 canonical form: namespace lowercase, reference as defined by that
 * namespace. For eip155 the reference is a decimal chain id with no leading
 * zeros, which is the only reference rule this implementation knows.
 */
export function normalizeNetwork(network: string): string {
  const parts = splitCaip2(network);
  if (!parts) return network.toLowerCase();

  let { reference } = parts;
  if (parts.namespace === 'eip155' && /^\d+$/.test(reference)) {
    reference = String(Number.parseInt(reference, 10));
  }
  return `${parts.namespace.toLowerCase()}:${reference}`;
}

/**
 * N3. One instant, one identifier.
 * "2026-10-15T11:41:25Z", "2026-10-15T11:41:25+00:00" and
 * "2026-10-15T19:41:25+08:00" are the same moment and MUST produce one value.
 *
 * Fractional seconds: the digit string is currently preserved as received, and
 * that is a defect rather than a choice — ".1" and ".100" are one instant and
 * produce two identifiers, which is the exact failure N1 and N2 exist to
 * prevent, reproduced in the timestamp field. The fix (truncate to whole
 * seconds) is proposed in x402#3821 and not applied here until it is ruled on,
 * because applying it unilaterally would change the normalization table under
 * a proposal that is still open. Preserving a STRING is not preserving an
 * INSTANT, and the comment used to conflate the two.
 */
export function normalizeIssuedAt(value: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})[Tt ](\d{2}:\d{2}:\d{2})(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/.exec(value);
  if (!m) {
    throw new TypeError(`N3: "${value}" is not an RFC 3339 timestamp`);
  }
  const parsed = new Date(value.replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError(`N3: "${value}" is not a resolvable instant`);
  }
  const fraction = m[3] ?? '';
  return parsed.toISOString().replace(/\.\d{3}Z$/, `${fraction}Z`);
}

/**
 * N4. Deliberately nothing.
 *
 * URL path and query casing can be semantically significant, and RFC 3986
 * syntax-based normalization is not applied uniformly by producers. Normalizing
 * here would introduce divergence rather than remove it. This is the contested
 * line in the table and is kept explicit so that reversing it is a one-line,
 * findable change rather than an unstated assumption.
 */
export function normalizeResourceUrl(url: string): string {
  return url;
}

/** N5. A spec-assigned literal; hashed exactly as decoded. */
export function normalizeVersion(version: string): string {
  return version;
}
