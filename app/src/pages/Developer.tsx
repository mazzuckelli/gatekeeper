import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

interface RegisteredApp {
  id: string;
  app_id: string;
  app_name: string;
  app_description: string | null;
  organization_name: string | null;
  callback_urls: string[];
  allowed_origins: string[];
  is_active: boolean;
  is_verified: boolean;
  total_tokens_issued: number;
  total_users_connected: number;
  created_at: string;
  last_token_issued_at: string | null;
}

interface NewAppCredentials {
  app_id: string;
  app_name: string;
  shared_secret: string;
  api_key: string;
}

export default function Developer() {
  const { session } = useAuth();
  const [apps, setApps] = useState<RegisteredApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRegisterForm, setShowRegisterForm] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [newCredentials, setNewCredentials] = useState<NewAppCredentials | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    app_id: '',
    app_name: '',
    owner_email: '',
    description: '',
    organization_name: '',
    callback_urls: '',
    allowed_origins: '',
  });

  useEffect(() => {
    if (session?.access_token) {
      fetchApps();
    }
  }, [session]);

  const fetchApps = async () => {
    if (!session?.access_token) return;

    try {
      setLoading(true);
      setError(null);

      const response = await fetch(
        `${import.meta.env.VITE_GATEKEEPER_URL}/functions/v1/app-register`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch your apps');
      }

      const data = await response.json();
      setApps(data.apps || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.access_token) return;

    // Validate app_id format
    if (!/^[a-z0-9][a-z0-9-]{2,48}[a-z0-9]$/.test(formData.app_id)) {
      setError('App ID must be 4-50 lowercase letters, numbers, and hyphens. Must start and end with a letter or number.');
      return;
    }

    try {
      setRegistering(true);
      setError(null);

      // Parse URLs
      const callbackUrls = formData.callback_urls
        .split('\n')
        .map(url => url.trim())
        .filter(url => url.length > 0);

      const allowedOrigins = formData.allowed_origins
        .split('\n')
        .map(origin => origin.trim())
        .filter(origin => origin.length > 0);

      if (callbackUrls.length === 0) {
        setError('At least one callback URL is required');
        return;
      }

      const response = await fetch(
        `${import.meta.env.VITE_GATEKEEPER_URL}/functions/v1/app-register`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            app_id: formData.app_id,
            app_name: formData.app_name,
            owner_email: formData.owner_email,
            description: formData.description || undefined,
            organization_name: formData.organization_name || undefined,
            callback_urls: callbackUrls,
            allowed_origins: allowedOrigins.length > 0 ? allowedOrigins : undefined,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to register app');
      }

      // Show credentials (only shown once!)
      setNewCredentials({
        app_id: data.app.app_id,
        app_name: data.app.app_name,
        shared_secret: data.credentials.shared_secret,
        api_key: data.credentials.api_key,
      });

      // Reset form
      setFormData({
        app_id: '',
        app_name: '',
        owner_email: '',
        description: '',
        organization_name: '',
        callback_urls: '',
        allowed_origins: '',
      });
      setShowRegisterForm(false);

      // Refresh apps list
      fetchApps();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRegistering(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    alert(`${label} copied to clipboard!`);
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleDateString();
  };

  if (loading) {
    return (
      <div className="page-container">
        <div className="loading-container">
          <div className="loading-spinner" />
          <p>Loading your apps...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Developer</h1>
        <p>Register and manage your apps that integrate with Gatekeeper</p>
      </div>

      {error && <div className="error-message">{error}</div>}

      {/* New Credentials Modal */}
      {newCredentials && (
        <div className="modal-overlay">
          <div className="modal credentials-modal">
            <div className="modal-header warning">
              <h2>Save Your Credentials Now!</h2>
              <p>These credentials will NOT be shown again. Store them securely.</p>
            </div>

            <div className="modal-body">
              <div className="credential-item">
                <label>App ID</label>
                <div className="credential-value">
                  <code>{newCredentials.app_id}</code>
                </div>
              </div>

              <div className="credential-item">
                <label>Shared Secret (for token verification)</label>
                <div className="credential-value">
                  <code>{newCredentials.shared_secret}</code>
                  <button
                    className="btn-copy"
                    onClick={() => copyToClipboard(newCredentials.shared_secret, 'Shared secret')}
                  >
                    Copy
                  </button>
                </div>
              </div>

              <div className="credential-item">
                <label>API Key (for server-to-server calls)</label>
                <div className="credential-value">
                  <code>{newCredentials.api_key}</code>
                  <button
                    className="btn-copy"
                    onClick={() => copyToClipboard(newCredentials.api_key, 'API key')}
                  >
                    Copy
                  </button>
                </div>
              </div>

              <div className="next-steps">
                <h3>Next Steps:</h3>
                <ol>
                  <li>Store these credentials securely in your app's environment variables</li>
                  <li>Use the shared_secret to verify tokens from Gatekeeper</li>
                  <li>Use the api_key for server-to-server API calls</li>
                  <li>Implement the Gatekeeper OAuth flow in your app</li>
                </ol>
              </div>
            </div>

            <div className="modal-footer">
              <button
                className="btn-primary"
                onClick={() => setNewCredentials(null)}
              >
                I've Saved These Credentials
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Register Form */}
      {showRegisterForm ? (
        <div className="card">
          <h2>Register New App</h2>
          <form onSubmit={handleRegister}>
            <div className="form-group">
              <label htmlFor="app_id">App ID *</label>
              <input
                type="text"
                id="app_id"
                name="app_id"
                value={formData.app_id}
                onChange={handleInputChange}
                placeholder="my-awesome-app"
                pattern="^[a-z0-9][a-z0-9-]{2,48}[a-z0-9]$"
                required
              />
              <p className="form-hint">
                Lowercase letters, numbers, and hyphens only. 4-50 characters.
              </p>
            </div>

            <div className="form-group">
              <label htmlFor="app_name">App Name *</label>
              <input
                type="text"
                id="app_name"
                name="app_name"
                value={formData.app_name}
                onChange={handleInputChange}
                placeholder="My Awesome App"
                maxLength={100}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="owner_email">Contact Email *</label>
              <input
                type="email"
                id="owner_email"
                name="owner_email"
                value={formData.owner_email}
                onChange={handleInputChange}
                placeholder="developer@example.com"
                required
              />
              <p className="form-hint">
                Used for important notifications about your app.
              </p>
            </div>

            <div className="form-group">
              <label htmlFor="description">Description</label>
              <textarea
                id="description"
                name="description"
                value={formData.description}
                onChange={handleInputChange}
                placeholder="Brief description of what your app does"
                maxLength={500}
                rows={3}
              />
            </div>

            <div className="form-group">
              <label htmlFor="organization_name">Organization Name</label>
              <input
                type="text"
                id="organization_name"
                name="organization_name"
                value={formData.organization_name}
                onChange={handleInputChange}
                placeholder="Your Company Name"
                maxLength={100}
              />
            </div>

            <div className="form-group">
              <label htmlFor="callback_urls">Callback URLs * (one per line)</label>
              <textarea
                id="callback_urls"
                name="callback_urls"
                value={formData.callback_urls}
                onChange={handleInputChange}
                placeholder="https://myapp.com/auth/callback&#10;http://localhost:3000/auth/callback"
                rows={3}
                required
              />
              <p className="form-hint">
                URLs where users will be redirected after authorization.
              </p>
            </div>

            <div className="form-group">
              <label htmlFor="allowed_origins">Allowed Origins (one per line)</label>
              <textarea
                id="allowed_origins"
                name="allowed_origins"
                value={formData.allowed_origins}
                onChange={handleInputChange}
                placeholder="https://myapp.com&#10;http://localhost:3000"
                rows={3}
              />
              <p className="form-hint">
                Origins allowed to make API requests. Leave empty to use callback URL origins.
              </p>
            </div>

            <div className="form-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowRegisterForm(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={registering}
              >
                {registering ? 'Registering...' : 'Register App'}
              </button>
            </div>
          </form>
        </div>
      ) : (
        <button
          className="btn-primary"
          onClick={() => setShowRegisterForm(true)}
        >
          + Register New App
        </button>
      )}

      {/* Apps List */}
      <div className="section-header" style={{ marginTop: '2rem' }}>
        <h2>Your Registered Apps</h2>
      </div>

      {apps.length === 0 ? (
        <div className="card empty-state">
          <div className="empty-icon">🛠️</div>
          <h3>No Registered Apps</h3>
          <p>Register your first app to start integrating with Gatekeeper.</p>
        </div>
      ) : (
        <div className="apps-list">
          {apps.map((app) => (
            <div key={app.id} className="card app-card">
              <div className="app-header">
                <div className="app-info">
                  <h3>{app.app_name}</h3>
                  <p className="app-id">ID: {app.app_id}</p>
                </div>
                <div className="app-badges">
                  {app.is_verified ? (
                    <span className="badge badge-success">Verified</span>
                  ) : (
                    <span className="badge badge-warning">Unverified</span>
                  )}
                  {app.is_active ? (
                    <span className="badge badge-success">Active</span>
                  ) : (
                    <span className="badge badge-danger">Inactive</span>
                  )}
                </div>
              </div>

              {app.app_description && (
                <p className="app-description">{app.app_description}</p>
              )}

              <div className="app-details">
                <div className="info-row">
                  <span className="label">Created:</span>
                  <span className="value">{formatDate(app.created_at)}</span>
                </div>
                <div className="info-row">
                  <span className="label">Users Connected:</span>
                  <span className="value">{app.total_users_connected}</span>
                </div>
                <div className="info-row">
                  <span className="label">Tokens Issued:</span>
                  <span className="value">{app.total_tokens_issued}</span>
                </div>
                <div className="info-row">
                  <span className="label">Last Token:</span>
                  <span className="value">{formatDate(app.last_token_issued_at)}</span>
                </div>
                {app.organization_name && (
                  <div className="info-row">
                    <span className="label">Organization:</span>
                    <span className="value">{app.organization_name}</span>
                  </div>
                )}
              </div>

              <div className="app-urls">
                <div className="info-row">
                  <span className="label">Callback URLs:</span>
                  <span className="value urls">
                    {app.callback_urls.map((url, i) => (
                      <code key={i}>{url}</code>
                    ))}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
