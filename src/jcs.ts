/**
 * JSON Canonicalization Scheme (RFC 8785).
 *
 * Scope note, stated honestly: this implements the JCS subset the invariant
 * actually needs — objects, arrays, strings, booleans, null, and numbers that
 * round-trip through ES6 `Number::toString` without entering exponential form.
 * The number path throws outside that range rather than silently emitting a
 * serialization another implementation might disagree with. A divergent number
 * is exactly the failure class this work is about, so refusing is correct
 * behaviour here, not a gap to be papered over.
 */

const isFiniteNumber = (n: number): boolean => Number.isFinite(n);

/**
 * RFC 8785 §3.2.2.3: numbers use ES6 Number::toString. JS String(n) matches for
 * the range we accept. -0 serializes as "0".
 */
function serializeNumber(n: number): string {
  if (!isFiniteNumber(n)) {
    throw new TypeError('JCS: NaN and Infinity cannot be serialized as JSON');
  }
  if (n === 0) return '0';

  const s = String(n);
  if (/[eE]/.test(s)) {
    throw new RangeError(
      `JCS: number ${s} requires exponential serialization; outside this implementation's accepted range`,
    );
  }
  return s;
}

/** RFC 8785 §3.2.2.2: minimal escaping, UTF-8 output. */
function serializeString(s: string): string {
  return JSON.stringify(s);
}

/** RFC 8785 §3.2.3: object keys sorted by UTF-16 code units. */
function compareUtf16(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function serialize(value: unknown): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      return serializeNumber(value);
    case 'string':
      return serializeString(value);
    case 'object':
      break;
    default:
      throw new TypeError(`JCS: cannot serialize value of type ${typeof value}`);
  }

  if (Array.isArray(value)) {
    return `[${value.map(serialize).join(',')}]`;
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined);
  keys.sort(compareUtf16);
  return `{${keys.map((k) => `${serializeString(k)}:${serialize(obj[k])}`).join(',')}}`;
}

export function jcsCanonicalize(value: unknown): string {
  return serialize(value);
}
