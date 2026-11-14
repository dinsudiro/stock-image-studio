import { useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';

const endpoint = import.meta.env.VITE_OPENAI_WORKER_URL;

export async function requestOpenAI(user, body) {
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
    throw new Error('The OpenAI backend is unreachable. Try again later.');
  }
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || 'The OpenAI backend could not complete this request.');
  }
  if (body.action === 'generate') {
    if (!response.headers.get('content-type')?.startsWith('image/png')) {
      throw new Error('The OpenAI backend returned an unexpected file.');
    }
    return response.blob();
  }
  return response.json();
}

export default function OpenAIProvider({ user, connected, onConnect, onDisconnect }) {
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
      .then(data => setAvailable(Boolean(data?.model)))
      .catch(() => { if (!controller.signal.aborted) setAvailable(false); });
    return () => controller.abort();
  }, []);

  async function verify(event) {
    event.preventDefault();
    const enteredKey = key.trim();
    if (!available || !user || !enteredKey || busy) return;
    setBusy(true);
    setError('');
    try {
      const { model } = await requestOpenAI(user, { key: enteredKey, action: 'verify' });
      onConnect({ key: enteredKey, model, uid: user.uid });
      setKey('');
    } catch (problem) {
      setError(problem.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h3>OpenAI · BYOK</h3>
      <div className="provider">
        <div className="providericon"><KeyRound size={18}/></div>
        <div>
          <b>OpenAI Images</b>
          <small>{connected ? 'Key verified · ' + connected.model : 'Disconnected'}</small>
        </div>
      </div>
      {available === undefined && <p role="status">Checking the generation backend…</p>}
      {available === false && <p role="status">The Cloudflare Worker is unavailable. Check its deployment and URL before verifying your key.</p>}
      {!user && <p>Sign in under Firebase workspace to connect an API key.</p>}
      {available && user && !connected && (
        <form onSubmit={verify} autoComplete="off">
          <label htmlFor="openai-key">OpenAI project API key</label>
          <input id="openai-key" type="password" autoComplete="off" spellCheck={false}
            value={key} onChange={event => setKey(event.target.value)} maxLength={503} required />
          <button className="primary full" disabled={busy || !key.trim()}>
            {busy ? 'Checking key…' : 'Verify and connect'}
          </button>
        </form>
      )}
      {connected && <button className="outline full" onClick={() => { setError(''); onDisconnect(); }}>Disconnect OpenAI</button>}
      {error && <p role="alert">{error}</p>}
      <p className="notice">The key stays in memory for this tab session. OpenAI bills image requests to your API project.</p>
    </section>
  );
}
