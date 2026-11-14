const PROJECT_ID = 'stock-image-studio';
const APP_ORIGIN = 'https://dinsudiro.github.io';
const MODEL = 'gpt-image-2.5-flare';
const KEY_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let keyCache;

function decodeBase64(value) {
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0));
}

async function firebaseKey(kid) {
  if (!keyCache || keyCache.expires <= Date.now()) {
    const response = await fetch(KEY_URL, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Firebase keys unavailable');
    const { keys } = await response.json();
    const maxAge = Number(response.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1] ?? 0);
    keyCache = { keys, expires: Date.now() + maxAge * 1000 };
  }
  const jwk = keyCache.keys.find(key => key.kid === kid);
  if (!jwk) throw new Error('Unknown signing key');
  return crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
}

async function verifyFirebaseToken(token) {
  if (!token || token.length > 8192 || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) return false;
  const [header, payload, signature] = token.split('.');
  const decoder = new TextDecoder();
  const { alg, kid } = JSON.parse(decoder.decode(decodeBase64(header)));
  if (alg !== 'RS256' || typeof kid !== 'string') return false;

  const claims = JSON.parse(decoder.decode(decodeBase64(payload)));
  const now = Math.floor(Date.now() / 1000);
  if (claims.aud !== PROJECT_ID || claims.iss !== 'https://securetoken.google.com/' + PROJECT_ID ||
      typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 128 ||
      !Number.isSafeInteger(claims.exp) || claims.exp <= now ||
      !Number.isSafeInteger(claims.iat) || claims.iat > now ||
      !Number.isSafeInteger(claims.auth_time) || claims.auth_time > now) return false;

  return crypto.subtle.verify('RSASSA-PKCS1-v1_5', await firebaseKey(kid),
    decodeBase64(signature), new TextEncoder().encode(header + '.' + payload));
}

export default {
  async fetch(request) {
    const headers = new Headers({ 'Cache-Control': 'no-store', Vary: 'Origin' });
    const origin = request.headers.get('Origin');
    const reply = (status, body) => Response.json(body, { status, headers });
    if (origin && origin !== APP_ORIGIN) return reply(403, { error: 'Origin not allowed.' });
    if (origin) {
      headers.set('Access-Control-Allow-Origin', APP_ORIGIN);
      headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    }

    if (new URL(request.url).pathname !== '/') return reply(404, { error: 'Not found.' });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method === 'GET') return reply(200, { model: MODEL });
    if (request.method !== 'POST') return reply(405, { error: 'Use POST.' });

    const token = request.headers.get('Authorization')?.match(/^Bearer (\S+)$/)?.[1];
    const valid = await verifyFirebaseToken(token).catch(() => false);
    if (!valid) return reply(401, { error: 'Sign in to Firebase first, or sign in again.' });

    const length = request.headers.get('Content-Length');
    if (length !== null && Number(length) > 65536) return reply(413, { error: 'Request is too large.' });
    const raw = await request.text();
    if (raw.length > 65536) return reply(413, { error: 'Request is too large.' });
    let input;
    try {
      input = JSON.parse(raw);
    } catch {
      return reply(400, { error: 'Expected a JSON request.' });
    }

    const { action, key, prompt, quality } = input ?? {};
    if (typeof key !== 'string' || !/^sk-[A-Za-z0-9_-]{20,500}$/.test(key)) {
      return reply(400, { error: 'Enter a valid OpenAI project API key.' });
    }

    const generating = action === 'generate';
    if (!generating && action !== 'verify') return reply(400, { error: 'Unsupported action.' });
    if (generating && (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 12000 ||
        !['medium', 'high'].includes(quality))) {
      return reply(400, { error: 'Check the prompt and output quality.' });
    }

    const path = generating ? 'images/generations' : 'models/' + MODEL;
    const body = generating ? JSON.stringify({
      model: MODEL, prompt, quality, n: 1,
      size: '1024x1024', output_format: 'png', background: 'transparent',
    }) : undefined;
    try {
      const upstream = await fetch('https://api.openai.com/v1/' + path, {
        method: generating ? 'POST' : 'GET',
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body, redirect: 'error', signal: AbortSignal.timeout(generating ? 180000 : 10000),
      });
      if (!upstream.ok) {
        const details = await upstream.json().catch(() => ({}));
        const errors = {
          400: 'OpenAI rejected the request. Check the prompt and model options.',
          401: 'OpenAI rejected this key. Check that it is active.',
          403: 'The OpenAI project or key lacks access to the image model.',
          404: 'The image model is unavailable to this OpenAI project.',
          429: 'OpenAI rate or quota limits were reached.',
        };
        const billing = ['billing_hard_limit_reached', 'insufficient_quota'].includes(details.error?.code);
        const status = upstream.status === 401 ? 422 : errors[upstream.status] ? upstream.status : 502;
        return reply(status, { error: billing ? 'Check billing and credits in your OpenAI project.' :
          errors[upstream.status] ?? 'OpenAI could not complete the request.' });
      }
      if (!generating) return reply(200, { model: MODEL });
      const result = await upstream.json();
      const image = result.data?.[0]?.b64_json;
      if (!image) return reply(502, { error: 'OpenAI returned no image.' });
      headers.set('Content-Type', 'image/png');
      return new Response(decodeBase64(image), { headers });
    } catch {
      return reply(502, { error: 'Could not reach OpenAI or the request timed out.' });
    }
  },
};
