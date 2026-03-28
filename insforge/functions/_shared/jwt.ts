// JWT utility using Web Crypto API (HMAC-SHA256). Zero dependencies.

interface JWTPayload {
  sub: string;
  workspace_id: string;
  slack_user_id: string;
  iat: number;
  exp: number;
}

function base64urlEncode(data: Uint8Array): string {
  const binStr = Array.from(data, (b) => String.fromCharCode(b)).join('');
  return btoa(binStr).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const binStr = atob(padded);
  return Uint8Array.from(binStr, (c) => c.charCodeAt(0));
}

function textEncode(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

async function getKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    textEncode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function createJWT(
  payload: Omit<JWTPayload, 'iat' | 'exp'>,
  secret: string,
  expiresInSeconds = 7 * 24 * 60 * 60, // 7 days
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JWTPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  };

  const header = base64urlEncode(textEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = base64urlEncode(textEncode(JSON.stringify(fullPayload)));
  const signingInput = `${header}.${body}`;

  const key = await getKey(secret);
  const sig = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, textEncode(signingInput)),
  );

  return `${signingInput}.${base64urlEncode(sig)}`;
}

export async function verifyJWT(token: string, secret: string): Promise<JWTPayload> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');

  const [header, body, sig] = parts;
  const key = await getKey(secret);

  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    base64urlDecode(sig),
    textEncode(`${header}.${body}`),
  );

  if (!valid) throw new Error('Invalid JWT signature');

  const payload: JWTPayload = JSON.parse(
    new TextDecoder().decode(base64urlDecode(body)),
  );

  if (payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('JWT expired');
  }

  return payload;
}
