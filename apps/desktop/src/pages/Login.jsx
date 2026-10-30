import { useState } from 'react';
import { call } from '../lib/api';
import { Field } from '../components/ui';

export default function Login({ hasUsers, onSignedIn }) {
  const [form, setForm] = useState({ name: '', username: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const update = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!hasUsers && form.password !== form.confirm) {
      setError('The two passwords do not match');
      return;
    }
    setBusy(true);
    try {
      const user = hasUsers
        ? await call('auth.login', { username: form.username, password: form.password })
        : await call('auth.setup', { name: form.name, username: form.username, password: form.password });
      onSignedIn(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="brand-mark large">+</div>
        <h1>Pharmacy Suite</h1>
        <p className="muted">
          {hasUsers ? 'Sign in to continue' : 'Create the owner account to get started'}
        </p>

        {!hasUsers && (
          <Field label="Full name" wide>
            <input value={form.name} onChange={update('name')} required autoFocus />
          </Field>
        )}
        <Field label="Username" wide>
          <input
            value={form.username}
            onChange={update('username')}
            autoComplete="username"
            required
            autoFocus={hasUsers}
          />
        </Field>
        <Field label="Password" hint="At least 8 characters" wide>
          <input
            type="password"
            value={form.password}
            onChange={update('password')}
            autoComplete={hasUsers ? 'current-password' : 'new-password'}
            required
          />
        </Field>
        {!hasUsers && (
          <Field label="Confirm password" wide>
            <input
              type="password"
              value={form.confirm}
              onChange={update('confirm')}
              autoComplete="new-password"
              required
            />
          </Field>
        )}

        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Please wait…' : hasUsers ? 'Sign in' : 'Create account'}
        </button>
      </form>
    </div>
  );
}
