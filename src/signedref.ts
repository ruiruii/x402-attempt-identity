import { createHash } from 'node:crypto';

/**
 * SPEC-14: a reference to a separately signed artifact.
 *
 * The reference is taken over the artifact AS TRANSMITTED, because the
 * signature covers those bytes. Canonicalizing first would verify a different
 * object than the one that was signed — it would name an artifact nobody ever
 * signed, and the signature check would then fail for a reason that looks like
 * tampering but is actually our own transformation.
 *
 * This is the mirror of SPEC-2 and deliberately not the same rule: an
 * artifact's OWN identity comes from named decoded fields (so it survives a
 * different key order), while a REFERENCE to an artifact someone else signed
 * comes from the bytes that were signed (which do not survive a different key
 * order, because the signature does not either). Two objects, two rules. The
 * failure mode is applying one of them to both.
 */
export function signedArtifactReference(transmittedBytes: string): string {
  return createHash('sha256').update(transmittedBytes, 'utf8').digest('hex');
}
