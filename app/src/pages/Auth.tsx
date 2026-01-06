import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  isWebAuthnSupported,
  isPlatformAuthenticatorAvailable,
  authenticateWithPasskey,
} from '../lib/webauthn';

/**
 * Auth Page for Dawg Tag
 *
 * This page handles authentication requests from Dawg Tag.
 * Flow:
 * 1. Dawg Tag opens: /auth?callback=dawgtag://auth-callback&app_id=goals
 * 2. User authenticates with passkey (biometric)
 * 3. On success, redirect to callback with user_id token
 *
 * This page is specifically designed for the Dawg Tag auth flow,
 * not for regular web dashboard login.
 */

export default function Auth() {
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  // WebAuthn state
  const [webAuthnSupported, setWebAuthnSupported] = useState(false);
  const [platformAuthAvailable, setPlatformAuthAvailable] = useState(false);

  // Get callback parameters
  const callbackUrl = searchParams.get('callback');
  const appId = searchParams.get('app_id');

  // Validate callback URL
  const isValidCallback = callbackUrl && (
    callbackUrl.startsWith('dawgtag://') ||
    callbackUrl.startsWith('exp://') || // Expo development
    callbackUrl.startsWith('https://')
  );

  // Check WebAuthn support on mount
  useEffect(() => {
    const checkWebAuthn = async () => {
      const supported = isWebAuthnSupported();
      setWebAuthnSupported(supported);
      if (supported) {
        const platformAvailable = await isPlatformAuthenticatorAvailable();
        setPlatformAuthAvailable(platformAvailable);
      }
      setChecking(false);
    };
    checkWebAuthn();
  }, []);

  const handleAuthenticate = async () => {
    if (!isValidCallback) {
      setError('Invalid callback URL');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await authenticateWithPasskey();

      if (result.success && result.userId) {
        // Build callback URL with authentication result
        const redirectUrl = new URL(callbackUrl!);
        redirectUrl.searchParams.set('user_id', result.userId);
        redirectUrl.searchParams.set('tier', result.tier || 'free');
        redirectUrl.searchParams.set('status', 'success');
        if (appId) {
          redirectUrl.searchParams.set('app_id', appId);
        }

        // Redirect to Dawg Tag
        window.location.href = redirectUrl.toString();
      } else {
        setError(result.error || 'Authentication failed');
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    if (callbackUrl) {
      const redirectUrl = new URL(callbackUrl);
      redirectUrl.searchParams.set('status', 'cancelled');
      if (appId) {
        redirectUrl.searchParams.set('app_id', appId);
      }
      window.location.href = redirectUrl.toString();
    }
  };

  // Show loading while checking WebAuthn
  if (checking) {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <div className="auth-header">
            <h1>GATEKEEPER</h1>
            <p>Checking device capabilities...</p>
          </div>
        </div>
      </div>
    );
  }

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

  // Show error if WebAuthn not supported
  if (!webAuthnSupported || !platformAuthAvailable) {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <div className="auth-header">
            <h1>GATEKEEPER</h1>
            <p>Device Not Supported</p>
          </div>
          <div className="warning-message">
            {!webAuthnSupported
              ? 'Your browser does not support passkey authentication.'
              : 'Your device does not support biometric authentication.'
            }
          </div>
          <p style={{ color: '#888', fontSize: '14px', marginTop: '16px', textAlign: 'center' }}>
            Please use a device with fingerprint or face recognition enabled.
          </p>
          {callbackUrl && (
            <button
              className="btn-secondary"
              onClick={handleCancel}
              style={{ marginTop: '20px' }}
            >
              Cancel and return to app
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <h1>GATEKEEPER</h1>
          <p>Verify your identity to continue</p>
        </div>

        {error && <div className="error-message">{error}</div>}

        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔐</div>
          <p style={{ color: '#888', fontSize: '14px', lineHeight: '1.5' }}>
            Tap the button below to authenticate with your device's biometrics
            (fingerprint or face recognition).
          </p>
        </div>

        <button
          className="btn-passkey"
          onClick={handleAuthenticate}
          disabled={loading}
          style={{ marginBottom: '16px' }}
        >
          {loading ? (
            'Authenticating...'
          ) : (
            <>
              <span className="passkey-icon">👆</span>
              Authenticate with Biometrics
            </>
          )}
        </button>

        <button
          className="btn-secondary"
          onClick={handleCancel}
          disabled={loading}
        >
          Cancel
        </button>

        <div style={{ marginTop: '24px', textAlign: 'center' }}>
          <p style={{ color: '#666', fontSize: '12px' }}>
            Don't have a passkey registered?
            <br />
            Sign in with email/password first, then register a passkey in Security settings.
          </p>
        </div>
      </div>
    </div>
  );
}
