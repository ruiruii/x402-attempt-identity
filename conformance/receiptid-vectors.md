# `receiptId` conformance vectors — offer-and-receipt extension

Drafted for x402-foundation/x402#3821.
**Supersedes the earlier set**: all values below are computed under the normalization table N1–N5, which the first set lacked. Do not mix values across the two sets.

All values computed locally (JCS per RFC 8785 → SHA-256 over UTF-8 bytes). Not yet reproduced by an independent implementation — that remains a precondition for these going near a conformance suite.

## Rule under test

```
receiptId = SHA-256(JCS(C))

C is an object with EXACTLY these name-indexed members, extracted from
the DECODED receipt payload:

  "version"      string, §5.3
  "network"      string, CAIP-2
  "resourceUrl"  string
  "payer"        string
  "issuedAt"     string, RFC 3339

R1. Extraction after decoding (jws: base64url-decode the payload component;
    eip712: use the decoded typed data). No transmitted bytes enter the hash.
R2. An absent member is omitted from C entirely — not null, "", or 0.
R3. C is name-indexed, not position-indexed.
R4. "version" is inside the hashed set, so a field-set change changes the
    identifier's domain rather than colliding with it.
R5. JCS per RFC 8785 (keys sorted by UTF-16 code units, no insignificant
    whitespace, UTF-8); SHA-256 over the UTF-8 bytes of the JCS output.
```

### Normalization (N1–N5) — added after cv-scvd's implementation evidence

Lowercasing EVM addresses was necessary but not sufficient. Three further drift sources exist that a field set without a timestamp would never surface.

```
N1. "payer":       EVM-compatible namespaces → lowercase. Address-checksum
                   casing must not make one payer into two identities.
N2. "network":     CAIP-2 canonical form — namespace lowercase, reference
                   as defined by that namespace.
N3. "issuedAt":    convert to UTC, serialize RFC 3339 with "Z".
                   "…11:41:25Z", "…11:41:25+00:00", and "…19:41:25+08:00"
                   are one instant and MUST yield one identifier.
N4. "resourceUrl": no normalization. Path/query casing can be semantically
                   significant and RFC 3986 syntax-based normalization is
                   not applied uniformly by producers, so normalizing here
                   would introduce divergence rather than remove it.
N5. "version":     as decoded — a spec-assigned literal.
```

**N1 is corroborated by a shipped implementation** (`hashQuotedTerms`, `src/discovery/receipt-surface.ts`). **N3 could not have surfaced there** — that implementation's five fields contain no timestamp. **N4 is the least obvious line in the table** and the one most likely to be contested: normalizing a URL feels safe and is argued here to be wrong at this boundary.

## Positive vectors

### V1 — canonical

```json
{"version":"1","network":"eip155:8453","resourceUrl":"https://api.example.com/v1/report",
 "payer":"0x8ba1f109551bd432803012645ac136ddd64dba72","issuedAt":"2026-10-15T11:41:25Z"}
```

JCS output:

```
{"issuedAt":"2026-10-15T11:41:25Z","network":"eip155:8453","payer":"0x8ba1f109551bd432803012645ac136ddd64dba72","resourceUrl":"https://api.example.com/v1/report","version":"1"}
```

```
receiptId = 42b67bf9cb5ae3c68d971532e1e8e9e30868e055dca8542be2d61d949135a309
```

### V2 — `issuedAt` omitted (optional member, R2)

```
receiptId = 97dc2862d2882d555feeff073b11e8f2891e1907e0f0b595af28c7145833ca65
```

Not equal to V1 — R2 working, not failing.

### V3 — v2 field set (`resourceUrl` moved to the envelope, `"version":"2"`)

```
receiptId = 03d91454e1d4e08f8e013ef5455f44b21275e4e3c2e1a00a851c0b020dbe99a0
```

**Assertion:** != V1, and the two are not comparable. This is R4 working: an identifier from the v1 set and one from the v2 set are in different domains and must not silently appear interchangeable.

## Negative vectors — one per skipped rule

Each is the value a plausible implementation produces if it skips exactly one rule. **None may equal V1.**

| # | Skips | Input difference | Value |
|---|---|---|---|
| V4 | N1 | `payer` with mixed checksum casing | `f368a5a271757ac8f33371fe6349c6f0a2519b4c305f3ac2106f7a51f6aa48c2` |
| V5 | N3 | `issuedAt` = `2026-10-15T11:41:25+00:00` | `19675963950a9bca6db9b2d439a8fcd0fc13b3d18fae68124f82967daa67018b` |
| V6 | N3 | `issuedAt` = `2026-10-15T19:41:25+08:00` (same instant) | `904a4bd315e01441c3515455ee57cc5fae30d9f68a36169c09655cc44d750269` |
| V7 | N2 | `network` = `EIP155:8453` | `d0e93c56bb4030c2dc969c3a5fa9c8143fe6c6f1fa579a5127e497aad58e50f7` |
| NEG-1 | R2 | `issuedAt` emitted as `null` instead of omitted | `0b40b83300c14889316c7939cf6726c7044ab23a957276e8e8fcc5439c2ad696` |
| NEG-2 | R1 | hash taken over base64url-encoded bytes, not decoded payload | `e1d62d5897a7be15ce22fd2ec82366cde17f46467dde6dd2949d1ed46e251d70` |

NEG-2 input (base64url of the canonical form):

```
eyJpc3N1ZWRBdCI6IjIwMjYtMTAtMTVUMTE6NDE6MjVaIiwibmV0d29yayI6ImVpcDE1NTo4NDUzIiwicGF5ZXIiOiIweDhiYTFmMTA5NTUxYmQ0MzI4MDMwMTI2NDVhYzEzNmRkZDY0ZGJhNzIiLCJyZXNvdXJjZVVybCI6Imh0dHBzOi8vYXBpLmV4YW1wbGUuY29tL3YxL3JlcG9ydCIsInZlcnNpb24iOiIxIn0
```

V4–V7 are four ways to mint two identifiers for one receipt. A spec that says "hash these five fields" without saying "in this form" has not fixed the instability the issue is about.

## Open before these are usable

1. Independent reproduction of every value by an implementation that did not read this file.
2. **N4 is the contested line.** If the extension maintainers or holistis take the view that `resourceUrl` should be normalized per RFC 3986, N4 flips and V1 changes. Stated explicitly rather than left silent so that the correction is cheap.
3. N3 needs a precision rule: whether fractional seconds are preserved as received or truncated. Not yet decided.
4. Confirm the v1 member set against §5.3's actual required-vs-optional status.

## Negative vectors: field set and decode order

Added 2026-10-19, fulfilling the two promised in #3821. Both classes share the property that makes them worth publishing: **each produces a well-formed hex digest its author cannot tell apart from a correct one.** Nothing throws, nothing is empty, and the value agrees with itself forever.

Input payload (decoded):

```json
{"version":"x402-receipt/2","network":"eip155:8453","resourceUrl":"https://api.example/v1/Translate?Text=Hello","payer":"0xAbCdEf0000000000000000000000000000000001","payTo":"0x1111111111111111111111111111111111111111","issuedAt":"2026-10-01T10:00:00Z","transaction":"0xdeadbeef"}
```

| # | Failure | Value |
|---|---|---|
| — | **correct** (named subset, N1–N5) | `f57dac6ca12b1ffe4925f916c4ca0e21fad63efb15ecb5e77ef01568f3dd0fa3` |
| NEG-3 | hash the whole decoded payload instead of the named subset | `13583b72bd106dfa8ad5a8dd21971e683a7bacf8cb334ce5ddd06462ab386a1f` |
| NEG-3b | NEG-3's form, after one optional member (`facilitator`) is added | `29717ebf84a50d62e05bd5184f2194ee56b636c50d551054e26f86c4b0e63c63` |
| NEG-4a | lowercase the serialized JSON before parsing; member silently absent | `ae47e7509030ebcd5f169d8f478cdd8ca805c815d8870e73a483f8b692c3abc3` |
| NEG-4b | same, but read the lowercased key: value present and mangled | `ccc8f2332e2acf6fe02ac2d5f6e74895569844e5d14d87ce4adbba469514e19d` |

**NEG-3 is wrong for a structural reason, not a cosmetic one.** Hashing everything looks safer because nothing is omitted, but the identifier then depends on every member the payload happens to carry — so adding one optional member rewrites every identifier issued before the change. NEG-3b is that drift; the correct form is unaffected by the same addition, which is the difference that matters.

**NEG-4 does three separate kinds of damage and none of them raises.** Lowercasing the text before parsing is the cheap way to satisfy N1. It destroys the key (`resourceUrl` → `resourceurl`), so under R2 the member is omitted rather than nulled — correct behaviour applied to a value that should never have been missing. Reaching for the lowercased key gets the member back but mangles the value (`…/v1/translate?text=hello`), which is exactly what N4 exists to prevent. And it takes `issuedAt` with it: the key is gone and the value has lost the delimiters N3 depends on (`2026-10-01t10:00:00z`).

The general lesson for the rule text: **normalization applies to decoded values, and the order of decode and normalize is part of the rule.** A spec that says "lowercase the address" without saying "after parsing, and only the address" has specified the operation that produces NEG-4.
