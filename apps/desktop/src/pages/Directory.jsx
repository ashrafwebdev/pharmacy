import { useEffect, useState } from 'react';
import { call, can } from '../lib/api';
import { useApp } from '../lib/context';
import { Empty, Field, Modal, PageHeader } from '../components/ui';

const KINDS = {
  customers: { label: 'Customers', perm: 'parties.write', noun: 'customer' },
  suppliers: { label: 'Suppliers', perm: 'catalog.write', noun: 'supplier' },
};
const BLANK = { id: null, name: '', phone: '', email: '', address: '', notes: '' };

export default function Directory() {
  const { user, notify } = useApp();
  const [kind, setKind] = useState('customers');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null);
  const config = KINDS[kind];
  const canWrite = can(user, config.perm);

  const load = () =>
    call(`${kind}.list`, { search }).then(setRows).catch((e) => notify(e.message, 'error'));

  useEffect(() => {
    const timer = setTimeout(load, 200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, search]);

  async function remove(row) {
    if (!window.confirm(`Remove ${row.name}?`)) return;
    try {
      await call(`${kind}.remove`, { id: row.id });
      notify(`${row.name} removed`);
      load();
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  return (
    <>
      <PageHeader
        title="Customers & Suppliers"
        subtitle="Contacts for sales, reordering and deliveries"
        actions={canWrite && <button className="btn btn-primary" onClick={() => setEditing(BLANK)}>New {config.noun}</button>}
      />
      <div className="tabs">
        {Object.entries(KINDS).map(([key, value]) => (
          <button key={key} className={`tab${kind === key ? ' active' : ''}`} onClick={() => setKind(key)}>
            {value.label}
          </button>
        ))}
      </div>
      <div className="toolbar">
        <input
          className="search-input"
          placeholder={`Search ${config.label.toLowerCase()} by name or phone`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {rows.length === 0 ? (
        <Empty>No {config.label.toLowerCase()} yet.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Name</th><th>Phone</th><th>Email</th><th>Address</th>{canWrite && <th />}</tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td><strong>{row.name}</strong></td>
                  <td>{row.phone || '—'}</td>
                  <td>{row.email || '—'}</td>
                  <td>{row.address || '—'}</td>
                  {canWrite && (
                    <td className="row-actions">
                      <button className="btn btn-ghost btn-small" onClick={() => setEditing({ ...BLANK, ...row })}>Edit</button>
                      <button className="btn btn-ghost btn-small" onClick={() => remove(row)}>Remove</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <PartyForm
          kind={kind}
          noun={config.noun}
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={(row) => {
            setEditing(null);
            notify(`${row.name} saved`);
            load();
          }}
        />
      )}
    </>
  );
}

function PartyForm({ kind, noun, initial, onClose, onSaved }) {
  const { notify } = useApp();
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      onSaved(await call(`${kind}.save`, form));
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={form.id ? `Edit ${noun}` : `New ${noun}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" form="party-form" disabled={busy}>Save</button>
        </>
      }
    >
      <form id="party-form" className="form-grid" onSubmit={submit}>
        <Field label="Name" wide>
          <input value={form.name} onChange={set('name')} required autoFocus />
        </Field>
        <Field label="Phone">
          <input value={form.phone ?? ''} onChange={set('phone')} />
        </Field>
        <Field label="Email">
          <input type="email" value={form.email ?? ''} onChange={set('email')} />
        </Field>
        <Field label="Address" wide>
          <input value={form.address ?? ''} onChange={set('address')} />
        </Field>
        <Field label="Notes" wide>
          <textarea rows={3} value={form.notes ?? ''} onChange={set('notes')} />
        </Field>
      </form>
    </Modal>
  );
}
