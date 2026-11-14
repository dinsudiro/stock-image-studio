const APP_ORIGIN = 'https://dinsudiro.github.io';
const MODELS = {
  openai: 'gpt-image-2.5-flare',
  gemini: 'gemini-2.5-flash-image',
  flux: 'flux-2-pro',
};
function decodeBase64(value) {
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0));
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
      headers.set('Access-Control-Allow-Headers', 'Content-Type');
    }

    if (new URL(request.url).pathname !== '/') return reply(404, { error: 'Not found.' });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method === 'GET') return reply(200, { model: MODELS.openai, providers: MODELS, authentication: 'provider-key' });
    if (request.method !== 'POST') return reply(405, { error: 'Use POST.' });

    if (origin !== APP_ORIGIN) return reply(403, { error: 'Open Stock Image Studio to use BYOK.' });
    if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return reply(415, { error: 'Expected a JSON request.' });
    }

    let input;
    try {
      input = await readInput(request);
    } catch (error) {
      if (error instanceof ProviderError) return reply(error.status, { error: error.message });
      return reply(400, { error: 'Expected a JSON request.' });
    }

    const { provider = 'openai', action, key, prompt, quality } = input ?? {};
    if (!Object.hasOwn(MODELS, provider)) return reply(400, { error: 'Unsupported provider.' });
    // Gemini authorization keys can contain dots. The provider validates the credential.
    const keyPattern = provider === 'gemini' ? /^[A-Za-z0-9._-]{15,503}$/ : /^[A-Za-z0-9_-]{15,503}$/;
    if (typeof key !== 'string' || !keyPattern.test(key) ||
        (provider === 'openai' && !key.startsWith('sk-'))) {
      return reply(400, { error: 'Paste the provider API key only, without spaces, quotes, or a Bearer prefix.' });
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

async function readInput(request) {
  const maxBytes = 65536;
  if (Number(request.headers.get('Content-Length')) > maxBytes) {
    throw new ProviderError(413, 'Request is too large.');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError('Missing body');
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        void reader.cancel().catch(() => {});
        throw new ProviderError(413, 'Request is too large.');
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}

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
  if (details.error?.details?.some?.(detail => detail?.reason === 'API_KEY_INVALID')) {
    throw new ProviderError(422, 'Google rejected this API key. Check that it is active in Google AI Studio.');
  }
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
