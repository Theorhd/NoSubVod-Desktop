import React, { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

export interface TopBarProps {
  title?: ReactNode;
  mode?: 'back' | 'home' | 'logo';
  actions?: ReactNode;
  onLogoClick?: () => void;
}

export function TopBar({
  title = 'NoSubVod',
  mode = 'logo',
  actions,
  onLogoClick,
}: Readonly<TopBarProps>) {
  const navigate = useNavigate();

  return (
    <div className="top-bar">
      <div className="bar-main">
        {mode === 'back' && (
          <button onClick={() => navigate(-1)} className="back-btn" aria-label="Back" type="button">
            &larr;
          </button>
        )}
        {mode === 'home' && (
          <button onClick={() => navigate('/')} className="back-btn" aria-label="Back to Home" type="button">
            &larr;
          </button>
        )}

        {mode === 'logo' ? (
          <h1>
            <button className="logo-btn" onClick={onLogoClick || (() => navigate('/'))} aria-label="Home" type="button">
              {title}
            </button>
          </h1>
        ) : (
          <h1>{title}</h1>
        )}
      </div>

      {actions && <div className="top-actions">{actions}</div>}
    </div>
  );
}