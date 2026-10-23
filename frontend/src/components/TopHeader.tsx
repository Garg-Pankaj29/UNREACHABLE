import React from 'react';
import { Zap, Sun, Moon, Navigation } from 'lucide-react';

interface TopHeaderProps {
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  isReplay?: boolean;
  datasetMode?: 'pilot' | 'sample';
  onToggleDataset?: () => void;
}

export const TopHeader: React.FC<TopHeaderProps> = ({
  theme,
  onToggleTheme,
  isReplay = false,
  datasetMode = 'pilot',
  onToggleDataset,
}) => {
  return (
    <header className="top" role="banner">
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <a className="brand" href="#/" title="UNREACHABLE Emergency Access Intelligence">
          <i aria-hidden="true" />
          <span>UNREACHABLE</span>
        </a>
        {datasetMode === 'pilot' ? (
          <button
            type="button"
            id="pilot-dataset-ribbon"
            onClick={onToggleDataset}
            className="header-synthetic-badge"
            role="note"
            aria-label="Real pilot geographic dataset active. Click to switch to demo dataset."
            style={{
              background: 'rgba(22, 138, 92, 0.15)',
              borderColor: 'rgba(22, 138, 92, 0.45)',
              color: '#168a5c',
              cursor: onToggleDataset ? 'pointer' : 'default',
            }}
            title="Real Pilot: Chandigarh-Mohali-Gharuan (Click to toggle Demo dataset)"
          >
            <span
              style={{
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                background: '#168a5c',
                display: 'inline-block',
                boxShadow: '0 0 6px #168a5c',
              }}
            />
            <span>Real Pilot: Chandigarh (82k+ features)</span>
          </button>
        ) : (
          <button
            type="button"
            id="synthetic-demo-data-ribbon"
            onClick={onToggleDataset}
            className="header-synthetic-badge"
            role="note"
            aria-label="Synthetic demo data notice. Click to switch to real pilot dataset."
            style={{ cursor: onToggleDataset ? 'pointer' : 'default' }}
            title="Synthetic Prototype Model (Click to toggle Real Pilot dataset)"
          >
            <Zap size={11} className="fill-current text-current" aria-hidden="true" />
            <span>Synthetic demo data</span>
          </button>
        )}

        <a
          href="#/routes"
          className="header-routes-btn"
          id="header-routes-nav"
          title="Emergency Centre Selection & Multiple Routes"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            background: 'var(--tape, #ffd60a)',
            color: '#1c1f1b',
            padding: '5px 14px',
            borderRadius: '99px',
            fontSize: '12px',
            fontWeight: 800,
            textDecoration: 'none',
            letterSpacing: '0.02em',
            boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
            transition: 'transform 0.15s ease',
          }}
        >
          <Navigation size={13} style={{ transform: 'rotate(45deg)' }} />
          <span>Emergency Routes</span>
        </a>
      </div>

      <div className="tr" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        {isReplay && (
          <div
            role="status"
            id="replay-mode-badge"
            style={{
              background: 'rgba(215, 38, 61, 0.92)',
              border: '1.5px solid #d7263d',
              borderRadius: '99px',
              padding: '4px 12px',
              fontSize: '11px',
              color: '#ffffff',
              fontWeight: 800,
              letterSpacing: '0.04em',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: '0 2px 10px rgba(215, 38, 61, 0.35)',
              textTransform: 'uppercase',
            }}
          >
            <span
              style={{
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                background: '#ffd60a',
                display: 'inline-block',
                boxShadow: '0 0 6px #ffd60a',
              }}
            />
            <span>Replay mode (saved data)</span>
          </div>
        )}

        <button
          className="theme-toggle-btn"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {theme === 'dark' ? (
            <Sun size={14} aria-hidden="true" />
          ) : (
            <Moon size={14} aria-hidden="true" />
          )}
          <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
        </button>
      </div>
    </header>
  );
};

