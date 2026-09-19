import { useState } from 'react';
import { supabase } from '../lib/supabase';

type Mode = 'sign-in' | 'sign-up';

export default function Login() {
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase || busy) return;
    setBusy(true);
    setError('');
    setNotice('');

    try {
      if (mode === 'sign-in') {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) setError(signInError.message);
        // On success the auth listener in App.tsx swaps in the app.
      } else {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (signUpError) {
          setError(signUpError.message);
        } else if (!data.session) {
          setNotice('Check your email to confirm your account, then sign in.');
          setMode('sign-in');
        }
      }
    } catch {
      setError('Could not connect to sign in. Please retry.');
    } finally { setBusy(false); }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <span className="login-pin" aria-hidden="true">
          📍
        </span>
        <h1 className="login-title">Someone&apos;s Houston</h1>
        <p className="login-sub">
          {mode === 'sign-in'
            ? 'Sign in to your recruiter workspace.'
            : 'Create a recruiter account.'}
        </p>

        <form onSubmit={handleSubmit} className="login-form">
          <label className="login-label">
            Email
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
            />
          </label>
          <label className="login-label">
            Password
            <input
              type="password"
              required
              minLength={6}
              autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </label>

          {error ? (
            <p className="login-error" role="alert">
              {error}
            </p>
          ) : null}
          {notice ? <p className="login-notice">{notice}</p> : null}

          <button type="submit" className="btn btn-primary login-submit" disabled={busy}>
            {busy ? 'One moment…' : mode === 'sign-in' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <button
          type="button"
          className="login-switch"
          disabled={busy}
          onClick={() => {
            setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in');
            setError('');
            setNotice('');
          }}
        >
          {mode === 'sign-in' ? 'New here? Create an account' : 'Already have an account? Sign in'}
        </button>
      </div>
    </div>
  );
}
