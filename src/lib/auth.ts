const COOKIE_NAME = 'session';
const MAX_AGE_MS = 8 * 60 * 60 * 1000;

function secretKeyData(): Uint8Array {
  const s = process.env.AUTH_SECRET || '';
  return new TextEncoder().encode(s);
}

async function hmacKey(operations: KeyUsage[]) {
  return await crypto.subtle.importKey('raw', secretKeyData(), { name: 'HMAC', hash: 'SHA-256' }, false, operations);
}

export async function signTimestamp(timestamp: string): Promise<string> {
  const key = await hmacKey(['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(timestamp));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

export async function verifySession(value: string | undefined): Promise<boolean> {
  if (!value || !process.env.AUTH_SECRET || !process.env.AUTH_PASSWORD) return false;
  const dot = value.indexOf('.');
  if (dot <= 0) return false;
  const timestamp = value.slice(0, dot);
  const sigHex = value.slice(dot + 1);
  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum)) return false;
  const age = Date.now() - tsNum;
  if (age < 0 || age >= MAX_AGE_MS) return false;
  try {
    const key = await hmacKey(['verify']);
    const expected = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(timestamp));
    const given = hexToBytes(sigHex);
    if (given.length !== expected.length) return false;
    return await crypto.subtle.verify('HMAC', key, given, new TextEncoder().encode(timestamp));
  } catch {
    return false;
  }
}

export { COOKIE_NAME, MAX_AGE_MS };
