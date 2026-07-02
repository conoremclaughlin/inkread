const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

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
