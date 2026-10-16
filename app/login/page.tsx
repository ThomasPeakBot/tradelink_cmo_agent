'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, ShieldCheck, TrendingUp } from 'lucide-react';
export default function Login() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <main className="login-shell">
      <section className="login-story">
        <div className="brand">
          <span className="brand-icon">
            <TrendingUp size={22} />
          </span>
          TradeLink<span className="brand-dot">●</span>
        </div>
        <div>
          <span className="eyebrow">YOUR GROWTH, WITH INTENTION</span>
          <h1>
            A clear path.
            <br />A sharper CMO.
          </h1>
          <p>
            Company knowledge, growth signals, and the next right move. All in one operating system.
          </p>
          <div className="login-trajectory">
            <span>50</span>
            <div />
            <span>5,000</span>
          </div>
          <small>ONE COMPANY. TWELVE MONTHS. A SHARED AMBITION.</small>
        </div>
        <span className="muted">TradeLink CMO OS · V1</span>
      </section>
      <section className="login-form">
        <div>
          <span className="pill">
            <ShieldCheck size={14} /> INTERNAL WORKSPACE
          </span>
          <h2>Welcome back.</h2>
          <p className="muted">Sign in to your growth command center.</p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              const form = new FormData(e.currentTarget);
              try {
                const res = await fetch('/api/auth/login', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(Object.fromEntries(form)),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error);
                router.replace('/');
                router.refresh();
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Sign in failed');
                setBusy(false);
              }
            }}
          >
            <label>
              Email address
              <input
                name="email"
                type="email"
                autoComplete="username"
                placeholder="you@tradelink.com"
                required
              />
            </label>
            <label>
              Password
              <input name="password" type="password" autoComplete="current-password" required />
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="btn primary" disabled={busy}>
              {busy ? 'Signing in…' : 'Enter workspace'}
              <ArrowRight size={17} />
            </button>
          </form>
          <p className="login-note">
            Access is restricted to authorized internal users.
            <br />
            All workspace changes are recorded in the audit log.
          </p>
        </div>
      </section>
    </main>
  );
}
