import React, { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  isWebAuthnSupported,
  isPlatformAuthenticatorAvailable,
  authenticateWithPasskey,
} from '../lib/webauthn';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // WebAuthn state
  const [webAuthnSupported, setWebAuthnSupported] = useState(false);
  const [platformAuthAvailable, setPlatformAuthAvailable] = useState(false);

  // Check for callback URL (from Dawg Tag)
  const callbackUrl = searchParams.get('callback');
  const appId = searchParams.get('app_id');

  // Check WebAuthn support on mount
  useEffect(() => {
    const checkWebAuthn = async () => {
      const supported = isWebAuthnSupported();
      setWebAuthnSupported(supported);
      if (supported) {
        const platformAvailable = await isPlatformAuthenticatorAvailable();
        setPlatformAuthAvailable(platformAvailable);
      }
    };
    checkWebAuthn();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !password) {
      setError('Please enter email and password');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await signIn(email, password);

      // If there's a callback URL, handle it
      if (callbackUrl) {
        // TODO: Generate token and redirect to callback
        // For now, just navigate to dashboard
        navigate('/');
      } else {
        navigate('/');
      }
    } catch (err: any) {
      setError(err.message || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  const handlePasskeyLogin = async () => {
    setPasskeyLoading(true);
    setError(null);

    try {
      const result = await authenticateWithPasskey();

      if (result.success && result.userId) {
        // If there's a callback URL, redirect with token
        if (callbackUrl) {
          // TODO: Generate secure token and redirect
          // For now, redirect with user_id (NOT SECURE - needs token implementation)
          const redirectUrl = new URL(callbackUrl);
          redirectUrl.searchParams.set('user_id', result.userId);
          redirectUrl.searchParams.set('tier', result.tier || 'free');
          if (appId) {
            redirectUrl.searchParams.set('app_id', appId);
          }
          window.location.href = redirectUrl.toString();
        } else {
          // No callback - this is direct web login
          // Passkey auth doesn't create a session, so redirect to email/password
          setError('Passkey verified, but no callback URL provided. Please use email/password to sign in to the dashboard.');
        }
      } else {
        setError(result.error || 'Passkey authentication failed');
      }
    } catch (err: any) {
      setError(err.message || 'Passkey authentication failed');
    } finally {
      setPasskeyLoading(false);
    }
  };

  const canUsePasskey = webAuthnSupported && platformAuthAvailable;

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <h1>GATEKEEPER</h1>
          <p>
            {callbackUrl
              ? 'Sign in to continue to your app'
              : 'Sign in to your account'
            }
          </p>
        </div>

        {/* Passkey Login (Primary option when available) */}
        {canUsePasskey && (
          <>
            <button
              className="btn-passkey"
              onClick={handlePasskeyLogin}
              disabled={passkeyLoading || loading}
            >
              {passkeyLoading ? (
                'Authenticating...'
              ) : (
                <>
                  <span className="passkey-icon">🔐</span>
                  Sign in with Passkey
                </>
              )}
            </button>

            <div className="auth-divider">
              <span>or use email</span>
            </div>
          </>
        )}

        <form onSubmit={handleSubmit} className="auth-form">
          {error && <div className="error-message">{error}</div>}

          <div className="form-group">
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading || passkeyLoading}
              autoComplete="email"
            />
          </div>

          <div className="form-group">
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading || passkeyLoading}
              autoComplete="current-password"
            />
          </div>

          <button type="submit" className="btn-primary" disabled={loading || passkeyLoading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>

          <div className="auth-footer">
            <p>
              Don't have an account? <Link to="/register">Create Account</Link>
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
