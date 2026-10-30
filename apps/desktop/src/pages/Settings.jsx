import { useEffect, useState } from 'react';
import { call, can } from '../lib/api';
import { useApp } from '../lib/context';
import { formatDateTime } from '../lib/format';
import { Empty, Field, Modal, PageHeader } from '../components/ui';

const ROLE_LABELS = { admin: 'Admin', pharmacist: 'Pharmacist', cashier: 'Cashier' };

export default function Settings() {
  const { user } = useApp();
  return (
    <>
      <PageHeader title="Settings" subtitle="Shop details, staff, cloud sync and backups" />
      {can(user, 'settings.write') && <BusinessSettings />}
      {can(user, 'users.manage') && <Users />}
      {can(user, 'sync.manage') && <SyncSettings />}
      {can(user, 'data.export') && <Backup />}
      {!can(user, 'settings.write') && <p className="muted">Only the admin can change shop settings.</p>}
    </>
  );
}

function BusinessSettings() {
  const { settings, reloadSettings, notify } = useApp();
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (settings) setForm({ ...settings, expiryWarningDays: String(settings.expiryWarningDays) });
  }, [settings]);

  if (!form) return null;
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await call('settings.save', { ...form, expiryWarningDays: Number(form.expiryWarningDays) });
      await reloadSettings();
      notify('Shop settings saved');
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>Shop details</h2>
      <form className="form-grid" onSubmit={save}>
        <Field label="Pharmacy name" wide>
          <input value={form.pharmacyName} onChange={set('pharmacyName')} required />
        </Field>
        <Field label="Currency code" hint="For example USD, EUR, GBP, INR">
          <input value={form.currency} onChange={set('currency')} maxLength={3} required />
        </Field>
        <Field label="Expiry warning (days)">
          <input type="number" min="1" max="730" value={form.expiryWarningDays} onChange={set('expiryWarningDays')} required />
        </Field>
        <Field label="Receipt footer" wide>
          <input value={form.receiptFooter} onChange={set('receiptFooter')} />
        </Field>
        <div className="form-actions">
          <button className="btn btn-primary" disabled={busy}>Save shop details</button>
        </div>
      </form>
    </section>
  );
}

function Users() {
  const { notify, user: me } = useApp();
  const [users, setUsers] = useState([]);
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState(null);

  const load = () => call('users.list').then(setUsers).catch((e) => notify(e.message, 'error'));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function update(id, patch) {
    try {
      await call('users.update', { id, ...patch });
      load();
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Staff accounts</h2>
        <button className="btn btn-primary btn-small" onClick={() => setCreating(true)}>Add user</button>
      </div>
      <table>
        <thead><tr><th>Username</th><th>Name</th><th>Role</th><th>Status</th><th /></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td className="mono">{u.username}{u.id === me.id && <span className="tag">you</span>}</td>
              <td>{u.name}</td>
              <td>
                <select value={u.role} onChange={(e) => update(u.id, { role: e.target.value })}>
                  {Object.entries(ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </td>
              <td>{u.active ? 'Active' : 'Disabled'}</td>
              <td className="row-actions">
                <button className="btn btn-ghost btn-small" onClick={() => update(u.id, { active: !u.active })}>
                  {u.active ? 'Disable' : 'Enable'}
                </button>
                <button className="btn btn-ghost btn-small" onClick={() => setResetting(u)}>Reset password</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {users.length === 0 && <Empty>No users yet.</Empty>}

      {creating && (
        <UserForm
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            notify('User added');
            load();
          }}
        />
      )}
      {resetting && (
        <ResetPasswordForm
          user={resetting}
          onClose={() => setResetting(null)}
          onDone={() => {
            setResetting(null);
            notify('Password changed');
          }}
        />
      )}
    </section>
  );
}

function UserForm({ onClose, onDone }) {
  const { notify } = useApp();
  const [form, setForm] = useState({ username: '', name: '', role: 'cashier', password: '' });
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    try {
      await call('users.create', form);
      onDone();
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  return (
    <Modal
      title="Add user"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" form="user-form">Create user</button>
        </>
      }
    >
      <form id="user-form" className="form-grid" onSubmit={submit}>
        <Field label="Full name" wide><input value={form.name} onChange={set('name')} required /></Field>
        <Field label="Username"><input value={form.username} onChange={set('username')} required /></Field>
        <Field label="Role">
          <select value={form.role} onChange={set('role')}>
            {Object.entries(ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        <Field label="Temporary password" hint="At least 8 characters" wide>
          <input type="password" value={form.password} onChange={set('password')} required />
        </Field>
      </form>
    </Modal>
  );
}

function ResetPasswordForm({ user, onClose, onDone }) {
  const { notify } = useApp();
  const [password, setPassword] = useState('');

  async function submit(e) {
    e.preventDefault();
    try {
      await call('users.resetPassword', { id: user.id, password });
      onDone();
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  return (
    <Modal
      title={`New password for ${user.username}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" form="reset-form">Set password</button>
        </>
      }
    >
      <form id="reset-form" className="form-stack" onSubmit={submit}>
        <Field label="New password" hint="At least 8 characters">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
        </Field>
      </form>
    </Modal>
  );
}

function SyncSettings() {
  const { notify } = useApp();
  const [status, setStatus] = useState(null);
  const [form, setForm] = useState({ url: '', deviceName: '', apiKey: '', enabled: false });
  const [busy, setBusy] = useState(false);

  const load = () =>
    call('sync.status').then((s) => {
      setStatus(s);
      setForm((f) => ({ ...f, url: s.url, deviceName: s.deviceName, enabled: s.enabled }));
    }).catch(() => {});

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (key) => (e) =>
    setForm({ ...form, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await call('sync.configure', form);
      setForm((f) => ({ ...f, apiKey: '' }));
      notify('Sync settings saved');
      load();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function syncNow() {
    setBusy(true);
    try {
      const result = await call('sync.now');
      if (result.ok) notify(`Synced: ${result.pushed} sent, ${result.pulled} received`);
      else notify(result.error, 'error');
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
      load();
    }
  }

  return (
    <section className="card">
      <h2>Cloud sync</h2>
      <p className="muted">
        The shop works fully offline. When the server is reachable, sales and stock sync automatically
        every minute. Leave sync disabled to keep this computer standalone.
      </p>
      <form className="form-grid" onSubmit={save}>
        <Field label="Server address" hint="For example https://sync.yourpharmacy.com" wide>
          <input value={form.url} onChange={set('url')} placeholder="https://…" />
        </Field>
        <Field label="Branch API key" hint={status?.hasApiKey ? 'A key is saved. Type a new one to replace it.' : 'Given by your server administrator'}>
          <input type="password" value={form.apiKey} onChange={set('apiKey')} autoComplete="off" />
        </Field>
        <Field label="This computer's name">
          <input value={form.deviceName} onChange={set('deviceName')} placeholder="Front counter" />
        </Field>
        <label className="check wide">
          <input type="checkbox" checked={form.enabled} onChange={set('enabled')} />
          Enable sync
        </label>
        <div className="form-actions">
          <button className="btn btn-primary" disabled={busy}>Save sync settings</button>
          <button type="button" className="btn" onClick={syncNow} disabled={busy || !status?.configured}>Sync now</button>
        </div>
      </form>

      {status && (
        <dl className="facts">
          <dt>Status</dt><dd>{status.configured ? 'Enabled' : 'Off (working offline)'}</dd>
          <dt>Waiting to upload</dt><dd>{status.pending}</dd>
          <dt>Last successful sync</dt><dd>{status.lastSyncAt ? formatDateTime(status.lastSyncAt) : 'Never'}</dd>
          {status.lastError && <><dt>Last error</dt><dd className="error">{status.lastError}</dd></>}
          <dt>Device ID</dt><dd className="mono small">{status.deviceId}</dd>
        </dl>
      )}
    </section>
  );
}

function Backup() {
  const { notify } = useApp();
  async function backup() {
    try {
      const result = await call('backup.create');
      if (result.saved) notify(`Backup saved to ${result.path}`);
    } catch (err) {
      notify(err.message, 'error');
    }
  }
  return (
    <section className="card">
      <h2>Backup</h2>
      <p className="muted">Save a copy of the local database. Keep it on a USB drive or another disk.</p>
      <button className="btn" onClick={backup}>Back up database</button>
    </section>
  );
}
