import { useCallback, useEffect, useState } from 'react';
import { call } from './lib/api';
import { AppContext } from './lib/context';
import Shell from './components/Shell';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Pos from './pages/Pos';
import Products from './pages/Products';
import Stock from './pages/Stock';
import Directory from './pages/Directory';
import Reports from './pages/Reports';
import Settings from './pages/Settings';

const PAGES = {
  dashboard: Dashboard,
  pos: Pos,
  products: Products,
  stock: Stock,
  directory: Directory,
  reports: Reports,
  settings: Settings,
};

export default function App() {
  const [auth, setAuth] = useState(null);
  const [settings, setSettings] = useState(null);
  const [page, setPage] = useState('dashboard');
  const [toast, setToast] = useState(null);
  const [fatal, setFatal] = useState('');

  const userId = auth?.user?.id ?? null;

  const loadAuth = useCallback(() => {
    call('auth.status').then(setAuth).catch((err) => setFatal(err.message));
  }, []);

  useEffect(() => {
    loadAuth();
  }, [loadAuth]);

  const reloadSettings = useCallback(() => {
    return call('settings.get').then(setSettings);
  }, []);

  useEffect(() => {
    if (userId) reloadSettings().catch((err) => setFatal(err.message));
  }, [userId, reloadSettings]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), toast.tone === 'error' ? 6000 : 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const notify = useCallback((message, tone = 'ok') => setToast({ message, tone, id: Date.now() }), []);

  if (fatal) {
    return (
      <div className="login">
        <div className="login-card">
          <h1>Something went wrong</h1>
          <p className="error">{fatal}</p>
        </div>
      </div>
    );
  }
  if (!auth) return <div className="login"><p className="muted">Starting…</p></div>;

  if (!auth.user) {
    return (
      <Login
        hasUsers={auth.hasUsers}
        onSignedIn={(user) => setAuth({ hasUsers: true, user })}
      />
    );
  }

  const Page = PAGES[page] ?? Dashboard;
  const signOut = async () => {
    await call('auth.logout');
    setSettings(null);
    setPage('dashboard');
    loadAuth();
  };

  return (
    <AppContext.Provider
      value={{ user: auth.user, settings, reloadSettings, notify, navigate: setPage }}
    >
      <Shell
        page={page}
        onNavigate={setPage}
        onSignOut={signOut}
        pharmacyName={settings?.pharmacyName}
      >
        {settings ? <Page key={page} /> : <p className="muted">Loading…</p>}
      </Shell>
      {toast && (
        <div className={`toast toast-${toast.tone}`} role="status" key={toast.id}>
          {toast.message}
        </div>
      )}
    </AppContext.Provider>
  );
}
