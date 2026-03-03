import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExperienceSettings, ProxyInfo } from '../../shared/types';

const defaultSettings: ExperienceSettings = {
  oneSync: false,
  adblockEnabled: false,
  adblockProxy: '',
  adblockProxyMode: 'auto',
  minVideoQuality: 'none',
  preferredVideoQuality: 'auto',
};

export default function Settings() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<ExperienceSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [proxies, setProxies] = useState<ProxyInfo[]>([]);
  const [activeProxy, setActiveProxy] = useState<ProxyInfo | null>(null);

  const fetchAdblockStatus = useCallback(async () => {
    try {
      const resp = await fetch('/api/adblock/status');
      if (resp.ok) {
        const data = await resp.json();
        setActiveProxy(data);
      }
    } catch (e) {
      console.error('Failed to fetch adblock status:', e);
    }
  }, []);

  const fetchProxies = useCallback(async () => {
    try {
      const resp = await fetch('/api/adblock/proxies');
      if (resp.ok) {
        const data = await resp.json();
        setProxies(data);
      }
    } catch (e) {
      console.error('Failed to fetch proxies:', e);
    }
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      const resp = await fetch('/api/settings');
      if (!resp.ok) throw new Error('Failed to load settings');
      const data = await resp.json();
      setSettings({
        ...defaultSettings,
        ...data,
      });
      fetchAdblockStatus();
      fetchProxies();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [fetchAdblockStatus, fetchProxies]);

  useEffect(() => {
    fetchSettings();
    const interval = setInterval(() => {
      fetchAdblockStatus();
      fetchProxies();
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchSettings, fetchAdblockStatus, fetchProxies]);

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
      setSettings({
        ...defaultSettings,
        ...data,
      });
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
                  <label htmlFor="oneSyncToggle" style={{ marginBottom: 0 }}>
                    OneSync
                  </label>
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
        </div>

        <div className="card settings-card">
          <h2 style={{ marginTop: 0 }}>Video Player</h2>
          <p className="settings-description">Configure la qualité par défaut du lecteur vidéo.</p>
          {!loading && (
            <>
              <div style={{ marginBottom: '16px' }}>
                <label
                  htmlFor="preferredVideoQuality"
                  style={{ display: 'block', marginBottom: '8px' }}
                >
                  Preferred Video Quality
                </label>
                <select
                  id="preferredVideoQuality"
                  value={settings.preferredVideoQuality || 'auto'}
                  onChange={(e) =>
                    setSettings((prev) => ({ ...prev, preferredVideoQuality: e.target.value }))
                  }
                  style={{
                    width: '100%',
                    padding: '8px',
                    borderRadius: '4px',
                    background: 'var(--bg-elevated)',
                    color: 'var(--text)',
                    border: '1px solid var(--surface-soft)',
                  }}
                >
                  <option value="auto">Auto</option>
                  <option value="1080">1080p</option>
                  <option value="720">720p</option>
                  <option value="480">480p</option>
                  <option value="360">360p</option>
                  <option value="160">160p</option>
                </select>
                <small style={{ display: 'block', marginTop: '4px', color: 'var(--text-muted)' }}>
                  La qualité que nous voulons quand il y a aucun problème de connexion.
                </small>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label htmlFor="minVideoQuality" style={{ display: 'block', marginBottom: '8px' }}>
                  Minimal Video Quality
                </label>
                <select
                  id="minVideoQuality"
                  value={settings.minVideoQuality || 'none'}
                  onChange={(e) =>
                    setSettings((prev) => ({ ...prev, minVideoQuality: e.target.value }))
                  }
                  style={{
                    width: '100%',
                    padding: '8px',
                    borderRadius: '4px',
                    background: 'var(--bg-elevated)',
                    color: 'var(--text)',
                    border: '1px solid var(--surface-soft)',
                  }}
                >
                  <option value="none">None</option>
                  <option value="1080">1080p</option>
                  <option value="720">720p</option>
                  <option value="480">480p</option>
                  <option value="360">360p</option>
                  <option value="160">160p</option>
                </select>
                <small style={{ display: 'block', marginTop: '4px', color: 'var(--text-muted)' }}>
                  Le programme n&apos;affichera jamais une qualité inférieure à celle-ci.
                </small>
              </div>
            </>
          )}
        </div>

        <div className="card settings-card">
          <h2 style={{ marginTop: 0 }}>Adblock (Experimental)</h2>
          <p className="settings-description">
            Contourne les publicités Twitch en utilisant un proxy et le filtrage des segments. Le
            mode Auto sélectionne automatiquement le proxy le plus rapide parmi les pays sans pub.
          </p>

          {!loading && (
            <>
              <div className="toggle-row">
                <span>
                  <strong>
                    <label htmlFor="adblockToggle" style={{ marginBottom: 0 }}>
                      Enable Adblock
                    </label>
                  </strong>
                  <small>Bypass les pubs Twitch sur les lives</small>
                </span>
                <input
                  id="adblockToggle"
                  type="checkbox"
                  checked={settings.adblockEnabled}
                  onChange={(e) => {
                    setSettings((prev) => ({ ...prev, adblockEnabled: e.target.checked }));
                    setSuccess('');
                  }}
                />
              </div>

              {settings.adblockEnabled && (
                <div
                  style={{
                    marginTop: '20px',
                    borderTop: '1px solid var(--surface-soft)',
                    paddingTop: '20px',
                  }}
                >
                  <div style={{ marginBottom: '16px' }}>
                    <span
                      style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)' }}
                    >
                      Proxy Selection Mode
                    </span>
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <button
                        className={`action-btn ${settings.adblockProxyMode === 'auto' ? '' : 'secondary-btn'}`}
                        style={{
                          flex: 1,
                          border:
                            settings.adblockProxyMode === 'auto'
                              ? 'none'
                              : '1px solid var(--surface-hover)',
                        }}
                        onClick={() => setSettings({ ...settings, adblockProxyMode: 'auto' })}
                      >
                        Auto (Recommended)
                      </button>
                      <button
                        className={`action-btn ${settings.adblockProxyMode === 'manual' ? '' : 'secondary-btn'}`}
                        style={{
                          flex: 1,
                          border:
                            settings.adblockProxyMode === 'manual'
                              ? 'none'
                              : '1px solid var(--surface-hover)',
                        }}
                        onClick={() => setSettings({ ...settings, adblockProxyMode: 'manual' })}
                      >
                        Manual
                      </button>
                    </div>
                  </div>

                  {settings.adblockProxyMode === 'auto' && (
                    <div
                      style={{
                        background: 'var(--bg-elevated)',
                        padding: '15px',
                        borderRadius: '8px',
                        marginBottom: '16px',
                      }}
                    >
                      <div
                        style={{
                          fontSize: '0.9rem',
                          color: 'var(--text-muted)',
                          marginBottom: '4px',
                        }}
                      >
                        Active Proxy
                      </div>
                      {activeProxy ? (
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <div style={{ fontWeight: 'bold' }}>
                            {activeProxy.url} ({activeProxy.country})
                          </div>
                          <div
                            style={{
                              color: activeProxy.ping < 300 ? '#4ade80' : '#fbbf24',
                              fontSize: '0.85rem',
                            }}
                          >
                            Ping: {activeProxy.ping}ms
                          </div>
                        </div>
                      ) : (
                        <div style={{ fontSize: '0.85rem' }}>Searching for best proxy...</div>
                      )}
                    </div>
                  )}

                  {settings.adblockProxyMode === 'manual' && (
                    <div style={{ marginBottom: '16px' }}>
                      <label htmlFor="adblockProxy">Custom Proxy URL (HTTP)</label>
                      <input
                        id="adblockProxy"
                        type="text"
                        value={settings.adblockProxy || ''}
                        onChange={(e) =>
                          setSettings((prev) => ({ ...prev, adblockProxy: e.target.value }))
                        }
                        placeholder="ex: http://user:pass@host:port"
                      />
                    </div>
                  )}

                  <div style={{ marginTop: '16px' }}>
                    <span
                      style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)' }}
                    >
                      Available Proxies
                    </span>
                    <div
                      style={{
                        maxHeight: '200px',
                        overflowY: 'auto',
                        background: 'var(--bg)',
                        borderRadius: '8px',
                        border: '1px solid var(--surface-soft)',
                      }}
                    >
                      {proxies.length === 0 ? (
                        <div
                          style={{
                            padding: '15px',
                            textAlign: 'center',
                            color: 'var(--text-muted)',
                            fontSize: '0.9rem',
                          }}
                        >
                          No proxies found yet. Scraping in progress...
                        </div>
                      ) : (
                        [...proxies]
                          .sort((a: ProxyInfo, b: ProxyInfo) => a.ping - b.ping)
                          .map((p) => (
                            <div
                              key={p.url}
                              style={{
                                padding: '10px 15px',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                borderBottom: '1px solid var(--surface-soft)',
                              }}
                            >
                              <div style={{ fontSize: '0.9rem' }}>
                                <span style={{ fontWeight: 'bold' }}>{p.url}</span>
                                <span
                                  style={{
                                    marginLeft: '8px',
                                    color: 'var(--text-muted)',
                                    fontSize: '0.8rem',
                                  }}
                                >
                                  [{p.country}]
                                </span>
                              </div>
                              <div
                                style={{
                                  color: p.ping < 300 ? '#4ade80' : '#fbbf24',
                                  fontSize: '0.8rem',
                                }}
                              >
                                {p.ping}ms
                              </div>
                            </div>
                          ))
                      )}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div
          className="card settings-card"
          style={{ border: 'none', background: 'transparent', boxShadow: 'none' }}
        >
          {error && <div className="error-text">{error}</div>}
          {success && <div className="success-text">{success}</div>}

          <div className="btn-row">
            <button className="action-btn" onClick={saveSettings} disabled={loading || saving}>
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
