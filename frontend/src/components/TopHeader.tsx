import React from 'react';

interface TopHeaderProps {
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

export const TopHeader: React.FC<TopHeaderProps> = ({
  onToggleTheme,
}) => {
  return (
    <header className="top">
      <a className="brand" href="#/">
        <i aria-hidden="true" />
        <span>UNREACHABLE</span>
      </a>

      <div className="tr">
        <button
          className="ic"
          onClick={onToggleTheme}
          aria-label="Toggle light and dark"
          title="Toggle light and dark mode"
        >
          ◐
        </button>
      </div>
    </header>
  );
};
