import React, { Suspense, lazy, useCallback, useMemo, useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import {
  TrendingUp,
  Home as HomeIcon,
  Search as SearchIcon,
  Radio,
  Download,
  MonitorSmartphone,
  Bell,
  X,
} from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { ScreenShareSessionState, ExperienceSettings } from '../../shared/types';
import Login from './Login';
import { useAuth } from '../../shared/hooks/useAuth';
import { useScreenShareState } from '../../shared/hooks/useScreenShareState';
import { ErrorBoundary } from '../../shared/components/ErrorBoundary';
import { ExtensionProvider, useExtensions } from './ExtensionContext';

const Home = lazy(() => import('./Home'));
const Channel = lazy(() => import('./Channel'));
const Player = lazy(() => import('./Player'));
const Trends = lazy(() => import('./Trends'));
const Search = lazy(() => import('./Search'));
const Live = lazy(() => import('./Live'));
const Settings = lazy(() => import('./Settings'));
const History = lazy(() => import('./History'));
const Downloads = lazy(() => import('./Downloads'));
const ScreenShare = lazy(() => import('./ScreenShare.tsx'));

type NavItem = {
  path: string;
  label: string;
  Icon: React.ComponentType<any>;
  IconProps?: any;
  isHome?: boolean;
};

type Notification = {
  id: string;
  title: string;
  message: string;
};

const NotificationToast = ({
  notifications,
  onClose,
}: {
  notifications: Notification[];
  onClose: (id: string) => void;
}) => {
  return (
    <div className="toast-container">
      {notifications.map((n) => (
        <div key={n.id} className="toast">
          <div className="toast-icon">
            <Bell size={18} />
          </div>
          <div className="toast-content">
            <div className="toast-title">{n.title}</div>
            <div className="toast-msg">{n.message}</div>
          </div>
          <button className="toast-close" onClick={() => onClose(n.id)}>
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
};

const UpdateNotification = ({
  updateInfo,
  onRestart,
}: {
  updateInfo: { version: string };
  onRestart: () => void;
}) => {
  return (
    <div className="toast-container" style={{ bottom: '80px', zIndex: 1000 }}>
      <div className="toast update-toast">
        <div className="toast-icon">
          <Bell size={18} />
        </div>
        <div className="toast-content">
          <div className="toast-title">Mise à jour installée (v{updateInfo.version})</div>
          <div className="toast-msg">Une nouvelle version a été installée avec succès.</div>
        </div>
        <button
          className="action-btn"
          onClick={onRestart}
          style={{ marginLeft: '12px', flexShrink: 0, padding: '4px 12px', fontSize: '0.85rem' }}
        >
          Restart
        </button>
      </div>
    </div>
  );
};

const BottomNav = React.memo(({ items }: Readonly<{ items: NavItem[] }>) => {
  const location = useLocation();
  const navigate = useNavigate();
  const hiddenRoutes = ['/player', '/channel'];

  if (hiddenRoutes.some((r) => location.pathname.startsWith(r))) {
    return null;
  }

  return (
    <nav className={`bottom-nav nav-count-${items.length}`} aria-label="Main Navigation">
      {items.map((item) => {
        const isActive =
          item.path === '/' ? location.pathname === '/' : location.pathname === item.path;
        return (
          <button
            key={item.path}
            className={`nav-btn ${isActive ? 'active' : ''} ${item.isHome ? 'nav-home-btn' : ''}`}
            onClick={() => navigate(item.path)}
            type="button"
          >
            <item.Icon size={item.isHome ? 28 : 22} {...item.IconProps} />
            <span className="nav-label">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
});

BottomNav.displayName = 'BottomNav';

function AppContent() {
  const { isAuthenticated } = useAuth();
  const { contributions } = useExtensions();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [installedUpdate, setInstalledUpdate] = useState<{ version: string } | null>(null);

  const removeNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const handleRestart = useCallback(async () => {
    try {
      await relaunch();
    } catch (err) {
      console.error('Failed to relaunch:', err);
      globalThis.location.reload();
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;

    const checkUpdate = async () => {
      try {
        const settingsRes = await fetch('/api/settings');
        if (!settingsRes.ok) return;
        const settings = (await settingsRes.json()) as ExperienceSettings;

        if (!settings.autoUpdate) return;

        // @ts-expect-error Tauri internals are injected at runtime
        if (!globalThis.__TAURI_INTERNALS__) return;

        const update = await check();
        if (update) {
          console.log(`Found update ${update.version}`);
          await update.downloadAndInstall();
          console.log('Update installed');
          setInstalledUpdate({ version: update.version });
        }
      } catch (err) {
        console.error('Failed to check for updates:', err);
      }
    };

    const timer = setTimeout(checkUpdate, 5000);
    return () => clearTimeout(timer);
  }, [isAuthenticated]);

  const handleNotification = useCallback(
    (event: { payload: { title: string; message: string } }) => {
      const id = Math.random().toString(36).substring(7);
      const newNotif = { id, ...event.payload };
      setNotifications((prev) => [...prev, newNotif]);
      setTimeout(() => removeNotification(id), 5000);
    },
    [removeNotification]
  );

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      // @ts-expect-error Tauri internals are injected at runtime
      if (globalThis.__TAURI_INTERNALS__) {
        unlisten = await listen<{ title: string; message: string }>(
          'nsv-notification',
          handleNotification
        );
      }
    };

    setupListener();
    return () => {
      if (unlisten) unlisten();
    };
  }, [handleNotification]);

  const fetchScreenShareState = useCallback(async () => {
    const response = await fetch('/api/screenshare/state');
    if (!response.ok) throw new Error('Failed to fetch state');
    return (await response.json()) as ScreenShareSessionState;
  }, []);

  const { state: screenShareState } = useScreenShareState(
    fetchScreenShareState,
    isAuthenticated ? 3000 : null
  );

  useEffect(() => {
    try {
      const currentUrl = new URL(globalThis.location.href);
      const queryToken = currentUrl.searchParams.get('t')?.trim();
      if (!queryToken) return;

      currentUrl.searchParams.delete('t');
      const cleanUrl = `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`;
      globalThis.history.replaceState({}, '', cleanUrl || '/');
    } catch {
      // Ignore
    }
  }, []);

  const navItems: NavItem[] = useMemo(
    () => [
      { path: '/trends', label: 'Trends', Icon: TrendingUp },
      { path: '/live', label: 'Live', Icon: Radio },
      { path: '/', label: 'Home', Icon: HomeIcon, isHome: true },
      ...(screenShareState.active
        ? [{ path: '/screen-share', label: 'Screen Share', Icon: MonitorSmartphone }]
        : []),
      { path: '/search', label: 'Search', Icon: SearchIcon },
      { path: '/downloads', label: 'Downloads', Icon: Download },
      // Contribution Nav Items
      ...contributions
        .filter((c) => c.type === 'nav')
        .map((c) => ({
          path: c.path || '',
          label: c.label || '',
          Icon: c.component,
          IconProps: c.componentProps,
        })),
    ],
    [screenShareState.active, contributions]
  );

  if (!isAuthenticated) {
    return <Login />;
  }

  return (
    <Router>
      <ErrorBoundary>
        <div className="app-container">
          <Suspense
            fallback={
              <div className="status-line" style={{ padding: '24px 16px' }}>
                Loading portal...
              </div>
            }
          >
            <div className="content-wrap">
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/trends" element={<Trends />} />
                <Route path="/live" element={<Live />} />
                <Route path="/search" element={<Search />} />
                <Route path="/history" element={<History />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/channel" element={<Channel />} />
                <Route path="/player" element={<Player />} />
                <Route path="/downloads" element={<Downloads />} />
                <Route path="/screen-share" element={<ScreenShare />} />
                {/* Contribution Routes */}
                {contributions
                  .filter((c) => c.type === 'route')
                  .map((c) => (
                    <Route
                      key={c.id}
                      path={c.path}
                      element={<c.component {...c.componentProps} />}
                    />
                  ))}
              </Routes>
            </div>
          </Suspense>
          <BottomNav items={navItems} />
          <NotificationToast notifications={notifications} onClose={removeNotification} />
          {installedUpdate && (
            <UpdateNotification updateInfo={installedUpdate} onRestart={handleRestart} />
          )}
        </div>
      </ErrorBoundary>
    </Router>
  );
}

export default function App() {
  return (
    <ExtensionProvider>
      <AppContent />
    </ExtensionProvider>
  );
}
