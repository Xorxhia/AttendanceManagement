'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function Home() {
  const router = useRouter();
  const [authLoading, setAuthLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Check if user is already logged in and redirect
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error) setErr(error.message);
      if (data.session) {
        // User is already logged in, redirect to admin
        router.push('/admin');
      } else {
        setAuthLoading(false);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') {
        router.push('/admin');
      }
    });
    return () => sub?.subscription.unsubscribe();
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

      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setErr('Invalid email/username or password.');
        setSigningIn(false);
        return;
      }

      setMsg('Sign in successful. Redirecting...');
      router.push('/admin');
    } catch (e: any) {
      setErr(e?.message || 'Unexpected error during sign in.');
    } finally {
      setSigningIn(false);
    }
  }

  // --- UI -------------------------------------------------------------------
  if (authLoading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="signin-container">
      <div className="signin-left">
        <div className="signin-brand">
          <div className="brand-logo">AH</div>
          <h1 className="brand-title">AttendanceHub</h1>
          <p className="brand-subtitle">
            Professional attendance management system designed for modern businesses.
            Streamline your workforce tracking with enterprise-grade security and reliability.
          </p>
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
