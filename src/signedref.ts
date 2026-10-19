import { createHash } from 'node:crypto';
import { jcsCanonicalize } from './jcs.js';

/**
 * SPEC-14: a reference to a separately signed artifact.
 *
 * The reference is NOT automatically a digest of the transmitted bytes. What a
 * signature covers is decided by the artifact's own scheme, and it is not the
 * same object for every scheme:
 *
 *   - a scheme that signs bytes covers the transmitted bytes;
 *   - a scheme that signs a structured message — EIP-712 typed fields together
 *     with their domain, for example — covers that message, which is unchanged
 *     by member order or whitespace.
 *
 * So three identifiers are in play and none of them can stand in for another:
 *
 *   - **operation identity** — the attempt's own identity, derived from named
 *     decoded fields (SPEC-2). Not derived from wire bytes, so that settle and
 *     refusal agree.
 *   - **captured-artifact digest** — a digest of bytes as transmitted. It
 *     identifies one exact capture: two serializations of the same signed
 *     content give two different values.
 *   - **signed-content identifier** — the identifier the scheme actually
 *     verifies, computed by that format's declared recipe.
 *
 * The two failure modes point in opposite directions. Canonicalizing before
 * hashing verifies a different object than the one a byte-signing scheme
 * signed. Hashing the wire envelope verifies a different object than the one a
 * typed-field scheme signed. That is why one digest cannot serve all three.
 *
 * An earlier version of this rule said "the signature covers those bytes" and
 * left it at that. It is true for one family of schemes and false for another,
 * and the clause did not say which — the same fault SPEC-12 had: **the rule's
 * reason was supplied by something outside the rule.** The executable answer is
 * that `signedArtifactReference` has no overload without a declaration. The
 * reference cannot be computed without stating which of the three it is,
 * because the format decides what was signed, not this code.
 */

export type ReferenceKind = 'operation' | 'captured' | 'signed-content';

/** What a format declares about the identifier its reference carries. */
export interface ReferenceDeclaration {
  readonly covers: Exclude<ReferenceKind, 'operation'>;
  /** Which recipe produces the identifier: `'transmitted-bytes'`, or the name
   *  of the format's own message recipe. */
  readonly input: string;
  readonly version: string;
}

export interface TransmittedArtifact {
  /** The artifact exactly as transmitted. */
  readonly bytes: string;
  /** The decoded signed message, for a scheme that signs a message rather than
   *  bytes. Absent for a byte-signing scheme. */
  readonly message?: unknown;
}

export function capturedArtifactDigest(bytes: string): string {
  return createHash('sha256').update(bytes, 'utf8').digest('hex');
}

/**
 * The identifier the scheme verifies, by its declared recipe. This
 * implementation knows two recipes; a format declaring another one supplies its
 * own, because the recipe is the format's to name and not ours to guess.
 */
export function signedContentIdentifier(
  artifact: TransmittedArtifact,
  declaration: ReferenceDeclaration,
): string {
  if (declaration.input === 'transmitted-bytes') {
    return capturedArtifactDigest(artifact.bytes);
  }
  if (artifact.message === undefined) {
    throw new TypeError(
      `SPEC-14: recipe "${declaration.input}" signs a message, but this artifact carries none`,
    );
  }
  return createHash('sha256').update(jcsCanonicalize(artifact.message), 'utf8').digest('hex');
}

export function signedArtifactReference(
  artifact: TransmittedArtifact,
  declaration: ReferenceDeclaration,
): string {
  switch (declaration.covers) {
    case 'captured':
      return capturedArtifactDigest(artifact.bytes);
    case 'signed-content':
      return signedContentIdentifier(artifact, declaration);
  }
}
