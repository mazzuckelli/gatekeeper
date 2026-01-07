import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';

/**
 * Auth Page for Dawg Tag
 *
 * This page handles authentication requests from Dawg Tag.
 * Flow:
 * 1. Dawg Tag opens: /auth?callback=dawgtag://auth-callback
 * 2. User logs in with email/password
 * 3. On success, redirect to callback with user_id
 *
 * This is specifically for the Dawg Tag auth flow.
 */

export default function Auth() {
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get callback URL
  const callbackUrl = searchParams.get('callback');

  // Validate callback URL
  const isValidCallback = callbackUrl && (
    callbackUrl.startsWith('dawgtag://') ||
    callbackUrl.startsWith('exp://') || // Expo development
    callbackUrl.startsWith('https://')
  );

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isValidCallback) {
      setError('Invalid callback URL');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Authenticate with Supabase
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        throw authError;
      }

      if (!data.user) {
        throw new Error('Login failed - no user returned');
      }

      // Build callback URL with user_id
      const redirectUrl = new URL(callbackUrl!);
      redirectUrl.searchParams.set('user_id', data.user.id);
      redirectUrl.searchParams.set('status', 'success');

      // Sign out from web session (we only needed to verify credentials)
      // The user_id is what Dawg Tag needs, not a session
      await supabase.auth.signOut();

      // Redirect to Dawg Tag
      window.location.href = redirectUrl.toString();
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    if (callbackUrl) {
      const redirectUrl = new URL(callbackUrl);
      redirectUrl.searchParams.set('status', 'cancelled');
      window.location.href = redirectUrl.toString();
    }
  };

  // Show error if no valid callback
  if (!isValidCallback) {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <div className="auth-header">
            <h1>GATEKEEPER</h1>
            <p>Authentication Error</p>
          </div>
          <div className="error-message">
            Invalid or missing callback URL. This page should be opened from Dawg Tag.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <h1>GATEKEEPER</h1>
          <p>Sign in to continue to your app</p>
        </div>

        {error && <div className="error-message">{error}</div>}

        <form className="auth-form" onSubmit={handleLogin}>
          <div className="form-group">
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={loading}
              autoComplete="email"
              autoFocus
            />
          </div>

          <div className="form-group">
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
              autoComplete="current-password"
            />
          </div>

          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <button
          className="btn-secondary"
          onClick={handleCancel}
          disabled={loading}
          style={{ marginTop: '16px' }}
        >
          Cancel
        </button>

        <div style={{ marginTop: '24px', textAlign: 'center' }}>
          <p style={{ color: '#666', fontSize: '12px' }}>
            Your credentials are verified by Gatekeeper.
            <br />
            Your identity stays private with Dawg Tag.
          </p>
        </div>
      </div>
    </div>
  );
}
