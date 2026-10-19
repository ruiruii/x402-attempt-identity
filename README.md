# x402 attempt-identity — reference implementation

A runnable prototype of the invariant in [x402-foundation/x402#3772](https://github.com/x402-foundation/x402/issues/3772) and the spec text in [#3776](https://github.com/x402-foundation/x402/pull/3776), plus the `receiptId` derivation proposed in [#3821](https://github.com/x402-foundation/x402/issues/3821).

Submitted as the **Reference implementation** section (§7) of the XP, which the [XP process](https://github.com/x402-foundation/x402/pull/3801) requires before an XP can be accepted: *"Pseudocode, design documents alone and 'trust me, it works' don't count."*

```
npm install
npm test     # 46 tests: positive, negative, published vectors, countersignature
npm run demo # end-to-end walkthrough
```

## The invariant, in one sentence

**An attempt's identity is derived once, at ingress, from named decoded fields — and every downstream path (settle, refusal, replay-lookup, challenge-quote) resolves that same value rather than deriving a second one.**

## What the prototype demonstrates

### 1. The violation is unrepresentable, not forbidden

This is the design point, and it is the reason for writing code rather than prose.

`captureAtIngress` returns a `FrozenIngress` carrying the derived identity and the three inputs every downstream path needs. It deliberately does **not** carry the request body, the raw query object, or any handle back to the request.

```ts
export function settleOrChallengeQuote(frozen: FrozenIngress): string {
  return idempotencyScope(frozen);   // no request in scope, so nothing to re-derive from
}
```

A settle path handed a `FrozenIngress` cannot re-derive from request content — not because it is told not to, but because the request is not in scope. Asking implementers to remember not to re-read is a rule that fails silently; taking the request away is one that cannot fail.

### 2. Re-evaluation and re-derivation are different operations

Every downstream path recomputes `idempotencyScope` fresh. That is re-invoking a pure function over frozen inputs, which is permitted and expected. What the invariant forbids is deriving identity from content that was never captured at ingress. §5.5 in #3776 was narrowed to draw exactly this line, and the five call sites here land on the compliant side of it.

### 3. Request layer vs outcome layer

Two identifiers, one operation (named-field extraction → JCS → SHA-256), two named sets:

| | Set | Distinguishes |
|---|---|---|
| `attemptId` | version, **method, path, query, bodyDigest**, payTo, asset, network, amount, scheme | two different requests |
| `receiptId` | version, network, resourceUrl, payer, **issuedAt** | a fact that already happened |

The attempt set includes frozen request content because two requests differing in content are two attempts. The receipt set carries `issuedAt` and no request content because a receipt states an outcome. Getting this backwards is what makes an identifier useless: an attempt identity that ignores request content silently merges two payments, and a receipt identity that includes it cannot be reproduced by anyone who did not see the request.

### 4. The two production bug classes, reproduced and refuted

From the implementation cited as the evidence anchor in #3776:

- **2026-08-25, query-encoding collision.** `{a:'1', b:'2'}` and `{a:'1&b=2'}` both serialize to `a=1&b=2` when joined without encoding — two requests, one identity.
- **2026-09-11, body-binding gap.** A slot that omits the body digest gives two requests differing only in body the same identity.

Both live in `src/legacy.ts`, marked DO NOT SHIP, and both are asserted to collide there and *not* to collide under the correct implementation. Reproducing them as functions rather than describing them in a comment means a future edit to `canonicalQuery` or `idempotencyScope` cannot quietly reintroduce either.

### 5. Normalization N1–N5

Lowercasing EVM addresses is necessary but not sufficient. The table in `src/normalize.ts` exists because skipping any line mints two identifiers for one thing:

| | Rule | Skipping it |
|---|---|---|
| N1 | `payer` lowercased for EVM namespaces | checksum casing splits one payer into two |
| N2 | `network` in CAIP-2 canonical form | `EIP155:8453` ≠ `eip155:8453` |
| N3 | `issuedAt` converted to UTC, `Z` form | `…Z`, `…+00:00`, `…19:41:25+08:00` become three identities |
| N4 | `resourceUrl` **not** normalized | (contested line — see below) |
| N5 | `version` hashed as decoded | — |

N4 is the least obvious line and the most likely to be wrong: normalizing a URL feels safe, but path and query casing can be semantically significant and RFC 3986 syntax-based normalization is not applied uniformly by producers. It is kept explicit so reversing it is a one-line, findable change rather than an unstated assumption.

## Vectors

`test/vectors.test.ts` asserts every value published in #3821 — V1–V3 as values a conformant implementation **must** produce, V4–V7 and NEG-1/NEG-2 as values it **must not**. These were published before this file existed, so they check the implementation rather than restating it.

`test/countersign.test.ts` runs against **another implementation's published fixtures**: INAM's four countersignature cases (`conformance/inam-countersigned-vectors.json`, Apache-2.0, from `github.com/inamprotocol/inam-protocol`). `src/countersign.ts` recomputes `specHash` and `outputHash` from the observed bytes alone and reproduces their published values without using their checker, so the agreement is independent rather than copied.

The case that matters is `OUTPUT-NOT-WHAT-WAS-SERVED`: **both signatures are valid**, and only the binding check refuses it. That is why recomputation is an obligation distinct from signature verification — and why it is written as an obligation rather than an exemption from the "never re-derive" rule. A refusal mints no replacement identity; there is simply nothing to settle under.

## Honest limitations

- **JCS numbers.** `src/jcs.ts` implements the subset the invariant needs. Numbers requiring exponential serialization are refused with `RangeError` rather than emitted, because a serialization another implementation might disagree with is exactly the failure class this work is about. Refusing is correct here, not a gap.
- **Not a facilitator.** This is a derivation library plus end-to-end tests, which the XP process accepts as a prototype. It is not a drop-in x402 SDK component.
- **N3 precision.** Whether fractional seconds are preserved as received or truncated is not yet decided; currently preserved as received.
- **N4 is contested** and flagged as such.
