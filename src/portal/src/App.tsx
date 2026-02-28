import React from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import Home from './Home';
import Channel from './Channel';
import Player from './Player';
import Trends from './Trends';
import Search from './Search';

function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const hiddenRoutes = ['/player', '/channel'];
  
  if (hiddenRoutes.some(r => location.pathname.startsWith(r))) {
    return null;
  }

  return (
    <div className="bottom-nav">
      <button 
        className={`nav-btn ${location.pathname === '/trends' ? 'active' : ''}`}
        onClick={() => navigate('/trends')}
      >
        Trends
      </button>
      <button 
        className={`nav-btn ${location.pathname === '/' ? 'active' : ''}`}
        onClick={() => navigate('/')}
      >
        Home
      </button>
      <button 
        className={`nav-btn ${location.pathname === '/search' ? 'active' : ''}`}
        onClick={() => navigate('/search')}
      >
        Search
      </button>
    </div>
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
            <Route path="/search" element={<Search />} />
            <Route path="/channel" element={<Channel />} />
            <Route path="/player" element={<Player />} />
          </Routes>
        </div>
        <BottomNav />
      </div>
    </Router>
  );
}