import React, { Suspense, lazy, useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { TrendingUp, Home as HomeIcon, Search as SearchIcon, Radio, Download } from 'lucide-react';
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

const navItems = [
  { path: '/trends', label: 'Trends', Icon: TrendingUp },
  { path: '/live', label: 'Live', Icon: Radio },
  { path: '/', label: 'Home', Icon: HomeIcon, isHome: true },
  { path: '/search', label: 'Search', Icon: SearchIcon },
  { path: '/downloads', label: 'Downloads', Icon: Download },
];

function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const hiddenRoutes = ['/player', '/channel'];

  if (hiddenRoutes.some((r) => location.pathname.startsWith(r))) {
    return null;
  }

  return (
    <nav className="bottom-nav" aria-label="Main Navigation">
      {navItems.map((item) => {
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

  if (!isAuthenticated) {
    return <Login />;
  }

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
            </Routes>
          </div>
        </Suspense>
        <BottomNav />
      </div>
    </Router>
  );
}
