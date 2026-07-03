const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const REVERSE: Record<string, number> = {};
for (let i = 0; i < ALPHABET.length; i++) REVERSE[ALPHABET[i]!] = i;

/** base64 → Uint8Array (no data: prefix, ignores whitespace). */
export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const length = Math.floor((clean.length * 3) / 4);
  const bytes = new Uint8Array(length);
  let out = 0;
  for (let i = 0; i + 1 < clean.length; i += 4) {
    const n =
      (REVERSE[clean[i]!]! << 18) |
      (REVERSE[clean[i + 1]!]! << 12) |
      ((REVERSE[clean[i + 2]!] ?? 0) << 6) |
      (REVERSE[clean[i + 3]!] ?? 0);
    if (out < length) bytes[out++] = (n >> 16) & 0xff;
    if (i + 2 < clean.length && out < length) bytes[out++] = (n >> 8) & 0xff;
    if (i + 3 < clean.length && out < length) bytes[out++] = n & 0xff;
  }
  return bytes;
}

/** Uint8Array → base64. Hermes has no btoa; this is fast enough for book-size files. */
export function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    out +=
      ALPHABET[b0 >> 2]! +
      ALPHABET[((b0 & 3) << 4) | (b1 >> 4)]! +
      (i + 1 < bytes.length ? ALPHABET[((b1 & 15) << 2) | (b2 >> 6)]! : '=') +
      (i + 2 < bytes.length ? ALPHABET[b2 & 63]! : '=');
    if (out.length >= 65536) {
      parts.push(out);
      out = '';
    }
  }
  parts.push(out);
  return parts.join('');
}
