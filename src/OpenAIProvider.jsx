import { useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';

const endpoint = import.meta.env.VITE_OPENAI_WORKER_URL;

export const providers = {
  openai: 'OpenAI Images',
  gemini: 'Google Gemini',
  flux: 'FLUX · Black Forest Labs',
};

export async function requestProvider(user, body) {
  let response;
  const token = await user.getIdToken();
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    throw new Error('The generation backend is unreachable. Try again later.');
  }
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || 'The generation backend could not complete this request.');
  }
  if (body.action === 'generate') {
    if (!/^image\/(png|jpeg|webp)(;|$)/i.test(response.headers.get('content-type') ?? '')) {
      throw new Error('The generation backend returned an unexpected file.');
    }
    return response.blob();
  }
  return response.json();
}

export default function ProviderSettings({ user, connected, onConnect, onDisconnect }) {
  const [provider, setProvider] = useState('openai');
  const [key, setKey] = useState('');
  const [available, setAvailable] = useState(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!endpoint) {
      setAvailable(false);
      return;
    }
    const controller = new AbortController();
    fetch(endpoint, { cache: 'no-store', signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(data => setAvailable(data?.providers ?? (data?.model ? { openai: data.model } : false)))
      .catch(() => { if (!controller.signal.aborted) setAvailable(false); });
    return () => controller.abort();
  }, []);

  const connection = connected[provider];
  const supported = Boolean(available?.[provider]);

  async function verify(event) {
    event.preventDefault();
    const enteredKey = key.trim();
    if (!supported || !user || !enteredKey || busy) return;
    setBusy(true);
    setError('');
    try {
      const { model } = await requestProvider(user, { provider, key: enteredKey, action: 'verify' });
      onConnect(provider, { key: enteredKey, model });
      setKey('');
    } catch (problem) {
      setError(problem.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h3>AI providers · BYOK</h3>
      <label htmlFor="byok-provider">Provider</label>
      <select id="byok-provider" value={provider} disabled={busy} onChange={event => {
        setKey('');
        setError('');
        setProvider(event.target.value);
      }}>
        {Object.entries(providers).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select>
      <div className="provider">
        <div className="providericon"><KeyRound size={18}/></div>
        <div>
          <b>{providers[provider]}</b>
          <small>{connection ? 'Key verified · ' + connection.model : 'Disconnected'}</small>
        </div>
      </div>
      {available === undefined && <p role="status">Checking the generation backend…</p>}
      {available === false && <p role="status">The Cloudflare Worker is unavailable. Check its deployment and URL before verifying your key.</p>}
      {!user && <p>Sign in under Firebase workspace to connect an API key.</p>}
      {available && !supported && <p role="status">Deploy the latest Worker to enable {providers[provider]}.</p>}
      {supported && user && !connection && (
        <form onSubmit={verify} autoComplete="off">
          <label htmlFor="openai-key">{providers[provider]} API key</label>
          <input id="openai-key" type="password" autoComplete="off" spellCheck={false}
            value={key} onChange={event => setKey(event.target.value)} maxLength={503} required />
          <button className="primary full" disabled={busy || !key.trim()}>
            {busy ? 'Checking key…' : 'Verify and connect'}
          </button>
        </form>
      )}
      {connection && <button className="outline full" onClick={() => { setError(''); onDisconnect(provider); }}>Disconnect provider</button>}
      {error && <p role="alert">{error}</p>}
      <p className="notice">The key stays in memory for this tab session. Image requests use the selected provider’s billing and quota.</p>
    </section>
  );
}
