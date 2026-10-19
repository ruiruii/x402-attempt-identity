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

/**
 * N0 — the field set itself. Not a normalization rule; the condition under
 * which the normalization rules mean anything.
 *
 * Found by reading our own table the way cv-scvd read an implementation
 * (`x402#3821`, 2026-10-19): N1 names the payer, and the attempt set has two
 * address-valued fields. `payTo` was normalized and `asset` was not, for no
 * reason other than that the rule was written about the receipt set where only
 * one address exists. Checksum casing on `asset` therefore minted two attempts
 * for one request. Fixed in `identity.ts` by applying N1 to every EVM-valued
 * field by kind rather than to the field the sentence happened to name.
 *
 * The general form: **a normalization table is written per field, and a field
 * set is allowed to grow.** A rule stated for the members that existed when it
 * was written silently stops covering the set the moment a member of the same
 * kind is added — and nothing fails, because the new member was never wrong,
 * it was never covered.
 */

/**
 * N0-b — the precondition is part of the rule, and its failure must be visible.
 *
 * SPEC-6c used to be stated as an outcome on the member: an unnormalizable input
 * must not be indistinguishable from a normalized one. That sentence can be
 * satisfied by accident, and it was: on `network: '8453'` the address rule was
 * silently skipped, and the identity still differed from the normalized one
 * merely because the raw `network` string was hashed as received. Nothing
 * reported that a rule had not been applied.
 *
 * cv-scvd's evidence is why the obligation is restated at the branch rather than
 * at the outcome (`x402#3821`, 2026-10-19): one codebase, two sites, the same
 * `network.startsWith("eip155:")` gate, opposite behaviour — `quotedTerms`
 * skipped the transform in silence, `familyOf()` fell through to `"unknown"` and
 * `payable: null`. Same condition, same order, and the difference was not a
 * decision about normalization at all. So the thing that can be mandated is not
 * the order and not the value: it is that the non-matching branch must reach a
 * visible undetermined state.
 *
 * These normalizers therefore return a union with an explicit `unnormalizable`
 * arm. Callers cannot consume them without choosing what to do with that arm —
 * the skip is no longer unrepresentable to the caller.
 */
export type Normalized<T = string> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly unnormalizable: string };

const ok = (value: string): Normalized => ({ ok: true, value });
const cannot = (reason: string): Normalized => ({ ok: false, unnormalizable: reason });

const EVM_NAMESPACES: ReadonlySet<string> = new Set(['eip155']);

function splitCaip2(network: string): { namespace: string; reference: string } | null {
  const i = network.indexOf(':');
  if (i <= 0 || i === network.length - 1) return null;
  return { namespace: network.slice(0, i), reference: network.slice(i + 1) };
}

/**
 * N1. Address-checksum casing must not make one address into two identities.
 *
 * Takes the *normalized* network, because the namespace test is the gate. When
 * that gate cannot be evaluated — the network is not CAIP-2 — the address is
 * unnormalizable rather than left as received. Leaving it as received is the
 * silent default this function exists to remove.
 */
export function normalizeAddress(address: string, network: string): Normalized {
  const parts = splitCaip2(network);
  if (!parts) return cannot('N1: network is not CAIP-2, so no address rule can be selected');
  if (EVM_NAMESPACES.has(parts.namespace.toLowerCase())) return ok(address.toLowerCase());
  return cannot(`N1: no address rule for namespace "${parts.namespace}"`);
}

/** N1, named for the receipt set where the field is the payer. */
export const normalizePayer = normalizeAddress;

/**
 * N2. CAIP-2 canonical form: namespace lowercase, reference as defined by that
 * namespace. For eip155 the reference is a decimal chain id with no leading
 * zeros, which is the only reference rule this implementation knows.
 */
export function normalizeNetwork(network: string): Normalized {
  const parts = splitCaip2(network);
  if (!parts) return cannot(`N2: "${network}" is not CAIP-2 (no namespace:reference)`);

  let { reference } = parts;
  if (parts.namespace === 'eip155' && /^\d+$/.test(reference)) {
    reference = String(Number.parseInt(reference, 10));
  }
  return ok(`${parts.namespace.toLowerCase()}:${reference}`);
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
export function normalizeIssuedAt(value: string): Normalized {
  const m = /^(\d{4}-\d{2}-\d{2})[Tt ](\d{2}:\d{2}:\d{2})(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/.exec(value);
  if (!m) return cannot(`N3: "${value}" is not an RFC 3339 timestamp`);
  const parsed = new Date(value.replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) return cannot(`N3: "${value}" is not a resolvable instant`);
  const fraction = m[3] ?? '';
  return ok(parsed.toISOString().replace(/\.\d{3}Z$/, `${fraction}Z`));
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
export function normalizeResourceUrl(url: string): Normalized {
  return ok(url);
}

/** N5. A spec-assigned literal; hashed exactly as decoded. */
export function normalizeVersion(version: string): Normalized {
  return ok(version);
}
