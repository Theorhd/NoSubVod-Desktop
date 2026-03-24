import React, { Suspense, lazy, useCallback, useMemo, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import {
  TrendingUp,
  Home as HomeIcon,
  Search as SearchIcon,
  Radio,
  Download,
  MonitorSmartphone,
} from 'lucide-react';
import { ScreenShareSessionState } from '../../shared/types';
import Login from './Login';
import { useAuth } from '../../shared/hooks/useAuth';
import { useScreenShareState } from '../../shared/hooks/useScreenShareState';
import { ErrorBoundary } from '../../shared/components/ErrorBoundary';

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
  Icon: React.ComponentType<{ size?: number }>;
  isHome?: boolean;
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
            <item.Icon size={item.isHome ? 28 : 22} />
            <span className="nav-label">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
});

BottomNav.displayName = 'BottomNav';

export default function App() {
  const { isAuthenticated } = useAuth();

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
    ],
    [screenShareState.active]
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
              </Routes>
            </div>
          </Suspense>
          <BottomNav items={navItems} />
        </div>
      </ErrorBoundary>
    </Router>
  );
}
