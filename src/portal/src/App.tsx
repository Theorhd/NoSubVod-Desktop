import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { TrendingUp, Home as HomeIcon, Search as SearchIcon, Radio } from 'lucide-react';

const Home = lazy(() => import('./Home'));
const Channel = lazy(() => import('./Channel'));
const Player = lazy(() => import('./Player'));
const Trends = lazy(() => import('./Trends'));
const Search = lazy(() => import('./Search'));
const Live = lazy(() => import('./Live'));
const Settings = lazy(() => import('./Settings'));
const History = lazy(() => import('./History'));

const navItems = [
  { path: '/trends', label: 'Trends', Icon: TrendingUp },
  { path: '/', label: 'Home', Icon: HomeIcon },
  { path: '/live', label: 'Live', Icon: Radio },
  { path: '/search', label: 'Search', Icon: SearchIcon },
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
            className={`nav-btn ${isActive ? 'active' : ''}`}
            onClick={() => navigate(item.path)}
            type="button"
          >
            <span className="nav-icon">
              <item.Icon size={20} />
            </span>
            <span className="nav-label">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export default function App() {
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
            </Routes>
          </div>
        </Suspense>
        <BottomNav />
      </div>
    </Router>
  );
}
