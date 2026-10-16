import React from 'react';

interface FloatingDockProps {
  currentPath: string;
}

export const NAV_ITEMS = [
  { path: '', icon: '◎', label: 'Overview' },
  { path: 'map', icon: '⌖', label: 'Access Atlas' },
  { path: 'routes', icon: '↗', label: 'Routes' },
  { path: 'inspector', icon: '◈', label: 'AI Inspector' },
  { path: 'interventions', icon: '▲', label: 'Interventions' },
  { path: 'simulation', icon: '◐', label: 'Simulation' },
  { path: 'about', icon: 'ⓘ', label: 'About' },
];

export const FloatingDock: React.FC<FloatingDockProps> = ({ currentPath }) => {
  // Normalize current path (e.g. 'dashboard' maps to '', 'b' maps to 'map', 'i' maps to 'interventions')
  let activeKey = currentPath;
  if (activeKey === 'dashboard' || activeKey === '/') activeKey = '';
  if (activeKey === 'b' || activeKey === 'building' || activeKey === 'buildings') activeKey = 'map';
  if (activeKey === 'i' || activeKey === 'issue' || activeKey === 'issues') activeKey = 'interventions';

  return (
    <nav className="dk" aria-label="Main navigation">
      {NAV_ITEMS.map((item) => {
        const isActive = activeKey === item.path;
        const href = `#/${item.path}`;

        return (
          <a
            key={item.path}
            href={href}
            className={isActive ? 'on' : ''}
            title={item.label}
            aria-current={isActive ? 'page' : undefined}
          >
            <b>{item.icon}</b>
            <span>{item.label}</span>
          </a>
        );
      })}
    </nav>
  );
};
