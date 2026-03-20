import React, { Suspense, lazy, useState, useEffect } from 'react';
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
import { safeStorageGet } from './utils/storage.ts';

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

const defaultScreenShareState: ScreenShareSessionState = {
  active: false,
  sessionId: null,
  sourceType: null,
  sourceLabel: null,
  startedAt: null,
  interactive: true,
  maxViewers: 5,
  currentViewers: 0,
  streamReady: false,
  streamMessage: null,
};

function BottomNav({ items }: Readonly<{ items: NavItem[] }>) {
  const location = useLocation();
  const navigate = useNavigate();
  const hiddenRoutes = ['/player', '/channel'];

  if (hiddenRoutes.some((r) => location.pathname.startsWith(r))) {
    return null;
  }

  return (
    <nav
      className="bottom-nav"
      aria-label="Main Navigation"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
    >
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
            <span className="nav-icon">
              <item.Icon size={item.isHome ? 24 : 20} />
            </span>
            <span className="nav-label">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export default function App() {
  const [screenShareState, setScreenShareState] =
    useState<ScreenShareSessionState>(defaultScreenShareState);
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    const existingToken =
      safeStorageGet(sessionStorage, 'nsv_token') || safeStorageGet(localStorage, 'nsv_token');
    if (existingToken) return true;

    try {
      const currentUrl = new URL(globalThis.location.href);
      const queryToken = currentUrl.searchParams.get('t')?.trim();
      if (queryToken) {
        sessionStorage.setItem('nsv_token', queryToken);
        localStorage.setItem('nsv_token', queryToken);
        return true;
      }
    } catch {
      // Ignore malformed URL edge-cases.
    }

    return false;
  });

  useEffect(() => {
    try {
      const currentUrl = new URL(globalThis.location.href);
      const queryToken = currentUrl.searchParams.get('t')?.trim();
      if (!queryToken) return;

      currentUrl.searchParams.delete('t');
      const cleanUrl = `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`;
      globalThis.history.replaceState({}, '', cleanUrl || '/');
    } catch {
      // Ignore malformed URL edge-cases.
    }
  }, []);

  useEffect(() => {
    const handleStorageChange = () => {
      const token =
        safeStorageGet(sessionStorage, 'nsv_token') || safeStorageGet(localStorage, 'nsv_token');
      setIsAuthenticated(!!token);
    };
    globalThis.addEventListener('storage', handleStorageChange);
    return () => globalThis.removeEventListener('storage', handleStorageChange);
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      setScreenShareState(defaultScreenShareState);
      return;
    }

    let isMounted = true;

    const loadScreenShareState = async () => {
      try {
        const response = await fetch('/api/screenshare/state');
        if (!response.ok) return;
        const state = (await response.json()) as ScreenShareSessionState;
        if (isMounted) {
          setScreenShareState(state);
        }
      } catch {
        // Keep previous state when endpoint is temporarily unreachable.
      }
    };

    void loadScreenShareState();
    const interval = globalThis.setInterval(() => {
      void loadScreenShareState();
    }, 3000);

    return () => {
      isMounted = false;
      globalThis.clearInterval(interval);
    };
  }, [isAuthenticated]);

  if (!isAuthenticated) {
    return <Login />;
  }

  const navItems: NavItem[] = [
    { path: '/trends', label: 'Trends', Icon: TrendingUp },
    { path: '/live', label: 'Live', Icon: Radio },
    { path: '/', label: 'Home', Icon: HomeIcon, isHome: true },
    ...(screenShareState.active
      ? [{ path: '/screen-share', label: 'Screen Share', Icon: MonitorSmartphone }]
      : []),
    { path: '/search', label: 'Search', Icon: SearchIcon },
    { path: '/downloads', label: 'Downloads', Icon: Download },
  ];

  return (
    <Router>
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
    </Router>
  );
}
