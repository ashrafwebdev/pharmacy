import { useEffect, useState } from 'react';
import { call, can } from '../lib/api';
import { useApp } from '../lib/context';

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: '▦' },
  { id: 'pos', label: 'Sell', icon: '🛒' },
  { id: 'products', label: 'Products', icon: '💊' },
  { id: 'stock', label: 'Stock & Batches', icon: '📦' },
  { id: 'directory', label: 'Customers & Suppliers', icon: '👥' },
  { id: 'reports', label: 'Reports', icon: '📊', perm: 'reports.view' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
];

function SyncIndicator() {
  const { notify } = useApp();
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => call('sync.status').then(setStatus).catch(() => {});

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 15_000);
    return () => clearInterval(timer);
  }, []);

  async function syncNow() {
    setBusy(true);
    try {
      const result = await call('sync.now');
      if (result.skipped) notify('Sync is not set up yet — see Settings', 'error');
      else if (result.ok) notify(`Synced: ${result.pushed} sent, ${result.pulled} received`);
      else notify(result.error, 'error');
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
      refresh();
    }
  }

  let tone = 'off';
  let label = 'Offline mode';
  if (status?.configured) {
    if (status.lastError) {
      tone = 'error';
      label = 'Sync failed — working offline';
    } else if (status.pending > 0) {
      tone = 'pending';
      label = `${status.pending} change(s) waiting to sync`;
    } else {
      tone = 'ok';
      label = 'All changes synced';
    }
  }

  return (
    <div className="sync">
      <span className={`dot dot-${tone}`} />
      <span className="sync-label">{label}</span>
      {status?.configured && (
        <button className="btn btn-small" onClick={syncNow} disabled={busy || status.running}>
          {busy || status.running ? 'Syncing…' : 'Sync now'}
        </button>
      )}
    </div>
  );
}

export default function Shell({ page, onNavigate, onSignOut, pharmacyName, children }) {
  const { user } = useApp();
  const items = NAV.filter((item) => !item.perm || can(user, item.perm));

  return (
    <div className="app">
      <aside className="sidebar no-print">
        <div className="brand">
          <span className="brand-mark">+</span>
          <div>
            <strong>{pharmacyName || 'Pharmacy Suite'}</strong>
            <small className="muted">Pharmacy Suite</small>
          </div>
        </div>
        <nav>
          {items.map((item) => (
            <button
              key={item.id}
              className={`nav-item${page === item.id ? ' active' : ''}`}
              onClick={() => onNavigate(item.id)}
            >
              <span className="nav-icon" aria-hidden="true">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="me">
          <div>
            <strong>{user.name}</strong>
            <small className="muted">{user.role}</small>
          </div>
          <button className="btn btn-ghost btn-small" onClick={onSignOut}>Sign out</button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar no-print">
          <SyncIndicator />
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
