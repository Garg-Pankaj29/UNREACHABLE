import { useState, useEffect, useCallback } from 'react';
import { api } from './services/api';
import {
  GeoJSONFeature,
  IssueRecord,
  StatsResponse,
} from './types';
import { INITIAL_ISSUES } from './services/store';
import { LivingBackground } from './components/LivingBackground';
import { TopHeader } from './components/TopHeader';
import { FloatingDock } from './components/FloatingDock';

// Pages
import { OverviewPage } from './pages/OverviewPage';
import { AccessAtlasPage } from './pages/AccessAtlasPage';
import { RoutesPage } from './pages/RoutesPage';
import { AIInspectorPage } from './pages/AIInspectorPage';
import { InterventionsPage } from './pages/InterventionsPage';
import { SimulationPage } from './pages/SimulationPage';
import { AboutPage } from './pages/AboutPage';
import { BuildingDetailPage } from './pages/BuildingDetailPage';
import { IssueDetailPage } from './pages/IssueDetailPage';
import { DemoPage } from './pages/DemoPage';

export function App() {
  // Theme state
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('unreachable-theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  // Navigation router state based on location.hash
  const [currentRoute, setCurrentRoute] = useState<string>('');
  const [routeParam, setRouteParam] = useState<string>('');

  // Backend state
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [datasetMode, setDatasetMode] = useState<'pilot' | 'sample'>('pilot');
  const [buildings, setBuildings] = useState<GeoJSONFeature[]>([]);
  const [roads, setRoads] = useState<GeoJSONFeature[]>([]);
  const [stations, setStations] = useState<GeoJSONFeature[]>([]);
  const [selectedFeature, setSelectedFeature] = useState<GeoJSONFeature | null>(null);
  const [backendLoading, setBackendLoading] = useState<boolean>(true);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [isReplay, setIsReplay] = useState<boolean>(() => api.isReplay());

  useEffect(() => {
    return api.onReplayChange(setIsReplay);
  }, []);

  // Issues and activity log state
  const [issues, setIssues] = useState<IssueRecord[]>(INITIAL_ISSUES);
  const [sessionLog, setSessionLog] = useState<string[]>([
    'Session started with demonstration dataset',
    'Loaded 6 municipal building footprints from FastAPI',
    'Verified 6 road corridor segments and 1 dispatch base',
  ]);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((cur) => (cur === msg ? null : cur));
    }, 2800);
  };

  const addLog = (entry: string) => {
    setSessionLog((prev) => [entry, ...prev.slice(0, 9)]);
  };

  // Sync theme to document element
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('unreachable-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  // Hash-based routing parser
  const parseHash = useCallback(() => {
    const rawHash = window.location.hash.replace(/^#\/?/, '');
    const [pathPart] = rawHash.split('?');
    const parts = (pathPart || '').split('/').filter(Boolean);
    let route = parts[0] || '';
    const param = parts[1] || '';

    if (route === 'buildings' || route === 'building') route = 'b';
    if (route === 'issues' || route === 'issue') route = 'i';

    setCurrentRoute(route);
    setRouteParam(param);
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    parseHash();
    window.addEventListener('hashchange', parseHash);
    return () => window.removeEventListener('hashchange', parseHash);
  }, [parseHash]);

  // Load backend data from FastAPI endpoints
  const fetchBackendData = useCallback(async (mode: 'pilot' | 'sample' = datasetMode) => {
    setBackendLoading(true);
    setBackendError(null);
    try {
      await api.fetchHealth();

      if (mode === 'pilot') {
        try {
          // Fetch real pilot facilities (all 422 hospitals, fire stations, clinics)
          const facRes = await api.fetchPilotFacilities();
          const stns = facRes.features || [];

          // Fetch real pilot arterial roads
          const pilotRes = await api.fetchPilotFeatures({ zoom: 12 });
          const feats = pilotRes.features || [];
          const rds = feats.filter((f) => f.properties?.feature_type === 'road');
          const bldgs = feats.filter((f) => f.properties?.feature_type === 'building');

          setStations(stns);
          setRoads(rds);
          setBuildings(bldgs);
          addLog(`Loaded real geographic pilot: ${stns.length} facilities, ${rds.length} road corridors`);
        } catch (pilotErr: any) {
          console.warn('Pilot API unavailable, falling back to sample:', pilotErr);
          mode = 'sample';
          setDatasetMode('sample');
        }
      }

      if (mode === 'sample') {
        const statsData = await api.fetchStats();
        setStats(statsData);

        const neighbourhood = await api.fetchNeighbourhood();
        const feats = neighbourhood.features || [];

        const bldgs = feats.filter((f) => f.properties?.feature_type === 'building');
        const rds = feats.filter((f) => f.properties?.feature_type === 'road');
        const stns = feats.filter((f) => f.properties?.feature_type === 'station');

        setBuildings(bldgs);
        setRoads(rds);
        setStations(stns);
        addLog('Loaded synthetic demonstration area');
      }
    } catch (err: any) {
      console.warn('FastAPI backend connection note:', err.message);
      setBackendError(err.message || 'Unable to connect to FastAPI backend');
    } finally {
      setBackendLoading(false);
    }
  }, [datasetMode]);

  useEffect(() => {
    fetchBackendData();
  }, [fetchBackendData]);

  // Handle dynamic Level-of-Detail viewport updates for pilot dataset
  const handleViewportChange = useCallback(async (bbox: string, zoom: number) => {
    if (datasetMode !== 'pilot') return;
    if (zoom < 14) return; // At lower zooms, major roads & facilities are sufficient

    try {
      const res = await api.fetchPilotFeatures({ bbox, zoom, limit: 1500 });
      const feats = res.features || [];
      const newBldgs = feats.filter((f) => f.properties?.feature_type === 'building');
      const newRds = feats.filter((f) => f.properties?.feature_type === 'road');

      if (newBldgs.length > 0 || newRds.length > 0) {
        setBuildings(newBldgs);
        setRoads((prev) => {
          const map = new Map<string, GeoJSONFeature>();
          prev.forEach((r) => {
            const id = r.properties?.id || r.id;
            if (id) map.set(id, r);
          });
          newRds.forEach((r) => {
            const id = r.properties?.id || r.id;
            if (id) map.set(id, r);
          });
          return Array.from(map.values());
        });
      }
    } catch (err) {
      console.warn('LOD viewport load note:', err);
    }
  }, [datasetMode]);

  const handleToggleDataset = (targetMode?: 'pilot' | 'sample') => {
    const nextMode = targetMode || (datasetMode === 'pilot' ? 'sample' : 'pilot');
    setDatasetMode(nextMode);
    setSelectedFeature(null);
    fetchBackendData(nextMode);
    showToast(nextMode === 'pilot' ? 'Switched to Real Geographic Pilot (Chandigarh)' : 'Switched to Synthetic Demo (Gharuan)');
  };

  // Issue status transitions
  const handleUpdateIssueStatus = (
    id: string,
    newStatus: 'open' | 'review' | 'verified' | 'resolved'
  ) => {
    setIssues((prev) =>
      prev.map((iss) =>
        iss.id === id
          ? {
              ...iss,
              st: newStatus,
              ver:
                newStatus === 'verified'
                  ? 'Verified by municipal reviewer (demo)'
                  : iss.ver,
            }
          : iss
      )
    );
    const msg = `${id} marked as ${newStatus}`;
    addLog(msg);
    showToast(msg);
  };

  const handleAddIssue = (newIssue: IssueRecord) => {
    setIssues((prev) => [newIssue, ...prev]);
    const msg = `Created new hazard issue ${newIssue.id}`;
    addLog(msg);
    showToast(msg);
  };

  // Render current screen
  const renderScreen = () => {
    switch (currentRoute) {
      case 'map':
        return (
          <AccessAtlasPage
            buildings={buildings}
            roads={roads}
            stations={stations}
            issues={issues}
            selectedFeature={selectedFeature}
            onSelectFeature={setSelectedFeature}
            datasetMode={datasetMode}
            onToggleDataset={handleToggleDataset}
            onViewportChange={handleViewportChange}
          />
        );

      case 'routes':
        return (
          <RoutesPage
            buildings={buildings}
            stations={stations}
            roads={roads}
            datasetMode={datasetMode}
            initialTarget={selectedFeature}
            targetId={routeParam}
          />
        );

      case 'inspector':
        return (
          <AIInspectorPage
            roads={roads}
            buildings={buildings}
            onAddIssue={handleAddIssue}
          />

        );

      case 'interventions':
        return (
          <InterventionsPage
            issues={issues}
            onUpdateIssueStatus={handleUpdateIssueStatus}
          />
        );

      case 'simulation':
        return (
          <SimulationPage
            initialIssueId={routeParam}
            issues={issues}
          />
        );

      case 'about':
        return <AboutPage />;

      case 'demo':
        return (
          <DemoPage
            stepParam={routeParam}
            buildings={buildings}
            roads={roads}
            stations={stations}
            issues={issues}
            onUpdateIssueStatus={handleUpdateIssueStatus}
          />
        );

      case 'b':
        return (
          <BuildingDetailPage
            buildingId={routeParam}
            buildings={buildings}
            roads={roads}
            datasetMode={datasetMode}
            loading={backendLoading}
            error={backendError}
          />
        );

      case 'i':
        return (
          <IssueDetailPage
            issueId={routeParam}
            issues={issues}
            onUpdateStatus={handleUpdateIssueStatus}
          />
        );

      case '':
      case 'dashboard':
      default:
        return (
          <OverviewPage
            stats={stats}
            issues={issues}
            sessionLog={sessionLog}
          />
        );
    }
  };

  return (
    <>
      {/* Subtle top hazard loading bar */}
      {backendLoading && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            height: '3px',
            background:
              'repeating-linear-gradient(90deg, var(--tape) 0 10px, var(--ink) 10px 20px)',
            zIndex: 1001,
          }}
          aria-hidden="true"
        />
      )}

      {/* Living background simulation canvas */}
      <LivingBackground theme={theme} />

      {/* Top Header with integrated Dataset Switcher, Replay Badge, and Friendly Theme Toggle */}
      <TopHeader
        theme={theme}
        onToggleTheme={toggleTheme}
        isReplay={isReplay}
        datasetMode={datasetMode}
        onToggleDataset={() => handleToggleDataset()}
      />

      {/* Connection notification if backend is unreachable and not in replay */}
      {backendError && !isReplay && (
        <div
          role="alert"
          style={{
            position: 'fixed',
            top: '72px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 40,
            background: 'var(--glass)',
            backdropFilter: 'blur(12px)',
            border: '1px solid var(--sig)',
            borderRadius: '99px',
            padding: '6px 16px',
            fontSize: '12px',
            color: 'var(--sig)',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
          }}
        >
          <span>FastAPI backend unreachable at {api.getBaseUrl()}</span>
          <button
            onClick={() => fetchBackendData()}
            style={{
              background: 'var(--ink)',
              color: 'var(--bg)',
              border: 0,
              borderRadius: '99px',
              padding: '2px 8px',
              fontSize: '11px',
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Main Content Area */}
      <main id="app" className={currentRoute === 'map' ? 'stage-active' : ''}>
        {renderScreen()}
      </main>

      {/* Floating Bottom Navigation Dock */}
      <FloatingDock currentPath={currentRoute} />

      {/* Action Toast Feedback */}
      {toastMessage && (
        <div className="toast" role="status">
          {toastMessage}
        </div>
      )}
    </>
  );
}

export default App;
