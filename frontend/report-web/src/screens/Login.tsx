import { useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { usernameEmail } from '../../../../shared/username.mjs';

export default function Login() {
  const [creating, setCreating] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase || pending.current) return;
    let email: string;
    try { email = usernameEmail(username); }
    catch { setError('Use 3–24 letters, numbers or underscores for your username.'); return; }
    pending.current = true; setBusy(true); setError('');
    let created = false;
    try {
      if (creating) {
        const result = await supabase.functions.invoke('username-signup', {
          body: { username: username.trim().toLowerCase(), password },
          signal: AbortSignal.timeout(35000),
        });
        if (result.error || result.data?.created !== true) {
          const status = result.error?.context?.status;
          setError(status === 409 ? 'That username is taken. Try another one.'
            : status === 429 ? 'Signups are busy right now. Please try again later.'
            : 'Could not create your account. Try another username and a password with at least 8 characters.');
          return;
        }
        created = true;
      }
      const { error: loginError } = await supabase.auth.signInWithPassword({ email, password });
      if (loginError) {
        if (created) setCreating(false);
        setError(created ? 'Account created. Please sign in with your username and password.'
          : loginError.status === 429 ? 'Too many attempts. Please wait a moment and try again.'
          : 'Incorrect username or password. Please try again.');
      } else { setPassword(''); }
    } catch {
      if (created) setCreating(false);
      setError(created ? 'Account created. Please sign in with your username and password.'
        : 'Could not connect. Please check your connection and try again.');
    } finally { pending.current = false; setBusy(false); }
  }

  return <div className="login-wrap"><div className="login-card">
    <span className="login-pin" aria-hidden="true">📍</span>
    <h1 className="login-title">Someone&apos;s Houston</h1>
    <p className="login-sub">{creating ? 'Create your account. Find your Houston.' : 'Your Houston starts here.'}</p>
    <form onSubmit={submit} className="login-form">
      <label className="login-label">Username
        <input type="text" required autoComplete="username" autoCapitalize="none" spellCheck={false}
          minLength={3} maxLength={24} pattern="[A-Za-z0-9_]{3,24}" aria-describedby="username-help"
          value={username} onChange={event => setUsername(event.target.value)} placeholder="Your username" disabled={busy} />
      </label>
      <p id="username-help" className="login-help">3–24 letters, numbers or underscores. Usernames aren’t case-sensitive.</p>
      <label className="login-label">Password
        <input type="password" required autoComplete={creating ? 'new-password' : 'current-password'}
          minLength={creating ? 8 : 1} maxLength={128} value={password}
          onChange={event => setPassword(event.target.value)} placeholder={creating ? 'At least 8 characters' : 'Your password'} disabled={busy} />
      </label>
      <button type="submit" className="btn btn-primary login-submit" disabled={busy}>
        {busy ? (creating ? 'Creating account…' : 'Signing in…') : creating ? 'Create account' : 'Sign in'}
      </button>
    </form>
    <button type="button" className="login-switch" disabled={busy} onClick={() => {
      setCreating(!creating); setError(''); setPassword('');
    }}>{creating ? 'Already have an account? Sign in' : 'New here? Create account'}</button>
    {error && <p className="login-error" role="alert">{error}</p>}
  </div></div>;
}
