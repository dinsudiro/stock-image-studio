export const IMAGE_MODEL = 'gpt-image-2.5-flare';

export async function handleOpenAI(req, res, { verifyToken, fetchUpstream = fetch }) {
  res.set('Cache-Control', 'no-store');
  if (req.method === 'GET') return res.json({ model: IMAGE_MODEL });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });

  const token = req.get('Authorization')?.match(/^Bearer (\S+)$/)?.[1];
  if (!token) return res.status(401).json({ error: 'Sign in to Firebase first.' });
  try {
    await verifyToken(token);
  } catch {
    return res.status(401).json({ error: 'Your session expired. Sign in again.' });
  }

  const { key, action, prompt, quality } = req.body ?? {};
  if (typeof key !== 'string' || !/^sk-[A-Za-z0-9_-]{20,500}$/.test(key)) {
    return res.status(400).json({ error: 'Enter a valid OpenAI project API key.' });
  }
  const generating = action === 'generate';
  if (!generating && action !== 'verify') return res.status(400).json({ error: 'Unsupported action.' });
  if (generating && (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 12000 ||
    !['medium', 'high'].includes(quality))) {
    return res.status(400).json({ error: 'Check the prompt and output quality.' });
  }

  const headers = { Authorization: 'Bearer ' + key };
  const path = generating ? 'images/generations' : 'models/' + IMAGE_MODEL;
  const body = generating ? JSON.stringify({
    model: IMAGE_MODEL, prompt, quality, n: 1,
    size: '1024x1024', output_format: 'png', background: 'transparent',
  }) : undefined;
  if (generating) headers['Content-Type'] = 'application/json';

  try {
    const upstream = await fetchUpstream('https://api.openai.com/v1/' + path, {
      method: generating ? 'POST' : 'GET', headers, body,
      redirect: 'error', signal: AbortSignal.timeout(generating ? 180000 : 10000),
    });
    if (!upstream.ok) {
      const details = await upstream.json().catch(() => ({}));
      const messages = {
        400: 'OpenAI rejected the request. Check the prompt and model options.',
        401: 'OpenAI rejected this key. Check that it is active.',
        403: 'The OpenAI project or key lacks access to the image model.',
        404: 'The image model is unavailable to this OpenAI project.',
        429: 'OpenAI rate or quota limits were reached.',
      };
      const code = details.error?.code;
      const billing = ['billing_hard_limit_reached', 'insufficient_quota'].includes(code);
      const status = messages[upstream.status] ? (upstream.status === 401 ? 422 : upstream.status) : 502;
      return res.status(status).json({ error: billing ? 'Check billing and credits in your OpenAI project.' :
        messages[upstream.status] ?? 'OpenAI could not complete the request.' });
    }
    if (!generating) return res.json({ model: IMAGE_MODEL });

    const result = await upstream.json();
    const image = result.data?.[0]?.b64_json;
    if (!image) return res.status(502).json({ error: 'OpenAI returned no image.' });
    return res.type('image/png').send(Buffer.from(image, 'base64'));
  } catch {
    return res.status(502).json({ error: 'Could not reach OpenAI or the request timed out.' });
  }
}
