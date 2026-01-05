import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

/**
 * Security Settings Page
 *
 * NOTE: Ghost identity reset has been moved to Dawg Tag.
 * This page now handles password and session management only.
 */

export default function Security() {
  const { user, signOut } = useAuth();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Security</h1>
        <p>Manage your account security settings</p>
      </div>

      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}

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
