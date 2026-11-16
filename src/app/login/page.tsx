'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, ArrowRight, X, AlertCircle } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const from = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('from') : null;
    if (from && from !== '/login') (window as any).__loginReturn = from;
  }, []);

  const press = (digit: string) => {
    setError('');
    if (code.length >= 4) return;
    setCode((c) => (c === '0' ? digit : c + digit));
  };
  const clear = () => { setCode(''); setError(''); };
  const back = () => setCode((c) => c.slice(0, -1));

  const submit = async () => {
    if (code.length !== 4) { setError('Enter 4 digits'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: code }) });
      if (!res.ok) { setError('Incorrect passkey'); setCode(''); return; }
      const from = (window as any).__loginReturn || '/';
      router.push(from);
      router.refresh();
    } catch { setError('Passkey service unavailable'); } finally { setBusy(false); }
  };

  return (
    <div className="login-shell" role="dialog" aria-modal="true" aria-labelledby="login-title">
      <div className="login-card">
        <div className="login-header">
          <Lock size={30} className="login-icon" aria-hidden="true" />
          <h1 id="login-title">Access passkey</h1>
          <p className="login-sub">Enter the 4-digit passkey to open Budgetium.</p>
        </div>
        {error && <div className="login-error" role="alert"><AlertCircle size={18} aria-hidden="true" /><span>{error}</span></div>}
        <div className="login-display">
          {code.split('').map((d, i) => <span key={i} className="login-digit">{d}</span>)}
          {Array.from({ length: 4 - code.length }).map((_, i) => (
            <span key={`e${i}`} className="login-digit login-empty" aria-hidden="true"> </span>
          ))}
        </div>
        <div className="login-keypad">
          {['7','8','9','4','5','6','1','2','3','0'].map((d) => (
            <button key={d} type="button" className="login-key" onClick={() => press(d)} aria-label={`Digit ${d}`}>{d}</button>
          ))}
          <button type="button" className="login-key login-key-wide" onClick={clear} aria-label="Clear"><X size={20} /></button>
          <button type="button" className="login-key login-key-zero" onClick={() => press('0')} aria-label="Digit 0">0</button>
          <button type="button" className="login-key login-key-enter" onClick={submit} disabled={busy || code.length !== 4} aria-label="Enter passkey"><ArrowRight size={20} /></button>
        </div>
        <p className="login-note">Passkey required. Sessions last 8 hours.</p>
      </div>
    </div>
  );
}
