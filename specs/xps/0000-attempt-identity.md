# XP: One ingress-derived attempt identity, resolved identically by settle and refusal

## 1. Preamble

| | |
|---|---|
| **Title** | One ingress-derived attempt identity, resolved identically by settle and refusal |
| **Author** | ruiruii (Rachel) — `gates-spec` |
| **Status** | `awaiting-sponsor` |
| **Type** | Standards Track |
| **PR** | (to be assigned on opening) |
| **Prior discussion** | [x402-foundation/x402#3772](https://github.com/x402-foundation/x402/issues/3772), [PR #3776](https://github.com/x402-foundation/x402/pull/3776), [issue #3821](https://github.com/x402-foundation/x402/issues/3821) |

**Why Standards Track and not the Extensions Track default.** An extension is something an implementer can decline. This cannot be declined. It adds no field, changes no wire format, and requires no new cryptography — it constrains what the v2 spec already says about how `/settle`, refusal, replay-lookup and challenge-quote resolve an attempt. Either they resolve one identity or they do not; there is no conformant way to opt out. Extensions Track exists for patterns that have not yet proven themselves; this one is already being depended on by four independent efforts, described in §3.

---

## 2. Abstract

An x402 interaction is referred to by different names in different places — `attempt_id`, `Idempotency-Key`, idempotency scope, `payment-identifier` — but nothing in the core specification states when that identity is derived or who is allowed to derive it again. The result is that `/settle` and the refusal path can each compute an identity for what is logically one attempt and arrive at two different values, with no field in the response that reveals it. Two deployed implementations have each shipped this bug, each fixed it, and each kept a regression test.

This XP proposes one normative rule: an attempt's identity is derived **once, at ingress**, from named decoded fields of the request as received, and every downstream path — settle, refusal, replay-lookup, challenge-quote — **resolves** that value rather than deriving a second one. It changes no wire format and adds no field. It states what is already implicit in `#3218`'s identifier binding, `#3325`'s settlement status vocabulary, and the RFC 8785 canonicalization discipline in `#3700`/`#3676`, and it states it once, at the core, instead of letting each extension re-derive a local version of it.

---

## 3. Motivation

The XP process requires that an XP "name the *demonstrated need*: who is trying to ship what, and why they can't." Four independent efforts have hit the same missing primitive from different directions.

**Two deployed implementations have shipped the bug.** A production merchant implementation minting its own settlement certificates hit it twice, in the same month, in two different forms:

- **2026-08-25, query-encoding collision.** A request with `?tag=FIRST` and one with `?tag=SECOND` folded into one identity because the query was joined without per-component encoding. Two requests, one identity. Fix commit public, regression test kept.
- **2026-09-11, body-binding gap.** The idempotency slot was not bound to the request body, so two requests differing only in body shared one identity. Fix commit public, regression test kept.

Both were found in production, both were fixed, and the fix in both cases was the same: capture once at ingress, reuse everywhere. Neither fix was generalized into a rule, which is why the second bug could happen a fortnight after the first.

**A consumer of an existing extension cannot name what it received.** In [#3821](https://github.com/x402-foundation/x402/issues/3821), an implementer publishing external artifacts that bind a buyer's signed account to a seller's receipt reports that the only way to name a receipt today is a digest over the artifact as transmitted — while §1 of that same extension states that "wire shape and field placement are not considered stable." The one identifier available to an external referencing system is the one the spec declares unstable. The signature survives a wire-shape change and the external reference does not, and nothing warns a reader about that asymmetry. In their words: *"That choice was forced."*

**Four downstream efforts each presuppose the primitive and none states it.**

| Effort | What it does | What it presupposes |
|---|---|---|
| `#3218` | Binds `payment-identifier` to a request fingerprint; reuse with a different fingerprint → `409` | That the identity is derived once and resolved identically — it handles concurrent mismatch, not cross-time read divergence |
| `#3325` | Adds a six-state `status` vocabulary to `SettleResponse` | That `status` refers to one identity; the spec never says settle and refusal read the same one |
| `#3700` / `#3676` | Canonicalize `offer-receipt` per RFC 8785; reject malformed EIP-712 | The canonicalization discipline — but only for the receipt payload, not for the request snapshot |
| `#2833` / `#3758` / `#3682` / `#2906` | Delivery-receipt and execution-evidence work | That "the delivery being signed" and "the attempt being paid for" name the same thing |

**A fourth layer is emerging that cannot be built without it.** Discussion in `erc-8004/erc-8004-contracts#99` has produced a four-layer lifecycle — pre-flight safety, pre-flight judgment, post-settlement payment proof, independent work acceptance — in which every layer needs to refer back to the same attempt. One participant there stated the constraint in a form this XP adopts directly: *"The nonce is the payment's identity; a transaction hash would bind to whoever relayed the payment, not to the authorization."* Each layer is currently inventing its own reference to the attempt, because the core does not define one.

**Supporting data.** 728 verifiable on-chain rater→agent payment records (CC BY 4.0, dated, re-runnable), with a `rail` column separating x402 settlements from plain USDC transfers. The set is offered as evidence that the payment pattern exists at volume, not as proof of the bug; the proof of the bug is the two dated incidents above.

---

## 4. Specification

The key words MUST, MUST NOT, SHOULD, and MAY are to be interpreted as described in RFC 2119.

### 4.1 Derivation

> **SPEC-1 (MUST).** A facilitator **MUST** derive an attempt's identity **once, at ingress**, from a single immutable snapshot of the request as received, and **MUST NOT** derive or partially re-derive it downstream.
> *Test:* `POS-1` (all five downstream paths resolve one value), `ingress output is frozen`.

> **SPEC-2 (MUST).** Derivation **MUST** be over **named decoded fields**. It **MUST NOT** be over the transmitted bytes of the request, the wire array, or any encoding that can vary between representations of the same request.
> *Test:* `attempt identity comes from named decoded fields`, `V1`/`NEG-2`.

> **SPEC-3 (MUST).** The derived identity **MUST** be resolved, not recomputed from live state, by `/settle`, refusal handling (§9), replay-lookup, and challenge-quote responses. All four **MUST** resolve the same value.
> *Test:* `POS-1`, `POS-1b` (refusal resolves the same value as settle).

> **SPEC-4 (MUST NOT).** No path **MUST** derive identity from request content that was not part of the ingress snapshot. Re-invoking a pure scope function over the already-frozen ingress inputs is permitted and expected — that is re-evaluation of a deterministic function, not a re-derivation.
> *Test:* `POS-1c` (stable across repeated invocation), `NEG-1b`, `NEG-2`.

> **SPEC-5 (MUST).** A request whose `amount`, query, or body differs **MUST** produce a different identity, and that difference **MUST** surface as a settlement or announcement event — never as a silent divergence in which two paths resolve different identities for the same logical request.
> *Test:* `a different body is a different attempt`, `a different query is a different attempt`.

### 4.2 The named field set

> **SPEC-6 (MUST).** The ingress snapshot **MUST** include at least these named fields: `method`, `path`, canonical `query`, the decoded `body` (or a digest of it computed after decoding), and the resolved `payTo`, `asset`, `network`, `amount`, and `scheme`.
> *Test:* `attempt identity comes from named decoded fields`, `a different body is a different attempt`, `a different query is a different attempt`.
>
> **SPEC-7 (SHOULD).** The snapshot **SHOULD** include a domain identifier (for example a `version` literal) inside the hashed set, so that a change to the field set changes the identity's *domain* rather than silently colliding with it.
> *Test:* `V3 — v2 field set, a different domain (R4)`.

> **SPEC-8 (MUST).** Query canonicalization **MUST** percent-encode each key and value **before** joining. Implementations **MUST NOT** join unencoded components.
> *Test:* `NEG-1` — `{a:'1', b:'2'}` and `{a:'1&b=2'}` **MUST NOT** produce the same identity.

> **SPEC-9 (MUST).** Normalization **MUST** be applied to every member for which it is defined, and **MUST NOT** be applied where it is not:
>
> - EVM addresses in `payTo` and payer fields **MUST** be lowercased;
> - `network` **MUST** be in CAIP-2 canonical form (namespace lowercase, reference as defined by that namespace);
> - timestamps **MUST** be converted to UTC and serialized in RFC 3339 `Z` form;
> - URLs **MUST NOT** be normalized — path and query casing can be semantically significant and RFC 3986 syntax-based normalization is not applied uniformly by producers;
> - a spec-assigned literal (`version`) **MUST** be hashed as decoded.
>
> *Test:* `N1`, `N2`, `N2b`, `N3`, `V4`, `V5`, `V6`, `V7`.

> **SPEC-10 (MUST).** An absent member **MUST** be omitted from the hashed set entirely. It **MUST NOT** be emitted as `null`, empty string, or zero.
> *Test:* `R2`, `NEG-1` (vector).

> **SPEC-11 (MUST).** Canonicalization **MUST** follow RFC 8785 (JCS): object keys sorted by UTF-16 code units, no insignificant whitespace, UTF-8 output. The digest **MUST** be over the UTF-8 bytes of that output.
> *Test:* `V1`, `canonical query is order-independent`.

### 4.3 Obligations derived from it

> **SPEC-12 (MUST).** Where the artifact is countersigned by a counterparty, that counterparty **MUST** independently recompute the fingerprint from the bytes it observed, and **MUST** refuse to sign if the recomputed value differs from the ingress-derived value. This recomputation is a verification obligation, not a second derivation: it does not create a new identity, and on mismatch the interaction **MUST NOT** settle.
> *Test:* `independent recomputation reproduces the published hashes`, `OUTPUT-NOT-WHAT-WAS-SERVED: refused on the binding check alone`, `our in-scope verdict matches the published expectation on every case`, `recomputation is verification, not a second derivation`. Run against a second implementation's published fixtures (INAM, `conformance/inam-countersigned-vectors.json`, Apache-2.0); the hashes are recomputed from the observed bytes alone, so agreement is independent rather than copied.

> **SPEC-13 (MUST NOT).** An implementation **MUST NOT** fold values that did not exist at ingress into the identity. Outcome payloads produced later — delivered measurements, readings, result digests — are record content, not identity input. Metering that resolves differently between full and partial delivery belongs to the outcome layer, so that the gap stays visible rather than being absorbed into a re-derived identity.
> *Test:* `SPEC-13: nothing produced after ingress reaches the attempt identity`, `request layer and outcome layer are two named sets, one operation`.

> **SPEC-14 (MUST).** Where an attempt carries a reference to a **separately signed artifact**, that reference **MUST** be taken over the artifact **as transmitted**, because the signature covers those bytes. Canonicalizing them first would verify a different object than the one that was signed. This is not a second derivation of the attempt identity.
> *Test:* `SPEC-14: a signed reference is taken over transmitted bytes`.

SPEC-13 and SPEC-14 together draw the line that motivated this XP: an artifact's **own** identity comes from named decoded fields; a **reference** to a signed artifact comes from the bytes that were signed. They are different operations requiring different inputs, and conflating them is what produces both the wire-byte fingerprint and the unstable external reference.

> **SPEC-15 (MAY).** An implementation **MAY** name the identity anything — `attempt_id`, `Idempotency-Key`, idempotency scope, or a scheme-specific field. The requirement is the discipline (derive once, resolve identically), not the introduction of a specific field.

---

## 5. Rationale

### Alternatives considered

**Hash the wire bytes.** Rejected. One challenge in three representations (`PAYMENT-REQUIRED`, vendor-prefixed `X-PAYMENT-REQUIRED`, body) would be three identities. This reproduces the transaction-hash problem one level up, for exactly the reason given in the `erc-8004` discussion: a wire form binds to whoever transmitted it, not to the authorization.

**Use the transaction hash as the identity.** Rejected. It identifies the settlement, not the authorization; it binds to whoever relayed the payment rather than to the payer's signed intent; and at refusal time it does not exist yet. A refusal path has no transaction hash to resolve, so an identity built on one cannot be resolved identically by settle and refusal — which is the whole requirement.

**Derive on demand at each path.** This is what the two production bugs did. It is not rejected on grounds of elegance but on grounds of observability: when the two derivations disagree, nothing in the response reveals it. The failure is silent by construction.

**Reuse `#3218`'s `payment-identifier` as the normative field.** Considered and not adopted. Binding the name would make the rule appear to depend on that PR, and would force every implementation already using `Idempotency-Key` to add a field to comply. SPEC-15 keeps the rule name-independent, which is what lets existing implementations satisfy it without a wire change.

### Objections raised, and how they were resolved

**"The clause bans something correct implementations do."** A reviewer with a shipped implementation pointed out that "none of them re-reads the request or recomputes the digest" reads as banning re-invocation of a pure scope function over frozen inputs — which their five call sites do, and must. The objection is correct and the text was wrong. §5.5 was narrowed to "recomputes the digest **from request content that was not part of the ingress snapshot**", and SPEC-4 restates the distinction explicitly rather than leaving it to inference. The rule now names the bug class, not the verb.

**"Countersignature would be swept up by the same clause."** A reader on the ERC-8004 side raised the case of a counterparty that recomputes independently *in order to* countersign. Rather than carve out an exemption — which would have weakened the rule — it is written as an obligation (SPEC-12). Verification and derivation are different operations; only one of them is constrained.

**"JCS does not fix field placement."** In `#3821` it was observed that canonicalization buys independence from field *order* but not from what the payload is understood to *contain*, and that §1 of that extension explicitly warns placement is unstable. This is true, and it is why SPEC-7 recommends a domain identifier inside the hashed set: a field-set change then changes the domain rather than colliding silently. This XP does not claim canonicalization solves placement; it claims the two operations in SPEC-13/SPEC-14 need to be separated before the question can even be stated correctly.

### Design Principles in tension

**Simplicity over completeness.** The tension is real and resolved in favour of narrowing. An earlier draft of §5.5 included a clause that would have forbidden re-invoking a pure scope function; it is gone. Payment-grounding methods outside x402 settlement (escrow-release, counterparty-countersigned) are deliberately left out of the core — they belong in Extensions Track, and SPEC-15 is written so they can be added there without touching this text. What remains is one sentence about derivation timing and a field list.

**Demonstrated need over anticipated need.** Every MUST above traces to something that happened: SPEC-8 to the 2026-08-25 incident, SPEC-6's body-binding to the 2026-09-11 incident, SPEC-12 to the ERC-8004 countersignature case, SPEC-14 to the `#3821` external-reference case. Nothing here is speculative.

**Present law over predicted law.** The invariant states one fact — settle, refusal and replay-lookup resolve the identity ingress derived. It does not say what that fact means for reputation, disputes, or any obligation outside the payment. SPEC-13 keeps outcome-layer values out of the identity for the same reason: the gap between full and partial delivery should stay visible rather than be absorbed into an identity that makes it look resolved.

---

## 6. Backward compatibility

**Severity: none for conformant implementations; a behavioural change for implementations that re-read.**

The rule is additive. It adds no field, changes no wire format, alters no existing field's meaning, and deletes nothing. A response that omits the identity behaves exactly as v2 does today.

**Who already complies.** Any implementation that captures a digest or key once at ingress and reuses it — including implementations that already bind `Idempotency-Key` to an ingress snapshot — satisfies the invariant today without modification. The shipped implementation cited as the evidence anchor in `#3776` has five call sites that each re-invoke a pure scope function over the same frozen inputs; all five land on the compliant side of SPEC-4 as written.

**Who does not.** An implementation that re-reads request content at settle time, or that derives the identity separately per path, produces two values for one attempt. Under this XP that is non-conformant. The migration is mechanical: hoist the derivation to ingress, pass the frozen value (or the frozen inputs) to each downstream path. No wire change, no client change, no wallet change.

**The one observable difference.** Under SPEC-5, a request whose terms change mid-attempt now produces a *different* identity and a recorded event, where a re-reading implementation might have silently produced one or two depending on timing. That is the intended effect: the divergence becomes an event instead of an invisible disagreement. Implementations that relied on the silent behaviour were relying on the bug.

**Versioning.** Nothing in this XP requires a spec version bump on its own. SPEC-7's domain identifier is the mechanism by which a future change to the field set becomes a domain change rather than a silent collision, so the cost of evolving this later is bounded.

---

## 7. Reference implementation

A runnable prototype exists at `x402-attempt-identity/` in this submission:

```
npm install && npm test     # 37 tests
npm run demo                # end-to-end walkthrough
```

It is a TypeScript derivation library with end-to-end tests — which the XP process accepts as a prototype ("a branch of an x402 SDK, a standalone proof of concept, integration or e2e tests, or a reference client, server or facilitator"). It is not a drop-in facilitator component, and is not presented as one.

**What it demonstrates.**

1. **The violation is unrepresentable.** `captureAtIngress` returns a frozen snapshot carrying the derived identity and the three inputs downstream paths need. It deliberately does not carry the request body, the raw query object, or any handle back to the request. A settle path handed that snapshot cannot re-derive from request content — not because it is told not to, but because the request is not in scope.
2. **Re-evaluation versus re-derivation.** All five downstream paths re-invoke `idempotencyScope` fresh over frozen inputs, and the tests assert one value.
3. **Both production bugs, reproduced as functions.** `src/legacy.ts` contains the 2026-08-25 unencoded join and the 2026-09-11 body-less slot, marked DO NOT SHIP. The tests assert that they collide there and do not collide under the correct implementation. Reproducing them as code rather than describing them in a comment means a future edit to `canonicalQuery` or `idempotencyScope` cannot silently reintroduce either.
4. **The `#3821` vector set.** Every published value is asserted — V1–V3 as required, V4–V7 and NEG-1/NEG-2 as forbidden.
5. **Request layer versus outcome layer.** The attempt set carries frozen request content; the receipt set (`deriveReceiptId`) carries `issuedAt` and no request content. Same operation, two named sets.
6. **Countersignature against a second implementation's fixtures.** `src/countersign.ts` recomputes `specHash` and `outputHash` from the observed bytes alone, and the tests run it over INAM's published vectors (`conformance/inam-countersigned-vectors.json`, Apache-2.0). The recomputation reproduces their published hashes without using their checker, so the agreement is independent. The case that matters is `OUTPUT-NOT-WHAT-WAS-SERVED`: both signatures are valid there, and only the binding check refuses it — which is what makes recomputation an obligation distinct from signature verification.
7. **The wire-byte rule reversed where it must be.** `src/signedref.ts` takes a reference to a separately signed artifact over the transmitted bytes, and the test asserts that canonicalizing first yields a digest naming an object nobody signed — the mirror of SPEC-2, and the pair that is easy to get half right.

**Field set.** The prototype derives over exactly the SPEC-6 list plus the SPEC-7 domain identifier: `version`, `method`, `path`, `query`, `bodyDigest`, `payTo`, `asset`, `network`, `amount`, `scheme`. `amount` is string-typed for the reason given in §5 — numbers are where independent JCS implementations drift, and an identity that differs by implementation is worse than no identity.

**Honest limitations.** JCS is implemented for the subset the invariant needs; numbers requiring exponential serialization are refused with an error rather than emitted, because a serialization another implementation might disagree with is precisely the failure class this XP is about. Whether fractional seconds are preserved or truncated (SPEC-9) is not yet decided. The URL non-normalization rule is the least settled line in the table and is flagged as contested in the source.

**Conformance tests.** Required before `final`, and started already: every MUST and MUST NOT in §4 is annotated with the test that covers it. Writing them while drafting is what surfaced the re-evaluation objection and the request-layer defect described above.

---

## 8. Security considerations

**Payment.** The invariant is a payment-safety rule before it is a naming rule. If settle resolves identity A and the refusal path resolves identity B, then a retry that should have been recognized as the same attempt is treated as a new one — and a buyer can be charged twice for what the facilitator would describe, on inspection, as one request. SPEC-3 exists to make that impossible rather than merely detectable.

**Refusal is the dangerous path, not settle.** At settle, two parties are comparing values, so a divergence has a chance of being noticed. At refusal nothing settles, nobody is looking, and a divergent identity is never compared against anything. SPEC-3 names refusal explicitly for this reason, and the prototype asserts that refusal resolves the same value as settle (`POS-1b`). The 2026-09-11 incident was a body-binding gap in exactly this shape.

**Replay.** SPEC-1 and SPEC-3 are what make replay-lookup meaningful: a replay is only detectable if "the same attempt" resolves to one value. An implementation that re-derives per path can fail to recognize a replay in one path while recognizing it in another. SPEC-8 matters here too — an unencoded query join lets two distinct requests collapse into one identity, which is the inverse failure and equally exploitable: it lets an attacker reuse a slot for a request that was never authorized.

**Custody.** Nothing in this XP moves custody or changes who may settle. SPEC-12 adds an obligation on a countersigning party to verify independently before signing, which is a custody-relevant safeguard rather than a relaxation: on mismatch the interaction MUST NOT settle.

**Privacy.** Deriving identity over decoded named fields rather than wire bytes *reduces* incidental disclosure — an implementation cannot leak the exact serialization a client happened to produce. But a stable identity across paths is also a correlator, and this XP does not attempt to solve that: correlation across attempts is out of scope, and §5.4's decision to omit `transaction` from receipts for correlation reasons is left undisturbed. Two things follow: a derived identity SHOULD be treated as sensitive by implementations that log it, and SPEC-13 keeps outcome-layer content out of the identity so that identity derivation does not become a side channel for what was delivered.

**Facilitator trust.** The XP reduces what a verifier must trust the facilitator for. Under SPEC-2 and SPEC-9, any party holding the request can recompute the identity and arrive at the same bytes without trusting the producer's serializer — which is what an external referencing system in the `#3821` position needs and does not have today. It does not eliminate facilitator trust: the facilitator still decides what counts as ingress and what the snapshot contains. SPEC-1's "single immutable snapshot" is the constraint on that discretion, and it is the reason the rule is stated as a MUST about timing rather than a recommendation about fields.
