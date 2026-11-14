const PROJECT_ID = 'stock-image-studio';
const APP_ORIGIN = 'https://dinsudiro.github.io';
const MODELS = {
  openai: 'gpt-image-2.5-flare',
  gemini: 'gemini-2.5-flash-image',
  flux: 'flux-2-pro',
};
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
    if (request.method === 'GET') return reply(200, { model: MODELS.openai, providers: MODELS });
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

    const { provider = 'openai', action, key, prompt, quality } = input ?? {};
    if (!Object.hasOwn(MODELS, provider)) return reply(400, { error: 'Unsupported provider.' });
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{15,503}$/.test(key) ||
        (provider === 'openai' && !key.startsWith('sk-'))) {
      return reply(400, { error: 'Enter a valid API key for the selected provider.' });
    }

    const generating = action === 'generate';
    if (!generating && action !== 'verify') return reply(400, { error: 'Unsupported action.' });
    if (generating && (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 12000 ||
        !['medium', 'high'].includes(quality))) {
      return reply(400, { error: 'Check the prompt and output quality.' });
    }

    try {
      const model = MODELS[provider];
      const signal = AbortSignal.timeout(generating ? 180000 : 12000);
      const result = await runProvider(provider, { key, model, prompt, quality, generating, signal });
      if (!generating) return reply(200, { model });
      if (!result) return reply(502, { error: 'The provider returned no usable image.' });
      headers.set('Content-Type', result.type);
      return new Response(result.body, { headers });
    } catch (error) {
      return reply(error instanceof ProviderError ? error.status : 502, {
        error: error instanceof ProviderError ? error.message : 'The provider could not be reached or timed out.',
      });
    }
  },
};

class ProviderError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function fetchProvider(url, options) {
  const response = await fetch(url, { ...options, redirect: 'error' });
  if (response.ok) return response;
  const details = await response.json().catch(() => ({}));
  const code = details.error?.code;
  if (response.status === 402 || ['billing_hard_limit_reached', 'insufficient_quota'].includes(code)) {
    throw new ProviderError(402, 'Check billing and credits for this provider.');
  }
  const errors = {
    400: 'The provider rejected the request. Check the key or prompt.',
    401: 'The provider rejected this API key.',
    403: 'The provider denied access. Check API key permissions, model access, and billing.',
    404: 'The selected model or provider resource is unavailable.',
    429: 'The provider rate limit or quota was reached.',
  };
  throw new ProviderError(response.status === 401 ? 422 : errors[response.status] ? response.status : 502,
    errors[response.status] ?? 'The provider could not complete the request.');
}

function imageFromBase64(data, type) {
  if (typeof data !== 'string' || !data || !['image/png', 'image/jpeg', 'image/webp'].includes(type)) return null;
  return { body: decodeBase64(data), type };
}

function safeBflUrl(value, allowedHost) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.port || url.username || url.password || !allowedHost(url.hostname)) {
    throw new ProviderError(502, 'FLUX returned an unexpected URL.');
  }
  return url;
}

async function runProvider(provider, { key, model, prompt, quality, generating, signal }) {
  const json = { 'Content-Type': 'application/json' };
  if (provider === 'openai') {
    const headers = { ...json, Authorization: 'Bearer ' + key };
    const url = 'https://api.openai.com/v1/' + (generating ? 'images/generations' : 'models/' + model);
    const body = generating ? JSON.stringify({
      model, prompt, quality, n: 1, size: '1024x1024', output_format: 'png', background: 'transparent',
    }) : undefined;
    const response = await fetchProvider(url, { method: generating ? 'POST' : 'GET', headers, body, signal });
    if (!generating) return;
    return imageFromBase64((await response.json()).data?.[0]?.b64_json, 'image/png');
  }

  if (provider === 'gemini') {
    const url = 'https://generativelanguage.googleapis.com/v1/models/' + model;
    const headers = { ...json, 'x-goog-api-key': key };
    const body = generating ? JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1' } },
    }) : undefined;
    const response = await fetchProvider(url + (generating ? ':generateContent' : ''),
      { method: generating ? 'POST' : 'GET', headers, body, signal });
    if (!generating) return;
    const result = await response.json();
    const image = result.candidates?.flatMap(candidate => candidate.content?.parts ?? [])
      .find(part => part.inlineData?.data)?.inlineData;
    return imageFromBase64(image?.data, image?.mimeType);
  }

  const base = 'https://api.bfl.ai/v1/';
  const headers = { ...json, 'x-key': key };
  if (!generating) {
    await fetchProvider(base + 'credits', { headers, signal });
    return;
  }
  const submitted = await fetchProvider(base + model, {
    method: 'POST', headers, signal,
    body: JSON.stringify({ prompt, width: 1024, height: 1024, output_format: 'png' }),
  });
  const task = await submitted.json();
  const poll = safeBflUrl(task.polling_url, host => ['api.bfl.ai', 'api.eu.bfl.ai', 'api.us.bfl.ai'].includes(host));
  if (poll.pathname !== '/v1/get_result') throw new ProviderError(502, 'FLUX returned an unexpected polling path.');
  for (let attempt = 0; attempt < 35; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 1800));
    const result = await (await fetchProvider(poll, { headers, signal })).json();
    if (result.status === 'Ready') {
      const delivery = safeBflUrl(result.result?.sample, host => /^delivery\.[a-z0-9-]+\.bfl\.ai$/.test(host));
      const image = await fetchProvider(delivery, { signal });
      const type = image.headers.get('Content-Type')?.split(';')[0];
      if (['image/png', 'image/jpeg', 'image/webp'].includes(type)) return { body: image.body, type };
      return null;
    }
    if (result.status !== 'Pending' && result.status !== 'Processing') {
      throw new ProviderError(422, 'FLUX did not complete this image. Check the prompt or provider dashboard.');
    }
  }
  throw new ProviderError(504, 'FLUX is still processing. Check the provider dashboard before retrying.');
}
