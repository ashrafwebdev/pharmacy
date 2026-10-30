import { useEffect, useState } from 'react';
import { call, can } from '../lib/api';
import { useApp, useMoney } from '../lib/context';
import { fromPaise, toPaise, GST_RATES, SCHEDULES } from '../lib/format';
import { Empty, Field, Modal, PageHeader } from '../components/ui';

const BLANK = {
  id: null,
  sku: '',
  name: '',
  genericName: '',
  category: '',
  manufacturer: '',
  hsnCode: '',
  gstRate: 12,
  schedule: 'OTC',
  mrp: '',
  reorderLevel: '10',
};

export default function Products() {
  const { user, notify } = useApp();
  const money = useMoney();
  const canWrite = can(user, 'catalog.write');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null);

  const load = () =>
    call('products.list', { search, limit: 500 }).then(setRows).catch((e) => notify(e.message, 'error'));

  useEffect(() => {
    const timer = setTimeout(load, 200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  async function remove(product) {
    if (!window.confirm(`Remove ${product.name} from the product list?`)) return;
    try {
      await call('products.remove', { id: product.id });
      notify(`${product.name} removed`);
      load();
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  return (
    <>
      <PageHeader
        title="Products"
        subtitle="Medicines and other items, with MRP, GST and drug schedule"
        actions={canWrite && <button className="btn btn-primary" onClick={() => setEditing(BLANK)}>New product</button>}
      />
      <div className="toolbar">
        <input
          className="search-input"
          placeholder="Search by name, generic name, barcode or company"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {rows.length === 0 ? (
        <Empty>No products match. {canWrite && 'Add your first product to start selling.'}</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Barcode</th>
                <th>Product</th>
                <th>Generic / category</th>
                <th>HSN</th>
                <th className="num">MRP</th>
                <th className="num">GST</th>
                <th>Schedule</th>
                <th className="num">In stock</th>
                {canWrite && <th />}
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="mono">{p.sku || '—'}</td>
                  <td>
                    <strong>{p.name}</strong>
                    {p.manufacturer && <div className="muted small">{p.manufacturer}</div>}
                  </td>
                  <td>{p.genericName || p.category || '—'}</td>
                  <td className="mono">{p.hsnCode || '—'}</td>
                  <td className="num">{money(p.mrp)}</td>
                  <td className="num">{p.gstRate}%</td>
                  <td>{p.schedule === 'OTC' ? '—' : <span className="tag">{p.schedule}</span>}</td>
                  <td className={`num${p.onHand <= p.reorderLevel && p.reorderLevel > 0 ? ' error' : ''}`}>{p.onHand}</td>
                  {canWrite && (
                    <td className="row-actions">
                      <button className="btn btn-ghost btn-small" onClick={() => setEditing(toForm(p))}>Edit</button>
                      <button className="btn btn-ghost btn-small" onClick={() => remove(p)}>Remove</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <ProductForm
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={(p) => {
            setEditing(null);
            notify(`${p.name} saved`);
            load();
          }}
        />
      )}
    </>
  );
}

function toForm(p) {
  return {
    id: p.id,
    sku: p.sku ?? '',
    name: p.name,
    genericName: p.genericName ?? '',
    category: p.category ?? '',
    manufacturer: p.manufacturer ?? '',
    hsnCode: p.hsnCode ?? '',
    gstRate: p.gstRate,
    schedule: p.schedule,
    mrp: fromPaise(p.mrp),
    reorderLevel: String(p.reorderLevel),
  };
}

function ProductForm({ initial, onClose, onSaved }) {
  const { notify } = useApp();
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    const mrp = toPaise(form.mrp);
    const reorderLevel = Number(form.reorderLevel || 0);
    if (Number.isNaN(mrp) || mrp <= 0) return notify('Enter a valid MRP', 'error');
    if (!Number.isInteger(reorderLevel) || reorderLevel < 0) return notify('Reorder level must be 0 or more', 'error');

    setBusy(true);
    try {
      const saved = await call('products.save', {
        ...form,
        gstRate: Number(form.gstRate),
        mrp,
        reorderLevel,
      });
      onSaved(saved);
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={form.id ? 'Edit product' : 'New product'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" form="product-form" disabled={busy}>Save product</button>
        </>
      }
    >
      <form id="product-form" className="form-grid" onSubmit={submit}>
        <Field label="Product name" wide>
          <input value={form.name} onChange={set('name')} required autoFocus />
        </Field>
        <Field label="Barcode / SKU">
          <input value={form.sku} onChange={set('sku')} />
        </Field>
        <Field label="Generic name">
          <input value={form.genericName} onChange={set('genericName')} />
        </Field>
        <Field label="Company / manufacturer">
          <input value={form.manufacturer} onChange={set('manufacturer')} />
        </Field>
        <Field label="Category">
          <input value={form.category} onChange={set('category')} placeholder="e.g. Analgesic" />
        </Field>
        <Field label="HSN code" hint="4, 6 or 8 digits, printed on the GST invoice">
          <input value={form.hsnCode} onChange={set('hsnCode')} inputMode="numeric" placeholder="3004" />
        </Field>
        <Field label="MRP (₹)" hint="Printed on the pack, GST included">
          <input value={form.mrp} onChange={set('mrp')} inputMode="decimal" required />
        </Field>
        <Field label="GST rate">
          <select value={form.gstRate} onChange={set('gstRate')}>
            {GST_RATES.map((rate) => <option key={rate} value={rate}>{rate}%</option>)}
          </select>
        </Field>
        <Field label="Drug schedule">
          <select value={form.schedule} onChange={set('schedule')}>
            {SCHEDULES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="Reorder level" hint="Alert when stock falls to this quantity">
          <input value={form.reorderLevel} onChange={set('reorderLevel')} inputMode="numeric" />
        </Field>
      </form>
    </Modal>
  );
}
