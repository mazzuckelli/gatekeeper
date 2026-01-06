import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import {
  isWebAuthnSupported,
  isPlatformAuthenticatorAvailable,
  registerPasskey,
  listPasskeys,
  deletePasskey,
} from '../lib/webauthn';

/**
 * Security Settings Page
 *
 * Handles password management, session management, and passkey registration.
 */

interface Passkey {
  id: string;
  credential_id: string;
  device_name: string;
  authenticator_type: string;
  created_at: string;
  last_used_at: string | null;
  is_active: boolean;
}

export default function Security() {
  const { user } = useAuth();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Passkey state
  const [webAuthnSupported, setWebAuthnSupported] = useState(false);
  const [platformAuthAvailable, setPlatformAuthAvailable] = useState(false);
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [loadingPasskeys, setLoadingPasskeys] = useState(true);
  const [registeringPasskey, setRegisteringPasskey] = useState(false);
  const [deletingPasskeyId, setDeletingPasskeyId] = useState<string | null>(null);

  // Check WebAuthn support on mount
  useEffect(() => {
    const checkWebAuthn = async () => {
      setWebAuthnSupported(isWebAuthnSupported());
      const platformAvailable = await isPlatformAuthenticatorAvailable();
      setPlatformAuthAvailable(platformAvailable);
    };
    checkWebAuthn();
  }, []);

  // Load passkeys on mount
  useEffect(() => {
    loadPasskeys();
  }, []);

  const loadPasskeys = async () => {
    setLoadingPasskeys(true);
    const result = await listPasskeys();
    if (result.success && result.passkeys) {
      setPasskeys(result.passkeys);
    }
    setLoadingPasskeys(false);
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match');
      return;
    }

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    try {
      setChangingPassword(true);

      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) throw error;

      setSuccess('Password updated successfully');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setChangingPassword(false);
    }
  };

  const handleRegisterPasskey = async () => {
    if (!user) return;

    setError(null);
    setSuccess(null);
    setRegisteringPasskey(true);

    const result = await registerPasskey(user.id, user.email || '', undefined);

    if (result.success) {
      setSuccess('Passkey registered successfully! You can now use biometrics to sign in.');
      await loadPasskeys();
    } else {
      setError(result.error || 'Failed to register passkey');
    }

    setRegisteringPasskey(false);
  };

  const handleDeletePasskey = async (passkeyId: string) => {
    if (!confirm('Are you sure you want to remove this passkey?')) {
      return;
    }

    setError(null);
    setDeletingPasskeyId(passkeyId);

    const result = await deletePasskey(passkeyId);

    if (result.success) {
      setSuccess('Passkey removed');
      await loadPasskeys();
    } else {
      setError(result.error || 'Failed to remove passkey');
    }

    setDeletingPasskeyId(null);
  };

  const handleSignOutAllDevices = async () => {
    if (!confirm('This will sign you out of all devices including this one. Continue?')) {
      return;
    }

    try {
      await supabase.auth.signOut({ scope: 'global' });
      window.location.href = '/login';
    } catch (err: any) {
      setError(err.message);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Security</h1>
        <p>Manage your account security settings</p>
      </div>

      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}

      {/* Passkeys Section */}
      <div className="card">
        <h2>Passkeys</h2>
        <p className="info-note">
          Use your device's biometrics (fingerprint or face) to sign in without a password.
        </p>

        {!webAuthnSupported ? (
          <div className="warning-message">
            Passkeys are not supported in this browser.
          </div>
        ) : !platformAuthAvailable ? (
          <div className="warning-message">
            Your device doesn't support biometric authentication.
          </div>
        ) : (
          <>
            {/* Registered Passkeys List */}
            {loadingPasskeys ? (
              <div className="loading-inline">Loading passkeys...</div>
            ) : passkeys.length > 0 ? (
              <div className="passkey-list">
                {passkeys.map((passkey) => (
                  <div key={passkey.id} className="passkey-item">
                    <div className="passkey-info">
                      <div className="passkey-name">
                        <span className="passkey-icon">🔐</span>
                        {passkey.device_name}
                      </div>
                      <div className="passkey-meta">
                        Added {formatDate(passkey.created_at)}
                        {passkey.last_used_at && (
                          <> • Last used {formatDate(passkey.last_used_at)}</>
                        )}
                      </div>
                    </div>
                    <button
                      className="btn-danger-small"
                      onClick={() => handleDeletePasskey(passkey.id)}
                      disabled={deletingPasskeyId === passkey.id}
                    >
                      {deletingPasskeyId === passkey.id ? 'Removing...' : 'Remove'}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="no-passkeys">
                No passkeys registered yet.
              </div>
            )}

            {/* Register New Passkey Button */}
            <button
              className="btn-primary"
              onClick={handleRegisterPasskey}
              disabled={registeringPasskey}
              style={{ marginTop: '16px' }}
            >
              {registeringPasskey ? 'Registering...' : 'Register New Passkey'}
            </button>
          </>
        )}
      </div>

      {/* Change Password */}
      <form onSubmit={handleChangePassword}>
        <div className="card">
          <h2>Change Password</h2>

          <div className="form-group">
            <label htmlFor="newPassword">New Password</label>
            <input
              type="password"
              id="newPassword"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Enter new password"
              minLength={8}
            />
          </div>

          <div className="form-group">
            <label htmlFor="confirmPassword">Confirm New Password</label>
            <input
              type="password"
              id="confirmPassword"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              minLength={8}
            />
          </div>

          <button type="submit" className="btn-primary" disabled={changingPassword}>
            {changingPassword ? 'Updating...' : 'Update Password'}
          </button>
        </div>
      </form>

      {/* Session Management */}
      <div className="card">
        <h2>Sessions</h2>
        <p className="info-note">
          If you suspect unauthorized access to your account, you can sign out of all devices.
        </p>
        <button className="btn-secondary" onClick={handleSignOutAllDevices}>
          Sign Out All Devices
        </button>
      </div>

      {/* Ghost Identity Notice */}
      <div className="card">
        <h2>Ghost Identity</h2>
        <div className="info-note">
          <p>
            Your ghost identity is managed by <strong>Dawg Tag</strong> on your device.
            To reset your ghost identity or manage app connections, use the Dawg Tag app.
          </p>
        </div>
      </div>

      {/* Account Info */}
      <div className="card">
        <h2>Account Information</h2>
        <div className="info-row">
          <span className="label">Email:</span>
          <span className="value">{user?.email}</span>
        </div>
        <div className="info-row">
          <span className="label">Account Created:</span>
          <span className="value">
            {user?.created_at ? new Date(user.created_at).toLocaleDateString() : 'N/A'}
          </span>
        </div>
        <div className="info-row">
          <span className="label">Last Sign In:</span>
          <span className="value">
            {user?.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString() : 'N/A'}
          </span>
        </div>
      </div>
    </div>
  );
}
