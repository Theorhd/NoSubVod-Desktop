import React, { useEffect, useState, useCallback } from 'react';
import { ExperienceSettings, ProxyInfo, TrustedDevice, TwitchStatus } from '../../shared/types';
import { TopBar } from './components/TopBar';

const defaultSettings: ExperienceSettings = {
  oneSync: false,
  adblockEnabled: false,
  adblockProxy: '',
  adblockProxyMode: 'auto',
  minVideoQuality: 'none',
  preferredVideoQuality: 'auto',
  launchAtLogin: false,
};

const ServerExperienceSection = ({ settings, loading, setSettings, setSuccess }: any) => (
  <div className="card settings-card">
    <h2>Server Experience</h2>
    <p className="settings-description">Gérez le comportement global de votre serveur NoSubVOD.</p>
    {loading ? (
      <div className="trusted-devices-empty">Loading settings...</div>
    ) : (
      <>
        <div className="toggle-row">
          <span>
            <strong>
              <label htmlFor="oneSyncToggle" className="mb-0">
                OneSync
              </label>
            </strong>
            <small>Synchronise les données entre devices (subs, historique)</small>
          </span>
          <input
            id="oneSyncToggle"
            type="checkbox"
            checked={settings.oneSync}
            onChange={(e) => {
              setSettings((prev: any) => ({ ...prev, oneSync: e.target.checked }));
              setSuccess('');
            }}
          />
        </div>

        <div className="toggle-row mt-2">
          <span>
            <strong>
              <label htmlFor="launchAtLoginToggle" className="mb-0">
                Lancer avec l&apos;OS
              </label>
            </strong>
            <small>Démarre NoSubVOD automatiquement à l&apos;ouverture de session</small>
          </span>
          <input
            id="launchAtLoginToggle"
            type="checkbox"
            checked={settings.launchAtLogin}
            onChange={(e) => {
              setSettings((prev: any) => ({ ...prev, launchAtLogin: e.target.checked }));
              setSuccess('');
            }}
          />
        </div>
      </>
    )}
  </div>
);

const VideoPlayerSection = ({ settings, setSettings, setSuccess }: any) => (
  <div className="card settings-card">
    <h2>Video Player</h2>
    <p className="settings-description">Configure la qualité par défaut du lecteur vidéo.</p>

    <div className="settings-group">
      <label htmlFor="minVideoQuality" className="settings-label">
        Qualité Minimale Autorisée
      </label>
      <select
        id="minVideoQuality"
        className="settings-select"
        value={settings.minVideoQuality || 'none'}
        onChange={(e) => {
          setSettings((prev: any) => ({ ...prev, minVideoQuality: e.target.value }));
          setSuccess('');
        }}
      >
        <option value="none">Aucune (Laisser Twitch choisir)</option>
        <option value="480">480p</option>
        <option value="720">720p</option>
        <option value="1080">1080p</option>
      </select>
      <small className="help-text">
        Les résolutions inférieures seront masquées du lecteur. Si la connexion est mauvaise, cela
        peut causer des coupures.
      </small>
    </div>

    <div className="settings-group mt-2">
      <label htmlFor="preferredVideoQuality" className="settings-label">
        Qualité Préférée au Lancement
      </label>
      <select
        id="preferredVideoQuality"
        className="settings-select"
        value={settings.preferredVideoQuality || 'auto'}
        onChange={(e) => {
          setSettings((prev: any) => ({ ...prev, preferredVideoQuality: e.target.value }));
          setSuccess('');
        }}
      >
        <option value="auto">Automatique</option>
        <option value="480">480p</option>
        <option value="720">720p</option>
        <option value="1080">1080p</option>
      </select>
      <small className="help-text">
        La vidéo tentera de démarrer avec cette résolution si elle est disponible.
      </small>
    </div>
  </div>
);

const AdblockSection = ({ settings, setSettings, setSuccess, proxies, activeProxy }: any) => {
  const getProxyStatusClass = (status?: string) => {
    if (status === 'success') return ' status-success';
    if (status === 'error') return ' status-error';
    return '';
  };

  return (
    <div className="card settings-card">
      <h2>Adblock Proxies</h2>
      <p className="settings-description">
        Utilise un proxy tiers pour contourner les pubs Twitch sur les lives et les VODs. Attention:
        L&apos;utilisation d&apos;un proxy public peut ralentir le flux vidéo ou se bloquer
        temporairement.
      </p>

      <div className="toggle-row">
        <span>
          <strong>
            <label htmlFor="adblockEnabled" className="mb-0">
              Activer le Proxy Adblock
            </label>
          </strong>
          <small>Désactivé par défaut. Activez-le si vous avez trop de pubs.</small>
        </span>
        <input
          id="adblockEnabled"
          type="checkbox"
          checked={settings.adblockEnabled}
          onChange={(e) => {
            setSettings((prev: any) => ({ ...prev, adblockEnabled: e.target.checked }));
            setSuccess('');
          }}
        />
      </div>

      {settings.adblockEnabled && (
        <>
          <div className="settings-group mt-2">
            <label htmlFor="adblockProxyMode" className="settings-label">
              Mode de Sélection du Proxy
            </label>
            <select
              id="adblockProxyMode"
              className="settings-select"
              value={settings.adblockProxyMode || 'auto'}
              onChange={(e) => {
                setSettings((prev: any) => ({ ...prev, adblockProxyMode: e.target.value }));
                setSuccess('');
              }}
            >
              <option value="auto">Automatique (recommandé - sélectionne le plus rapide)</option>
              <option value="manual">Manuel (choisir un proxy spécifique)</option>
            </select>
          </div>

          {settings.adblockProxyMode === 'manual' && (
            <div className="settings-group mt-2">
              <label htmlFor="adblockProxy" className="settings-label">
                Proxy Manuel
              </label>
              <select
                id="adblockProxy"
                className="settings-select"
                value={settings.adblockProxy || ''}
                onChange={(e) => {
                  setSettings((prev: any) => ({ ...prev, adblockProxy: e.target.value }));
                  setSuccess('');
                }}
              >
                <option value="" disabled>
                  Sélectionnez un proxy
                </option>
                {proxies.map((p: any) => (
                  <option key={p.url} value={p.url}>
                    {p.name} - {p.url}
                  </option>
                ))}
              </select>
            </div>
          )}

          {activeProxy && (
            <div className="settings-active-proxy">
              <strong className="settings-active-proxy-title">Proxy Actif Actuellement :</strong>
              <div className="settings-active-proxy-row">
                <span
                  className={`settings-active-proxy-dot${getProxyStatusClass(activeProxy.status)}`}
                />
                <span className="settings-active-proxy-name">{activeProxy.name}</span>
              </div>
              <div className="settings-active-proxy-meta">URL: {activeProxy.url}</div>
              {activeProxy.ping !== undefined && activeProxy.status === 'success' && (
                <div className="settings-active-proxy-meta">Ping: {activeProxy.ping}ms</div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

const DownloadsSection = ({ settings, setSettings, setSuccess, selectFolder }: any) => (
  <div className="card settings-card">
    <h2>Downloads (Server Backend)</h2>
    <p className="settings-description">
      Configure l&apos;emplacement où le serveur de fond NoSubVOD stockera les VODs téléchargées.
    </p>

    <div className="settings-group">
      <label htmlFor="downloadLocalPath" className="settings-label">
        Chemin Local (Server-Side)
      </label>
      <div className="field-row">
        <input
          id="downloadLocalPath"
          type="text"
          value={settings.downloadLocalPath || ''}
          placeholder="ex: C:\Downloads\NoSubVOD"
          onChange={(e) => {
            setSettings((prev: any) => ({ ...prev, downloadLocalPath: e.target.value }));
            setSuccess('');
          }}
          className="settings-select field-grow"
        />
        <button
          type="button"
          onClick={() => selectFolder('downloadLocalPath')}
          className="action-btn"
        >
          Parcourir
        </button>
      </div>
      <small className="help-text">
        Chemin absolu sur la machine hébergeant le serveur NoSubVOD. (Windows/Linux/Mac)
      </small>
    </div>

    <div className="settings-group mt-2">
      <label htmlFor="downloadNetworkSharedPath" className="settings-label">
        Chemin Réseau (SMB/NFS) (Optionnel)
      </label>
      <div className="field-row">
        <input
          id="downloadNetworkSharedPath"
          type="text"
          value={settings.downloadNetworkSharedPath || ''}
          placeholder="ex: \\NAS\Downloads\NoSubVOD"
          onChange={(e) => {
            setSettings((prev: any) => ({ ...prev, downloadNetworkSharedPath: e.target.value }));
            setSuccess('');
          }}
          className="settings-select field-grow"
        />
        <button
          type="button"
          onClick={() => selectFolder('downloadNetworkSharedPath')}
          className="action-btn"
        >
          Parcourir
        </button>
      </div>
      <small className="help-text">
        Chemin d&apos;accès réseau si vous enregistrez sur un NAS. Utilisé en priorité si spécifié.
      </small>
    </div>
  </div>
);

const TwitchClientWarning = ({ twitchStatus }: { twitchStatus: TwitchStatus | null }) => {
  if (!twitchStatus || twitchStatus.clientConfigured) return null;

  return (
    <div className="twitch-warning">
      Configuration Twitch incomplète. Configure ton application sur <strong>dev.twitch.tv</strong>{' '}
      et renseigne <code>TWITCH_CLIENT_ID</code> et <code>TWITCH_CLIENT_SECRET</code> dans{' '}
      <code>src-tauri/.env</code>.
    </div>
  );
};

const TwitchAccountSection = ({
  twitchStatus,
  twitchPolling,
  twitchImporting,
  linkTwitch,
  unlinkTwitch,
  importFollows,
  setImportFollowsSetting,
}: any) => (
  <div className="card settings-card">
    <h2>Compte Twitch</h2>
    <p className="settings-description">
      Lie ton compte Twitch pour envoyer des messages dans les lives et importer tes chaînes suivies
      dans tes Subs NoSubVOD.
    </p>

    <TwitchClientWarning twitchStatus={twitchStatus} />

    {twitchStatus?.linked ? (
      <div>
        <div className="twitch-user-row">
          {twitchStatus.userAvatar && (
            <img src={twitchStatus.userAvatar} alt="Avatar" className="twitch-avatar" />
          )}
          <div>
            <div className="twitch-display-name">
              {twitchStatus.userDisplayName || twitchStatus.userLogin}
            </div>
            {twitchStatus.userLogin && (
              <div className="twitch-login">@{twitchStatus.userLogin}</div>
            )}
          </div>
          <button
            onClick={unlinkTwitch}
            className="action-btn secondary-btn soft-outline-btn ml-auto"
          >
            Déconnecter
          </button>
        </div>

        <div className="settings-subsection">
          <div className="toggle-row mb-2">
            <span>
              <strong>
                <label htmlFor="importFollowsToggle" className="mb-0">
                  Importer les chaînes suivies
                </label>
              </strong>
              <small>Ajoute auto. tes follows Twitch dans tes Subs NoSubVOD</small>
            </span>
            <input
              id="importFollowsToggle"
              type="checkbox"
              checked={twitchStatus.importFollows ?? false}
              onChange={(e) => setImportFollowsSetting(e.target.checked)}
            />
          </div>
          <button
            onClick={importFollows}
            disabled={twitchImporting}
            className="action-btn secondary-btn soft-outline-btn"
          >
            {twitchImporting ? 'Importation...' : 'Importer maintenant'}
          </button>
        </div>
      </div>
    ) : (
      <button
        onClick={linkTwitch}
        disabled={twitchPolling || (twitchStatus !== null && !twitchStatus.clientConfigured)}
        className="action-btn twitch-connect-btn"
      >
        {twitchPolling ? 'En attente de connexion...' : 'Lier mon compte Twitch'}
      </button>
    )}
  </div>
);

const TrustedDevicesSection = ({
  devices,
  pendingDeviceId,
  onToggleTrusted,
}: {
  devices: TrustedDevice[];
  pendingDeviceId: string | null;
  onToggleTrusted: (deviceId: string, trusted: boolean) => Promise<void>;
}) => {
  const formatSeen = (value: number) => {
    if (!value) return 'N/A';
    return new Date(value).toLocaleString();
  };

  return (
    <div className="card settings-card">
      <h2>Trusted Devices</h2>
      <p className="settings-description">
        Les appareils listés ici ont déjà accédé à l&apos;app. Active &quot;Trusted&quot; pour
        autoriser l&apos;accès sans <code>?t=...</code>.
      </p>

      {devices.length === 0 ? (
        <div className="trusted-devices-empty">Aucun appareil détecté pour le moment.</div>
      ) : (
        <div className="trusted-devices-list">
          {devices.map((device) => (
            <div key={device.deviceId} className="trusted-device-item">
              <div className="trusted-device-header">
                <div className="trusted-device-id">{device.deviceId}</div>
                <label className="trusted-device-toggle">
                  <span className="trusted-device-toggle-label">Trusted</span>
                  <input
                    type="checkbox"
                    checked={device.trusted}
                    disabled={pendingDeviceId === device.deviceId}
                    onChange={(e) => onToggleTrusted(device.deviceId, e.target.checked)}
                  />
                </label>
              </div>
              <div className="trusted-device-meta">
                Dernier accès: {formatSeen(device.lastSeenAt)}
              </div>
              <div className="trusted-device-meta">
                Première visite: {formatSeen(device.firstSeenAt)}
              </div>
              {device.lastIp && <div className="trusted-device-meta">IP: {device.lastIp}</div>}
              {device.userAgent && (
                <div className="trusted-device-meta ua">UA: {device.userAgent}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default function Settings() {
  const [settings, setSettings] = useState<ExperienceSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [proxies, setProxies] = useState<ProxyInfo[]>([]);
  const [activeProxy, setActiveProxy] = useState<ProxyInfo | null>(null);
  const [twitchStatus, setTwitchStatus] = useState<TwitchStatus | null>(null);
  const [twitchPolling, setTwitchPolling] = useState(false);
  const [twitchImporting, setTwitchImporting] = useState(false);
  const [trustedDevices, setTrustedDevices] = useState<TrustedDevice[]>([]);
  const [trustedDevicePendingId, setTrustedDevicePendingId] = useState<string | null>(null);

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

  const fetchTwitchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/twitch/status');
      if (res.ok) setTwitchStatus(await res.json());
    } catch (e) {
      console.error('Failed to fetch twitch status', e);
    }
  }, []);

  const fetchTrustedDevices = useCallback(async () => {
    try {
      const res = await fetch('/api/trusted-devices');
      if (!res.ok) return;
      const data = (await res.json()) as TrustedDevice[];
      setTrustedDevices(data);
    } catch (e) {
      console.error('Failed to fetch trusted devices', e);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
    fetchTwitchStatus();
    fetchTrustedDevices();
    const interval = setInterval(() => {
      fetchAdblockStatus();
      fetchProxies();
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchSettings, fetchAdblockStatus, fetchProxies, fetchTwitchStatus, fetchTrustedDevices]);

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
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const selectFolder = async (field: 'downloadLocalPath' | 'downloadNetworkSharedPath') => {
    try {
      const res = await fetch('/api/system/dialog/folder');
      if (!res.ok) return;
      const { path } = await res.json();
      if (path) setSettings((prev) => ({ ...prev, [field]: path }));
    } catch (e) {
      console.error('Failed to open dialog', e);
    }
  };

  const linkTwitch = async () => {
    try {
      const res = await fetch('/api/auth/twitch/start');
      if (!res.ok) return;
      const { authUrl } = await res.json();
      window.open(authUrl, '_blank', 'noopener,noreferrer');
      setTwitchPolling(true);
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        const r = await fetch('/api/auth/twitch/status');
        if (!r.ok) {
          if (attempts >= 60) {
            clearInterval(poll);
            setTwitchPolling(false);
          }
          return;
        }
        const data = await r.json();
        setTwitchStatus(data);
        if (data.linked || attempts >= 60) {
          clearInterval(poll);
          setTwitchPolling(false);
        }
      }, 2000);
    } catch (e) {
      console.error('Failed to start Twitch auth', e);
    }
  };

  const unlinkTwitch = async () => {
    try {
      await fetch('/api/auth/twitch', { method: 'DELETE' });
      await fetchTwitchStatus();
    } catch (e) {
      console.error('Failed to unlink Twitch', e);
    }
  };

  const importFollows = async () => {
    setTwitchImporting(true);
    try {
      await fetch('/api/auth/twitch/import-follows', { method: 'POST' });
    } catch (e) {
      console.error('Failed to import follows', e);
    } finally {
      setTwitchImporting(false);
    }
  };

  const setImportFollowsSetting = async (value: boolean) => {
    try {
      await fetch('/api/auth/twitch/import-follows-setting', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: value }),
      });
      await fetchTwitchStatus();
    } catch (e) {
      console.error('Failed to update import follows setting', e);
    }
  };

  const toggleTrustedDevice = async (deviceId: string, trusted: boolean) => {
    setTrustedDevicePendingId(deviceId);
    try {
      const res = await fetch(`/api/trusted-devices/${encodeURIComponent(deviceId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trusted }),
      });
      if (!res.ok) throw new Error('Failed to update trusted device');
      await fetchTrustedDevices();
      setSuccess('Trusted devices mis à jour.');
    } catch (e: any) {
      setError(e?.message || 'Failed to update trusted device');
    } finally {
      setTrustedDevicePendingId(null);
    }
  };

  return (
    <>
      <TopBar mode="back" title="Settings" />

      <div className="container container-settings">
        <ServerExperienceSection
          settings={settings}
          loading={loading}
          setSettings={setSettings}
          setSuccess={setSuccess}
        />

        <VideoPlayerSection settings={settings} setSettings={setSettings} setSuccess={setSuccess} />

        <AdblockSection
          settings={settings}
          setSettings={setSettings}
          setSuccess={setSuccess}
          proxies={proxies}
          activeProxy={activeProxy}
        />

        <DownloadsSection
          settings={settings}
          setSettings={setSettings}
          setSuccess={setSuccess}
          selectFolder={selectFolder}
        />

        <TwitchAccountSection
          twitchStatus={twitchStatus}
          twitchPolling={twitchPolling}
          twitchImporting={twitchImporting}
          linkTwitch={linkTwitch}
          unlinkTwitch={unlinkTwitch}
          importFollows={importFollows}
          setImportFollowsSetting={setImportFollowsSetting}
        />

        <TrustedDevicesSection
          devices={trustedDevices}
          pendingDeviceId={trustedDevicePendingId}
          onToggleTrusted={toggleTrustedDevice}
        />

        <div className="card settings-card settings-footer-card">
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
