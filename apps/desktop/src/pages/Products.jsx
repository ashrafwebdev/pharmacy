import { useEffect, useState } from 'react';
import { call, can } from '../lib/api';
import { useApp, useMoney } from '../lib/context';
import { fromCents, toCents } from '../lib/format';
import { Empty, Field, Modal, PageHeader } from '../components/ui';

const BLANK = {
  id: null,
  sku: '',
  name: '',
  genericName: '',
  category: '',
  manufacturer: '',
  unitPrice: '',
  costPrice: '',
  reorderLevel: '10',
  requiresPrescription: false,
};

export default function Products() {
  const { user, notify } = useApp();
  const money = useMoney();
  const canWrite = can(user, 'catalog.write');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null);

  const load = () => call('products.list', { search, limit: 500 }).then(setRows).catch((e) => notify(e.message, 'error'));

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
        subtitle="Medicines and other items sold at the counter"
        actions={canWrite && <button className="btn btn-primary" onClick={() => setEditing(BLANK)}>New product</button>}
      />
      <div className="toolbar">
        <input
          className="search-input"
          placeholder="Search by name, generic, barcode or maker"
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
                <th className="num">Price</th>
                <th className="num">Cost</th>
                <th className="num">In stock</th>
                <th>Rx</th>
                {canWrite && <th />}
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="mono">{p.sku || '—'}</td>
                  <td><strong>{p.name}</strong>{p.manufacturer && <div className="muted small">{p.manufacturer}</div>}</td>
                  <td>{p.genericName || p.category || '—'}</td>
                  <td className="num">{money(p.unitPrice)}</td>
                  <td className="num">{money(p.costPrice)}</td>
                  <td className={`num${p.onHand <= p.reorderLevel && p.reorderLevel > 0 ? ' error' : ''}`}>{p.onHand}</td>
                  <td>{p.requiresPrescription ? <span className="tag">Rx</span> : ''}</td>
                  {canWrite && (
                    <td className="row-actions">
                      <button className="btn btn-ghost btn-small" onClick={() => setEditing(toForm(p))}>Edit</button>
                      {can(user, 'catalog.write') && (
                        <button className="btn btn-ghost btn-small" onClick={() => remove(p)}>Remove</button>
                      )}
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
    unitPrice: fromCents(p.unitPrice),
    costPrice: fromCents(p.costPrice),
    reorderLevel: String(p.reorderLevel),
    requiresPrescription: p.requiresPrescription,
  };
}

function ProductForm({ initial, onClose, onSaved }) {
  const { notify } = useApp();
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function submit(e) {
    e.preventDefault();
    const unitPrice = toCents(form.unitPrice);
    const costPrice = form.costPrice.trim() ? toCents(form.costPrice) : 0;
    const reorderLevel = Number(form.reorderLevel || 0);
    if (Number.isNaN(unitPrice) || Number.isNaN(costPrice)) return notify('Enter valid prices', 'error');
    if (!Number.isInteger(reorderLevel) || reorderLevel < 0) return notify('Reorder level must be 0 or more', 'error');

    setBusy(true);
    try {
      const saved = await call('products.save', {
        ...form,
        unitPrice,
        costPrice,
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
        <Field label="Category">
          <input value={form.category} onChange={set('category')} placeholder="e.g. Analgesic" />
        </Field>
        <Field label="Manufacturer">
          <input value={form.manufacturer} onChange={set('manufacturer')} />
        </Field>
        <Field label="Selling price">
          <input value={form.unitPrice} onChange={set('unitPrice')} inputMode="decimal" required />
        </Field>
        <Field label="Cost price">
          <input value={form.costPrice} onChange={set('costPrice')} inputMode="decimal" />
        </Field>
        <Field label="Reorder level" hint="Alert when stock falls to this quantity">
          <input value={form.reorderLevel} onChange={set('reorderLevel')} inputMode="numeric" />
        </Field>
        <label className="check wide">
          <input type="checkbox" checked={form.requiresPrescription} onChange={set('requiresPrescription')} />
          Prescription only (requires verification at sale)
        </label>
      </form>
    </Modal>
  );
}
