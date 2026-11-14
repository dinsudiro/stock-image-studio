import { useState } from 'react';
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { doc, getDocFromServer, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase';

const messages = {
  'auth/email-already-in-use': 'This email already has an account. Sign in with your password.',
  'auth/invalid-credential': 'Check your email and password.',
  'auth/weak-password': 'Choose a stronger password.',
  'auth/popup-closed-by-user': 'The Google sign-in window was closed.',
  'auth/popup-blocked': 'Allow pop-ups for this site to sign in with Google.',
  'auth/unauthorized-domain': 'This domain needs to be authorized in Firebase Authentication.',
  'auth/operation-not-allowed': 'Enable this sign-in provider in Firebase Authentication.',
  'permission-denied': 'Firestore denied access. Check the workspace security rules.',
  'unavailable': 'Firestore is unavailable. Try again when you are online.',
};

export default function CloudWorkspace({ user, workspace, onLoad }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function run(operation) {
    setMessage('');
    setBusy(true);
    try {
      setMessage((await operation()) ?? '');
    } catch (error) {
      setMessage(messages[error.code] ?? 'The operation failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function submit(event) {
    event.preventDefault();
    const authenticate = register ? createUserWithEmailAndPassword : signInWithEmailAndPassword;
    run(async () => {
      await authenticate(auth, email.trim(), password);
      setPassword('');
    });
  }

  async function save() {
    const ref = doc(db, 'studioWorkspaces', user.uid);
    await setDoc(ref, { ...workspace, updatedAt: serverTimestamp() });
    return 'Workspace saved to Firestore.';
  }

  async function load() {
    const snapshot = await getDocFromServer(doc(db, 'studioWorkspaces', user.uid));
    if (!snapshot.exists()) return 'You do not have a cloud workspace yet.';
    const { skills, jobs, assets } = snapshot.data();
    if (![skills, jobs, assets].every(Array.isArray)) return 'The cloud workspace format is invalid.';
    if (auth.currentUser?.uid !== user.uid) return;
    onLoad({ skills, jobs, assets });
    return 'Cloud workspace loaded into this browser.';
  }

  return (
    <div className="settingblock cloudWorkspace">
      <h4>Firebase workspace</h4>
      {!auth && <p>Firebase configuration is pending. Drafts are stored in this browser.</p>}
      {auth && (user === undefined ? <p>Checking your session…</p> : user ? (
        <>
          <p>Signed in as {user.email ?? user.displayName}. Saving replaces your cloud copy. Loading replaces your browser drafts.</p>
          <div className="cloudActions">
            <button className="primary" disabled={busy} onClick={() => run(save)}>Save to cloud</button>
            <button className="outline" disabled={busy} onClick={() => run(load)}>Load cloud copy</button>
            <button className="outline" disabled={busy} onClick={() => run(async () => { await signOut(auth); })}>Sign out</button>
          </div>
        </>
      ) : (
        <>
          <form onSubmit={submit}>
            <label htmlFor="cloud-email">Email</label>
            <input id="cloud-email" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required />
            <label htmlFor="cloud-password">Password</label>
            <input id="cloud-password" type="password" autoComplete={register ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} required />
            <div className="cloudActions">
              <button type="submit" className="primary" disabled={busy}>{register ? 'Create account' : 'Sign in'}</button>
              <button type="button" className="outline" disabled={busy} onClick={() => { setRegister(!register); setMessage(''); }}>
                {register ? 'Use an existing account' : 'Register with email'}
              </button>
            </div>
          </form>
          <button className="outline full" disabled={busy} onClick={() => run(async () => { await signInWithPopup(auth, new GoogleAuthProvider()); })}>
            Continue with Google
          </button>
        </>
      ))}
      <p role="status">{message}</p>
    </div>
  );
}
