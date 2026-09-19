import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

export default function Login() {
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'send' | 'verify' | null>(null);
  const pending = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const remaining = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const codeInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!resendAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [resendAt]);

  useEffect(() => { if (sentTo) codeInput.current?.focus(); }, [sentTo]);

  async function sendCode(event?: React.FormEvent) {
    event?.preventDefault();
    if (!supabase || pending.current || Date.now() < resendAt) return;
    const address = sentTo || email.trim();
    if (!address) return;
    pending.current = true;
    setBusy('send');
    setError('');
    setNotice('');
    try {
      const { error: sendError } = await supabase.auth.signInWithOtp({ email: address, options: { shouldCreateUser: true } });
      if (sendError) {
        if (sendError.status === 429) {
          setResendAt(Date.now() + 60000);
          setNow(Date.now());
          setError('Please wait a minute before requesting another code.');
        } else { setError('We couldn’t send your sign-in email. Please try again shortly.'); }
        return;
      }
      setSentTo(address);
      setCode('');
      setNow(Date.now());
      setResendAt(Date.now() + 60000);
      setNotice('Check your inbox for a sign-in code. If your email contains a sign-in link instead, open it to continue. It may take a moment to arrive.');
      codeInput.current?.focus();
    } catch { setError('Could not connect. Please check your connection and try again.'); }
    finally { pending.current = false; setBusy(null); }
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase || pending.current || !/^\d{6,10}$/.test(code)) return;
    pending.current = true;
    setBusy('verify');
    setError('');
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({ email: sentTo, token: code, type: 'email' });
      if (verifyError) setError(verifyError.status === 429
        ? 'Too many attempts. Please wait a minute and try again.'
        : 'That code is invalid or has expired. Try again or request a new code.');
    } catch { setError('Could not verify your code. Please try again.'); }
    finally { pending.current = false; setBusy(null); }
  }

  function changeEmail() {
    if (pending.current) return;
    setSentTo('');
    setCode('');
    setError('');
    setNotice('');
  }

  return <div className="login-wrap"><div className="login-card">
    <span className="login-pin" aria-hidden="true">📍</span>
    <h1 className="login-title">Someone&apos;s Houston</h1>
    <p className="login-sub">{sentTo ? 'Check your email to continue.' : 'Your Houston starts here.'}</p>
    {!sentTo ? <>
      <form onSubmit={sendCode} className="login-form">
        <label className="login-label">Email
          <input type="email" required autoComplete="email" autoCapitalize="none" spellCheck={false}
            value={email} onChange={event => setEmail(event.target.value)} placeholder="you@company.com" disabled={Boolean(busy)} />
        </label>
        <button type="submit" className="btn btn-primary login-submit" disabled={Boolean(busy) || remaining > 0}>
          {busy === 'send' ? 'Sending email…' : remaining > 0 ? 'Send email in ' + remaining + 's' : 'Continue with email'}
        </button>
      </form>
      <p className="login-help">New here? Verify your email to get started. No password needed.</p>
    </> : <>
      <p className="login-address">Sign-in email sent to <strong>{sentTo}</strong></p>
      <form onSubmit={verifyCode} className="login-form">
        <label className="login-label">Email code
          <input ref={codeInput} className="login-code" type="text" inputMode="numeric" autoComplete="one-time-code"
            pattern="[0-9]{6,10}" minLength={6} maxLength={10} required value={code}
            onChange={event => setCode(event.target.value.replace(/\s/g, '').replace(/[^0-9]/g, '').slice(0, 10))}
            placeholder="Enter your code" disabled={Boolean(busy)} />
        </label>
        <button type="submit" className="btn btn-primary login-submit" disabled={Boolean(busy) || !/^\d{6,10}$/.test(code)}>
          {busy === 'verify' ? 'Verifying…' : 'Verify and continue'}
        </button>
      </form>
      <div className="login-code-actions">
        <button type="button" className="login-switch" disabled={Boolean(busy) || remaining > 0} onClick={() => { void sendCode(); }}>
          {busy === 'send' ? 'Sending…' : remaining > 0 ? 'Resend email in ' + remaining + 's' : 'Resend email'}
        </button>
        <button type="button" className="login-switch" disabled={Boolean(busy)} onClick={changeEmail}>Use another email</button>
      </div>
    </>}
    {error && <p className="login-error" role="alert">{error}</p>}
    {notice && <p className="login-notice" role="status">{notice}</p>}
  </div></div>;
}
