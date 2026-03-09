import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExperienceSettings, ProxyInfo, TwitchStatus } from '../../shared/types';

const defaultSettings: ExperienceSettings = {
  oneSync: false,
  adblockEnabled: false,
  adblockProxy: '',
  adblockProxyMode: 'auto',
  minVideoQuality: 'none',
  preferredVideoQuality: 'auto',
};

const ServerExperienceSection = ({ settings, loading, setSettings, setSuccess }: any) => (
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
            setSettings((prev: any) => ({ ...prev, oneSync: e.target.checked }));
            setSuccess('');
          }}
        />
      </div>
    )}
  </div>
);

const VideoPlayerSection = ({ settings, setSettings, setSuccess }: any) => (
  <div className="card settings-card">
    <h2 style={{ marginTop: 0 }}>Video Player</h2>
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
      <small style={{ color: 'var(--text-muted)', display: 'block', marginTop: '6px' }}>
        Les résolutions inférieures seront masquées du lecteur. Si la connexion est mauvaise, cela peut causer des coupures.
      </small>
    </div>

    <div className="settings-group" style={{ marginTop: '16px' }}>
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
      <small style={{ color: 'var(--text-muted)', display: 'block', marginTop: '6px' }}>
        La vidéo tentera de démarrer avec cette résolution si elle est disponible.
      </small>
    </div>
  </div>
);

const AdblockSection = ({ settings, setSettings, setSuccess, proxies, activeProxy }: any) => (
  <div className="card settings-card">
    <h2 style={{ marginTop: 0 }}>Adblock Proxies</h2>
    <p className="settings-description">
      Utilise un proxy tiers pour contourner les pubs Twitch sur les lives et les VODs.
      Attention: L&apos;utilisation d&apos;un proxy public peut ralentir le flux vidéo ou se bloquer temporairement.
    </p>

    <div className="toggle-row">
      <span>
        <strong>
          <label htmlFor="adblockEnabled" style={{ marginBottom: 0 }}>
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
        <div className="settings-group" style={{ marginTop: '16px' }}>
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
          <div className="settings-group" style={{ marginTop: '16px' }}>
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
              <option value="" disabled>Sélectionnez un proxy</option>
              {proxies.map((p: any) => (
                <option key={p.url} value={p.url}>{p.name} - {p.url}</option>
              ))}
            </select>
          </div>
        )}

        {activeProxy && (
          <div style={{ marginTop: '16px', padding: '12px', backgroundColor: 'var(--bg)', borderRadius: '8px', border: '1px solid var(--border)' }}>
            <strong style={{ display: 'block', marginBottom: '8px', color: 'var(--text)' }}>Proxy Actif Actuellement :</strong>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              {(() => {
                let dotColor = '#facc15';
                if (activeProxy.status === 'success') dotColor = '#4ade80';
                else if (activeProxy.status === 'error') dotColor = '#f87171';
                return (
                  <span style={{
                    width: '10px', height: '10px', borderRadius: '50%',
                    backgroundColor: dotColor,
                  }} />
                );
              })()}
              <span style={{ fontWeight: 600, color: 'var(--text)' }}>{activeProxy.name}</span>
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginLeft: '18px' }}>
              URL: {activeProxy.url}
            </div>
            {activeProxy.ping !== undefined && activeProxy.status === 'success' && (
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginLeft: '18px' }}>
                Ping: {activeProxy.ping}ms
              </div>
            )}
          </div>
        )}
      </>
    )}
  </div>
);

const DownloadsSection = ({ settings, setSettings, setSuccess, selectFolder }: any) => (
  <div className="card settings-card">
    <h2 style={{ marginTop: 0 }}>Downloads (Server Backend)</h2>
    <p className="settings-description">Configure l&apos;emplacement où le serveur de fond NoSubVOD stockera les VODs téléchargées.</p>

    <div className="settings-group">
      <label htmlFor="downloadLocalPath" className="settings-label">
        Chemin Local (Server-Side)
      </label>
      <div style={{ display: 'flex', gap: '10px' }}>
        <input
          id="downloadLocalPath"
          type="text"
          className="settings-select"
          value={settings.downloadLocalPath || ''}
          placeholder="ex: C:\Downloads\NoSubVOD"
          onChange={(e) => {
            setSettings((prev: any) => ({ ...prev, downloadLocalPath: e.target.value }));
            setSuccess('');
          }}
          style={{ flex: 1 }}
        />
        <button type="button" onClick={() => selectFolder('downloadLocalPath')} className="action-btn">
          Parcourir
        </button>
      </div>
      <small style={{ color: 'var(--text-muted)', display: 'block', marginTop: '6px' }}>
        Chemin absolu sur la machine hébergeant le serveur NoSubVOD. (Windows/Linux/Mac)
      </small>
    </div>

    <div className="settings-group" style={{ marginTop: '16px' }}>
      <label htmlFor="downloadNetworkSharedPath" className="settings-label">
        Chemin Réseau (SMB/NFS) (Optionnel)
      </label>
      <div style={{ display: 'flex', gap: '10px' }}>
        <input
          id="downloadNetworkSharedPath"
          type="text"
          className="settings-select"
          value={settings.downloadNetworkSharedPath || ''}
          placeholder="ex: \\NAS\Downloads\NoSubVOD"
          onChange={(e) => {
            setSettings((prev: any) => ({ ...prev, downloadNetworkSharedPath: e.target.value }));
            setSuccess('');
          }}
          style={{ flex: 1 }}
        />
         <button type="button" onClick={() => selectFolder('downloadNetworkSharedPath')} className="action-btn">
          Parcourir
        </button>
      </div>
      <small style={{ color: 'var(--text-muted)', display: 'block', marginTop: '6px' }}>
        Chemin d&apos;accès réseau si vous enregistrez sur un NAS. Utilisé en priorité si spécifié.
      </small>
    </div>
  </div>
);

const TwitchIntegrationSection = ({
  twitchStatus,
  twitchPolling,
  twitchImporting,
  linkTwitch,
  unlinkTwitch,
  importFollows,
  setImportFollowsSetting
}: any) => (
  <div className="card settings-card">
    <h2 style={{ marginTop: 0 }}>Twitch Integration</h2>
    <p className="settings-description">
      Associe ton compte Twitch pour pouvoir écrire dans le chat, suivre l&apos;état de tes streamers favoris
      et importer automatiquement tes abonnements.
    </p>

    <div style={{ marginTop: '20px', padding: '15px', backgroundColor: 'var(--bg)', borderRadius: '8px', border: '1px solid var(--border)' }}>
      {twitchStatus === null && (
        <div style={{ color: 'var(--text-muted)' }}>Vérification de l&apos;état...</div>
      )}
      {twitchStatus !== null && twitchStatus.linked && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px', marginBottom: '15px' }}>
            {twitchStatus.userProfileImage && (
              <img src={twitchStatus.userProfileImage} alt="Profile" style={{ width: '50px', height: '50px', borderRadius: '50%' }} />
            )}
            <div>
              <strong style={{ fontSize: '1.1rem', color: '#9146ff' }}>{twitchStatus.userDisplayName || twitchStatus.userLogin}</strong>
              <div style={{ fontSize: '0.9rem', color: '#4ade80' }}>✓ Compte connecté</div>
            </div>
            <button
              onClick={unlinkTwitch}
              className="action-btn secondary-btn"
              style={{ marginLeft: 'auto' }}
            >
              Déconnecter
            </button>
          </div>

          <div className="toggle-row" style={{ marginTop: '15px', paddingTop: '15px', borderTop: '1px solid var(--border)' }}>
            <span>
              <strong>
                <label htmlFor="importFollowsToggle" style={{ marginBottom: 0 }}>
                  Synchroniser mes follows
                </label>
              </strong>
              <small>Ajouter automatiquement à NoSubVOD les chaînes que je suis sur Twitch</small>
            </span>
            <input
              id="importFollowsToggle"
              type="checkbox"
              checked={twitchStatus.importFollows || false}
              onChange={(e) => setImportFollowsSetting(e.target.checked)}
            />
          </div>

          <div style={{ marginTop: '15px' }}>
             <button
                onClick={importFollows}
                disabled={twitchImporting}
                className="action-btn"
                style={{ width: '100%', justifyContent: 'center' }}
              >
                {twitchImporting ? 'Importation en cours...' : 'Forcer l\'importation des follows maintenant'}
              </button>
          </div>
        </div>
      )}
      {twitchStatus !== null && !twitchStatus.linked && (
        <div style={{ textAlign: 'center', padding: '10px 0' }}>
          <div style={{ marginBottom: '15px', color: 'var(--text-muted)' }}>
            Aucun compte Twitch connecté.
          </div>
          <button
            onClick={linkTwitch}
            disabled={twitchPolling}
            className="action-btn"
            style={{ backgroundColor: '#9146ff', color: 'white', padding: '10px 24px', fontSize: '1rem' }}
          >
            {twitchPolling ? 'En attente de connexion...' : 'Se connecter avec Twitch'}
          </button>
          {twitchPolling && (
            <div style={{ marginTop: '10px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Une fenêtre s&apos;est ouverte. Veuillez autoriser NoSubVOD sur Twitch.
            </div>
          )}
        </div>
      )}
    </div>
  </div>
);

const TwitchClientWarning = ({ twitchStatus }: { twitchStatus: TwitchStatus | null }) => {
  if (!twitchStatus || twitchStatus.clientConfigured) return null;

  return (
    <div
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid #fbbf24',
        borderRadius: '6px',
        padding: '10px 14px',
        marginBottom: '16px',
        fontSize: '0.85rem',
        color: '#fbbf24',
      }}
    >
      Configuration Twitch incomplète. Configure ton application sur{' '}
      <strong>dev.twitch.tv</strong> et renseigne <code>TWITCH_CLIENT_ID</code> et{' '}
      <code>TWITCH_CLIENT_SECRET</code> dans <code>src-tauri/.env</code>.
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
    <h2 style={{ marginTop: 0 }}>Compte Twitch</h2>
    <p className="settings-description">
      Lie ton compte Twitch pour envoyer des messages dans les lives et importer tes
      chaînes suivies dans tes Subs NoSubVOD.
    </p>

    <TwitchClientWarning twitchStatus={twitchStatus} />

    {twitchStatus?.linked ? (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
          {twitchStatus.userAvatar && (
            <img
              src={twitchStatus.userAvatar}
              alt="Avatar"
              style={{ width: '48px', height: '48px', borderRadius: '50%', objectFit: 'cover' }}
            />
          )}
          <div>
            <div style={{ fontWeight: 'bold', fontSize: '1rem' }}>
              {twitchStatus.userDisplayName || twitchStatus.userLogin}
            </div>
            {twitchStatus.userLogin && (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                @{twitchStatus.userLogin}
              </div>
            )}
          </div>
          <button
            onClick={unlinkTwitch}
            className="action-btn secondary-btn"
            style={{ marginLeft: 'auto', border: '1px solid var(--surface-hover)' }}
          >
            Déconnecter
          </button>
        </div>

        <div
          style={{
            borderTop: '1px solid var(--surface-soft)',
            paddingTop: '16px',
          }}
        >
          <div className="toggle-row" style={{ marginBottom: '12px' }}>
            <span>
              <strong>
                <label htmlFor="importFollowsToggle" style={{ marginBottom: 0 }}>
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
            className="action-btn secondary-btn"
            style={{ border: '1px solid var(--surface-hover)' }}
          >
            {twitchImporting ? 'Importation...' : 'Importer maintenant'}
          </button>
        </div>
      </div>
    ) : (
      <button
        onClick={linkTwitch}
        disabled={twitchPolling || (twitchStatus !== null && !twitchStatus.clientConfigured)}
        className="action-btn"
        style={{ background: '#9146ff' }}
      >
        {twitchPolling ? 'En attente de connexion...' : 'Lier mon compte Twitch'}
      </button>
    )}
  </div>
);

export default function Settings() {
  const navigate = useNavigate();
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

  useEffect(() => {
    fetchSettings();
    fetchTwitchStatus();
    const interval = setInterval(() => {
      fetchAdblockStatus();
      fetchProxies();
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchSettings, fetchAdblockStatus, fetchProxies, fetchTwitchStatus]);

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
          if (attempts >= 60) { clearInterval(poll); setTwitchPolling(false); }
          return;
        }
        const data = await r.json();
        setTwitchStatus(data);
        if (data.linked || attempts >= 60) { clearInterval(poll); setTwitchPolling(false); }
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
        body: JSON.stringify({ value }),
      });
      await fetchTwitchStatus();
    } catch (e) {
      console.error('Failed to update import follows setting', e);
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

        <div className="card settings-card">
          <h2 style={{ marginTop: 0 }}>Downloads</h2>
          <p className="settings-description">
            Configure où les VODs téléchargées sont stockées et partagées.
          </p>

          {!loading && (
            <>
              <div style={{ marginBottom: '16px' }}>
                <label
                  htmlFor="local-download-path"
                  style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}
                >
                  Dossier de téléchargement local
                </label>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <input
                    id="local-download-path"
                    type="text"
                    value={settings.downloadLocalPath || ''}
                    readOnly
                    placeholder="Aucun dossier sélectionné"
                    style={{
                      flex: 1,
                      padding: '8px',
                      borderRadius: '4px',
                      background: 'var(--bg-elevated)',
                      color: 'var(--text)',
                      border: '1px solid var(--surface-soft)',
                    }}
                  />
                  <button onClick={() => selectFolder('downloadLocalPath')} className="action-btn secondary-btn">
                    Choisir
                  </button>
                </div>
                <small style={{ display: 'block', marginTop: '4px', color: 'var(--text-muted)' }}>
                  Où les vidéos téléchargées depuis cette machine seront enregistrées.
                </small>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label
                  htmlFor="network-share-path"
                  style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}
                >
                  Dossier de partage réseau
                </label>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <input
                    id="network-share-path"
                    type="text"
                    value={settings.downloadNetworkSharedPath || ''}
                    readOnly
                    placeholder="Aucun dossier sélectionné"
                    style={{
                      flex: 1,
                      padding: '8px',
                      borderRadius: '4px',
                      background: 'var(--bg-elevated)',
                      color: 'var(--text)',
                      border: '1px solid var(--surface-soft)',
                    }}
                  />
                  <button onClick={() => selectFolder('downloadNetworkSharedPath')} className="action-btn secondary-btn">
                    Choisir
                  </button>
                </div>
                <small style={{ display: 'block', marginTop: '4px', color: 'var(--text-muted)' }}>
                  Ce dossier sera exposé sur le réseau local via l&apos;onglet Downloads pour les
                  autres appareils.
                </small>
              </div>
            </>
          )}
        </div>

        <TwitchAccountSection
          twitchStatus={twitchStatus}
          twitchPolling={twitchPolling}
          twitchImporting={twitchImporting}
          linkTwitch={linkTwitch}
          unlinkTwitch={unlinkTwitch}
          importFollows={importFollows}
          setImportFollowsSetting={setImportFollowsSetting}
        />

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
