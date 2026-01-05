import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

/**
 * Dashboard - Account Overview
 *
 * NOTE: Ghost ID display has been moved to Dawg Tag.
 * This dashboard now shows account info and subscription status.
 * Gatekeeper knows WHO you are, Dawg Tag handles app connections.
 */

interface ProfileSummary {
  subscription_tier: string;
  subscription_status: string;
  subscription_expires_at: string | null;
  created_at: string;
  last_seen_at: string;
}

export default function Dashboard() {
  const { user, session } = useAuth();
  const [profile, setProfile] = useState<ProfileSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session?.access_token) {
      fetchProfile();
    }
  }, [session]);

  const fetchProfile = async () => {
    if (!session?.access_token) return;

    try {
      setLoading(true);
      const response = await fetch(
        `${import.meta.env.VITE_GATEKEEPER_URL}/functions/v1/user-profile`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch profile');
      }

      const data = await response.json();
      setProfile(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString();
  };

  if (loading) {
    return (
      <div className="page-container">
        <div className="loading-container">
          <div className="loading-spinner" />
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Dashboard</h1>
        <p>Your Gatekeeper account overview</p>
      </div>

      {error && <div className="error-message">{error}</div>}

      {/* Privacy Notice */}
      <div className="privacy-banner">
        <span className="privacy-icon">🔒</span>
        <div>
          <strong>Privacy by Design</strong>
          <p>Gatekeeper manages your identity. Your app connections and activity are handled by Dawg Tag on your device.</p>
        </div>
      </div>

      <div className="card-grid">
        {/* Account Info */}
        <div className="card">
          <h2>Account</h2>
          <div className="info-row">
            <span className="label">Email:</span>
            <span className="value">{user?.email}</span>
          </div>
          <div className="info-row">
            <span className="label">Member Since:</span>
            <span className="value">{formatDate(profile?.created_at || user?.created_at || null)}</span>
          </div>
          <div className="info-row">
            <span className="label">Last Active:</span>
            <span className="value">{formatDate(profile?.last_seen_at || null)}</span>
          </div>
        </div>

        {/* Subscription Info */}
        <div className="card">
          <h2>Subscription</h2>
          <div className="info-row">
            <span className="label">Tier:</span>
            <span className="value tier-badge">{profile?.subscription_tier || 'free'}</span>
          </div>
          <div className="info-row">
            <span className="label">Status:</span>
            <span className={`value status-${profile?.subscription_status || 'active'}`}>
              {profile?.subscription_status || 'Active'}
            </span>
          </div>
          {profile?.subscription_expires_at && (
            <div className="info-row">
              <span className="label">Renews:</span>
              <span className="value">{formatDate(profile.subscription_expires_at)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Dawg Tag Notice */}
      <div className="card">
        <h2>App Connections</h2>
        <div className="info-note">
          <p>
            Your app connections and ghost identity are managed by <strong>Dawg Tag</strong> on your device.
            This ensures that even Gatekeeper cannot see which apps you use or link your identity to your activity.
          </p>
          <p style={{ marginTop: '0.5rem', opacity: 0.7 }}>
            Open Dawg Tag to view and manage your connected apps.
          </p>
        </div>
      </div>
    </div>
  );
}
