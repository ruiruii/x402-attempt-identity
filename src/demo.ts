import { captureAtIngress, type DecodedRequest } from './ingress.js';
import { idempotencyScope } from './scope.js';
import { DOWNSTREAM_PATHS, refusal, scopeAt } from './paths.js';
import { deriveReceiptId } from './receipt.js';
import { legacyScope } from './legacy.js';

const BASE = {
  version: '1',
  method: 'POST',
  network: 'eip155:8453',
  path: '/v1/report',
  payTo: '0x8ba1f109551bD432803012645Ac136ddd64DBA72',
  asset: 'USDC',
  amount: '1000000',
  scheme: 'exact',
};

/** Two requests that differ in both query and body. */
const requestA: DecodedRequest = { ...BASE, query: { a: '1', b: '2' }, body: { amount: '1' } };
const requestB: DecodedRequest = { ...BASE, query: { a: '1&b=2' }, body: { amount: '2' } };

function rule(title: string): void {
  process.stdout.write(`\n${title}\n${'-'.repeat(title.length)}\n`);
}

rule('1. Ingress derives once');

const frozenA = captureAtIngress(requestA);
const frozenB = captureAtIngress(requestB);

console.log(`attemptId(A) = ${frozenA.attemptId}`);
console.log(`attemptId(B) = ${frozenB.attemptId}`);
console.log(`request layer: two different requests are two attempts = ${
  frozenA.attemptId !== frozenB.attemptId
}`);

rule('2. Every downstream path resolves the same value');

for (const path of DOWNSTREAM_PATHS) {
  console.log(`${path.padEnd(28)} ${scopeAt(frozenA, path)}`);
}
const scopes = DOWNSTREAM_PATHS.map((p) => scopeAt(frozenA, p));
console.log(`all five identical            = ${new Set(scopes).size === 1}`);

rule('3. Refusal resolves the same value');

const refused = refusal(frozenA);
console.log(`refusal.scope  = ${refused.scope}`);
console.log(`settled        = ${refused.settled}`);
console.log(`same as settle = ${refused.scope === scopeAt(frozenA, 'settleOrChallengeQuote')}`);

rule('4. The two production bug classes, and what the invariant does about them');

console.log(`canonicalQuery(A) = ${frozenA.query}`);
console.log(`canonicalQuery(B) = ${frozenB.query}`);
console.log(`scope(A)          = ${idempotencyScope(frozenA)}`);
console.log(`scope(B)          = ${idempotencyScope(frozenB)}`);
console.log(`correct: distinct = ${idempotencyScope(frozenA) !== idempotencyScope(frozenB)}`);

const legacyA = legacyScope(requestA.path, requestA.query);
const legacyB = legacyScope(requestB.path, requestB.query);
console.log(`\nlegacyScope(A)    = ${legacyA}`);
console.log(`legacyScope(B)    = ${legacyB}`);
console.log(`legacy: COLLIDES  = ${legacyA === legacyB}`);

rule('5. Same rule, different named set — receiptId');

const receiptId = deriveReceiptId({
  version: '1',
  network: 'eip155:8453',
  resourceUrl: 'https://api.example.com/v1/report',
  payer: '0x8ba1f109551bD432803012645Ac136ddd64DBA72',
  issuedAt: '2026-10-15T11:41:25Z',
});
console.log(`receiptId                  = ${receiptId}`);
console.log(`same-instant +08:00 form   = ${deriveReceiptId({
  version: '1',
  network: 'eip155:8453',
  resourceUrl: 'https://api.example.com/v1/report',
  payer: '0x8ba1f109551bD432803012645Ac136ddd64DBA72',
  issuedAt: '2026-10-15T19:41:25+08:00',
})}`);
console.log(`one instant, one identifier = ${
  receiptId ===
  deriveReceiptId({
    version: '1',
    network: 'eip155:8453',
    resourceUrl: 'https://api.example.com/v1/report',
    payer: '0x8ba1f109551bD432803012645Ac136ddd64DBA72',
    issuedAt: '2026-10-15T19:41:25+08:00',
  })
}`);
