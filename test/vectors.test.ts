import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { jcsCanonicalize } from '../src/jcs.js';
import { hashCanonical } from '../src/identity.js';
import { deriveReceiptId } from '../src/receipt.js';

/**
 * The vectors published in x402-foundation/x402#3821, asserted against the
 * reference implementation. Every value below was published before this file
 * existed, so these are checks on the implementation, not restatements of it.
 *
 * V1-V3 are values a conformant implementation MUST produce.
 * V4-V7 and NEG-1/NEG-2 are values it MUST NOT produce — each is what you get
 * by skipping exactly one rule.
 */

const CANON = '0x8ba1f109551bd432803012645ac136ddd64dba72';
const MIXED = '0x8ba1f109551bD432803012645Ac136ddd64DBA72';
const URL = 'https://api.example.com/v1/report';

const V1 = '42b67bf9cb5ae3c68d971532e1e8e9e30868e055dca8542be2d61d949135a309';

test('V1 — canonical receiptId', () => {
  assert.equal(
    deriveReceiptId({
      version: '1',
      network: 'eip155:8453',
      resourceUrl: URL,
      payer: MIXED,
      issuedAt: '2026-10-15T11:41:25Z',
    }),
    V1,
  );
});

test('V2 — optional member omitted (R2 working, not failing)', () => {
  assert.equal(
    deriveReceiptId({
      version: '1',
      network: 'eip155:8453',
      resourceUrl: URL,
      payer: MIXED,
    }),
    '97dc2862d2882d555feeff073b11e8f2891e1907e0f0b595af28c7145833ca65',
  );
});

test('V3 — v2 field set, a different domain (R4)', () => {
  assert.equal(
    deriveReceiptId({
      version: '2',
      network: 'eip155:8453',
      payer: MIXED,
      issuedAt: '2026-10-15T11:41:25Z',
    }),
    '03d91454e1d4e08f8e013ef5455f44b21275e4e3c2e1a00a851c0b020dbe99a0',
  );
});

test('V4 — skipping N1 (payer not lowercased)', () => {
  const skipped = hashCanonical({
    version: '1',
    network: 'eip155:8453',
    resourceUrl: URL,
    payer: MIXED,
    issuedAt: '2026-10-15T11:41:25Z',
  });
  assert.equal(skipped, 'f368a5a271757ac8f33371fe6349c6f0a2519b4c305f3ac2106f7a51f6aa48c2');
  assert.notEqual(skipped, V1);
});

test('V5 — skipping N3 (+00:00 not converted to Z)', () => {
  const skipped = hashCanonical({
    version: '1',
    network: 'eip155:8453',
    resourceUrl: URL,
    payer: CANON,
    issuedAt: '2026-10-15T11:41:25+00:00',
  });
  assert.equal(skipped, '19675963950a9bca6db9b2d439a8fcd0fc13b3d18fae68124f82967daa67018b');
  assert.notEqual(skipped, V1);
});

test('V6 — skipping N3 (same instant written as +08:00)', () => {
  const skipped = hashCanonical({
    version: '1',
    network: 'eip155:8453',
    resourceUrl: URL,
    payer: CANON,
    issuedAt: '2026-10-15T19:41:25+08:00',
  });
  assert.equal(skipped, '904a4bd315e01441c3515455ee57cc5fae30d9f68a36169c09655cc44d750269');
  assert.notEqual(skipped, V1);
});

test('V7 — skipping N2 (network namespace not lowercased)', () => {
  const skipped = hashCanonical({
    version: '1',
    network: 'EIP155:8453',
    resourceUrl: URL,
    payer: CANON,
    issuedAt: '2026-10-15T11:41:25Z',
  });
  assert.equal(skipped, 'd0e93c56bb4030c2dc969c3a5fa9c8143fe6c6f1fa579a5127e497aad58e50f7');
  assert.notEqual(skipped, V1);
});

test('NEG-1 — absent member emitted as null instead of omitted', () => {
  const skipped = hashCanonical({
    version: '1',
    network: 'eip155:8453',
    resourceUrl: URL,
    payer: CANON,
    issuedAt: null,
  });
  assert.equal(skipped, '0b40b83300c14889316c7939cf6726c7044ab23a957276e8e8fcc5439c2ad696');
  assert.notEqual(skipped, V1);
});

test('NEG-2 — hash taken over encoded bytes instead of decoded payload', () => {
  const canonical = jcsCanonicalize({
    version: '1',
    network: 'eip155:8453',
    resourceUrl: URL,
    payer: CANON,
    issuedAt: '2026-10-15T11:41:25Z',
  });
  const encoded = Buffer.from(canonical, 'utf8').toString('base64url');
  const skipped = createHash('sha256').update(encoded, 'utf8').digest('hex');

  assert.equal(skipped, 'e1d62d5897a7be15ce22fd2ec82366cde17f46467dde6dd2949d1ed46e251d70');
  assert.notEqual(skipped, V1);
});

test('every negative vector is distinct from every other', () => {
  const negatives = [
    'f368a5a271757ac8f33371fe6349c6f0a2519b4c305f3ac2106f7a51f6aa48c2',
    '19675963950a9bca6db9b2d439a8fcd0fc13b3d18fae68124f82967daa67018b',
    '904a4bd315e01441c3515455ee57cc5fae30d9f68a36169c09655cc44d750269',
    'd0e93c56bb4030c2dc969c3a5fa9c8143fe6c6f1fa579a5127e497aad58e50f7',
    '0b40b83300c14889316c7939cf6726c7044ab23a957276e8e8fcc5439c2ad696',
    'e1d62d5897a7be15ce22fd2ec82366cde17f46467dde6dd2949d1ed46e251d70',
  ];
  assert.equal(new Set(negatives).size, negatives.length);
  for (const n of negatives) assert.notEqual(n, V1);
});
