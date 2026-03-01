import React from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import Home from './Home';
import Channel from './Channel';
import Player from './Player';
import Trends from './Trends';
import Search from './Search';
import Live from './Live';
import Settings from './Settings';
import History from './History';
import { TrendingUp, Home as HomeIcon, Search as SearchIcon, Radio } from 'lucide-react';

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
        <BottomNav />
      </div>
    </Router>
  );
}
