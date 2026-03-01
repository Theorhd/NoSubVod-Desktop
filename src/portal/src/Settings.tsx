import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExperienceSettings } from '../../shared/types';

const defaultSettings: ExperienceSettings = {
  oneSync: false,
};

export default function Settings() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<ExperienceSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    fetch('/api/settings')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load settings');
        return res.json();
      })
      .then((data: ExperienceSettings) => {
        setSettings({ oneSync: Boolean(data.oneSync) });
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  const saveSettings = async () => {
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });

      if (!res.ok) throw new Error('Failed to save settings');

      const data = (await res.json()) as ExperienceSettings;
      setSettings({ oneSync: Boolean(data.oneSync) });
      setSuccess('Settings saved.');
    } catch (err: any) {
      setError(err.message || 'Unable to save settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="top-bar">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <button
            onClick={() => navigate('/')}
            className="back-btn"
            aria-label="Retour à l'accueil"
          >
            &larr;
          </button>
          <h1 style={{ margin: 0 }}>Settings</h1>
        </div>
      </div>

      <div className="container" style={{ maxWidth: '760px' }}>
        <div className="card settings-card">
          <h2 style={{ marginTop: 0 }}>Server Experience</h2>
          <p className="settings-description">
            Active OneSync pour partager les abonnements, l&apos;historique et les éléments
            synchronisés entre tous les appareils connectés à ton serveur NoSubVOD.
          </p>

          {loading ? (
            <div style={{ color: 'var(--text-muted)' }}>Loading settings...</div>
          ) : (
            <div className="toggle-row">
              <span>
                <strong>
                  <label htmlFor="oneSyncToggle">OneSync</label>
                </strong>
                <small>Synchronise les données entre devices</small>
              </span>
              <input
                id="oneSyncToggle"
                type="checkbox"
                checked={settings.oneSync}
                onChange={(e) => {
                  setSettings((prev) => ({ ...prev, oneSync: e.target.checked }));
                  setSuccess('');
                }}
              />
            </div>
          )}

          {error && <div className="error-text">{error}</div>}
          {success && <div className="success-text">{success}</div>}

          <div className="btn-row" style={{ marginTop: '20px' }}>
            <button className="action-btn" onClick={saveSettings} disabled={loading || saving}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
