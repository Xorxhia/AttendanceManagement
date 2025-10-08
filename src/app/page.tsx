'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function Home() {
  const router = useRouter();

  // we render optimistically; no blocking loader on first paint
  const [redirecting, setRedirecting] = useState(false);

  // messages
  const [signingIn, setSigningIn] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Mobile hero → form auto-switch (4s)
  const [mobileStage, setMobileStage] = useState<'hero' | 'form'>('hero');

  useEffect(() => {
    // staged intro only on mobile
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches) {
      const t = setTimeout(() => setMobileStage('form'), 4000);
      return () => clearTimeout(t);
    }
  }, []);

  // Do auth check in background; only block if we actually redirect
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!mounted) return;
        if (data.session) {
          setRedirecting(true);         // show overlay loader to avoid flicker
          router.push('/admin');
        }
      } catch (e: any) {
        // don't block UI; surface error only if you want
        // setErr(e?.message || 'Auth check failed');
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') {
        setRedirecting(true);
        router.push('/admin');
      }
    });

    return () => {
      mounted = false;
      sub?.subscription.unsubscribe();
    };
  }, [router]);

  // --- LOGIN ONLY -----------------------------------------------------------
  async function signIn(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (signingIn) return;

    setSigningIn(true);
    setErr(null);
    setMsg(null);

    const fd = new FormData(e.currentTarget);
    let identifier = String(fd.get('identifier') || '').trim();
    const password = String(fd.get('password') || '');

    if (!identifier || !password) {
      setErr('Please enter your email/username and password.');
      setSigningIn(false);
      return;
    }

    let email = identifier;

    try {
      // If user typed a username, look up email via RPC
      if (!identifier.includes('@')) {
        const { data, error } = await supabase.rpc('email_for_username', {
          p_username: identifier.toLowerCase(),
        });
        if (error) throw error;
        if (!data) {
          setErr('Invalid email/username or password.');
          setSigningIn(false);
          return;
        }
        email = data as string;
      }

      const { error } = await supabase.auth.signInWithPassword({ email, password });

      if (error) {
        setErr('Invalid email/username or password.');
        setSigningIn(false);
        return;
      }

      setMsg('Sign in successful. Redirecting...');
      setRedirecting(true);
      router.push('/admin');
    } catch (e: any) {
      setErr(e?.message || 'Unexpected error during sign in.');
      setSigningIn(false);
    }
  }

  return (
    <div className={`signin-container mobile-stage-${mobileStage}`}>
      {/* Redirect overlay only when we actually navigate away */}
      {redirecting && (
        <div className="redirect-overlay" aria-live="polite" aria-busy="true">
          <div className="loading-spinner" aria-hidden />
          <p>Redirecting…</p>
        </div>
      )}

      <div className="signin-left">
        <div className="signin-brand">
          <div className="brand-logo">AH</div>
          <h1 className="brand-title">AttendanceHub</h1>
          <p className="brand-subtitle">
            Professional attendance management system designed for modern businesses.
            Streamline your workforce tracking with enterprise-grade security and reliability.
          </p>
          <h6
            className="brand-title"
            style={{ fontSize: '20px', color: '#217dffff', fontWeight: 400, lineHeight: 1.6 }}
          >
            Ryan Solutions © 2025. All rights reserved.
          </h6>
        </div>
      </div>

      <div className="signin-right">
        <div className="signin-card">
          <div className="signin-header">
            <h2 className="signin-title">Welcome Back</h2>
            <p className="signin-description">Sign in to access your dashboard</p>
          </div>

          <form onSubmit={signIn} className="signin-form">
            <div className="input-group">
              <label htmlFor="identifier" className="input-label">Email or Username</label>
              <input
                id="identifier"
                name="identifier"
                className="signin-input"
                placeholder="admin@company.com"
                autoComplete="username"
                required
              />
            </div>

            <div className="input-group">
              <label htmlFor="password" className="input-label">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                className="signin-input"
                placeholder="••••••••"
                autoComplete="current-password"
                required
              />
            </div>

            <button type="submit" className="signin-button" disabled={signingIn} aria-busy={signingIn}>
              {signingIn ? 'Signing in…' : 'Sign In'}
            </button>
          </form>

          {err && (
            <div className="message error-message" aria-live="polite">
              <span className="message-icon">✕</span>
              {err}
            </div>
          )}

          {msg && (
            <div className="message success-message" aria-live="polite">
              <span className="message-icon">✓</span>
              {msg}
            </div>
          )}

          <div className="signin-footer">
            <p>© 2025 AttendanceHub. All rights reserved.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
