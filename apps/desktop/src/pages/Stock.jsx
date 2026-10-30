import { useEffect, useState } from 'react';
import { call, can } from '../lib/api';
import { useApp, useMoney } from '../lib/context';
import { formatDate, localDateString, toCents } from '../lib/format';
import { Empty, Field, Modal, PageHeader, StatusBadge } from '../components/ui';

export default function Stock() {
  const { user, notify } = useApp();
  const canWrite = can(user, 'stock.write');
  const [products, setProducts] = useState([]);
  const [batches, setBatches] = useState([]);
  const [filterProduct, setFilterProduct] = useState('');
  const [inStockOnly, setInStockOnly] = useState(true);
  const [adjusting, setAdjusting] = useState(null);

  const loadProducts = () => call('products.list', { limit: 1000 }).then(setProducts).catch(() => {});
  const loadBatches = () =>
    call('stock.batches', { productId: filterProduct || null, inStockOnly })
      .then(setBatches)
      .catch((e) => notify(e.message, 'error'));

  useEffect(() => {
    loadProducts();
  }, []);

  useEffect(() => {
    loadBatches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterProduct, inStockOnly]);

  async function writeOff(batch) {
    if (!window.confirm(`Write off ${batch.onHand} expired unit(s) from batch ${batch.batchNo}?`)) return;
    try {
      await call('stock.writeOffExpired', { batchId: batch.id });
      notify('Expired stock written off');
      loadBatches();
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  return (
    <>
      <PageHeader title="Stock & Batches" subtitle="Every unit is tracked by batch and expiry date" />

      {canWrite && <ReceiveForm products={products} onReceived={() => { notify('Stock received'); loadBatches(); }} />}

      <div className="toolbar">
        <select value={filterProduct} onChange={(e) => setFilterProduct(e.target.value)}>
          <option value="">All products</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <label className="check">
          <input type="checkbox" checked={inStockOnly} onChange={(e) => setInStockOnly(e.target.checked)} />
          In stock only
        </label>
      </div>

      {batches.length === 0 ? (
        <Empty>No batches to show. Receive stock to add one.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Batch</th>
                <th>Expiry</th>
                <th>Supplier</th>
                <th className="num">On hand</th>
                <th>Status</th>
                {canWrite && <th />}
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id}>
                  <td><strong>{b.productName}</strong>{b.productSku && <div className="muted small mono">{b.productSku}</div>}</td>
                  <td className="mono">{b.batchNo}</td>
                  <td>{formatDate(b.expiryDate)}</td>
                  <td>{b.supplierName || '—'}</td>
                  <td className="num">{b.onHand}</td>
                  <td><StatusBadge status={b.status} /></td>
                  {canWrite && (
                    <td className="row-actions">
                      {b.status === 'expired' && b.onHand > 0 ? (
                        <button className="btn btn-danger btn-small" onClick={() => writeOff(b)}>Write off</button>
                      ) : (
                        <button className="btn btn-ghost btn-small" onClick={() => setAdjusting(b)}>Adjust</button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adjusting && (
        <AdjustModal
          batch={adjusting}
          onClose={() => setAdjusting(null)}
          onDone={() => {
            setAdjusting(null);
            notify('Stock adjusted');
            loadBatches();
          }}
        />
      )}
    </>
  );
}

function ReceiveForm({ products, onReceived }) {
  const { notify } = useApp();
  const money = useMoney();
  const [suppliers, setSuppliers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    productId: '',
    supplierId: '',
    batchNo: '',
    expiryDate: '',
    qty: '',
    costPrice: '',
  });
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  useEffect(() => {
    call('suppliers.list', { search: '' }).then(setSuppliers).catch(() => {});
  }, []);

  async function submit(e) {
    e.preventDefault();
    const costPrice = form.costPrice.trim() ? toCents(form.costPrice) : 0;
    if (Number.isNaN(costPrice)) return notify('Enter a valid cost price', 'error');
    setBusy(true);
    try {
      await call('stock.receive', {
        productId: form.productId,
        supplierId: form.supplierId || null,
        batchNo: form.batchNo,
        expiryDate: form.expiryDate,
        qty: Number(form.qty),
        costPrice,
      });
      setForm({ ...form, batchNo: '', expiryDate: '', qty: '', costPrice: '' });
      onReceived();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const minExpiry = localDateString();
  return (
    <section className="card receive">
      <h2>Receive stock</h2>
      <form className="form-grid" onSubmit={submit}>
        <Field label="Product" wide>
          <select value={form.productId} onChange={set('productId')} required>
            <option value="">Choose a product…</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Supplier">
          <select value={form.supplierId} onChange={set('supplierId')}>
            <option value="">—</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Batch number">
          <input value={form.batchNo} onChange={set('batchNo')} required />
        </Field>
        <Field label="Expiry date">
          <input type="date" min={minExpiry} value={form.expiryDate} onChange={set('expiryDate')} required />
        </Field>
        <Field label="Quantity">
          <input type="number" min="1" value={form.qty} onChange={set('qty')} required />
        </Field>
        <Field label="Cost per unit">
          <input value={form.costPrice} onChange={set('costPrice')} inputMode="decimal" placeholder="0.00" />
        </Field>
        <div className="form-actions">
          <button className="btn btn-primary" disabled={busy || !form.productId}>Add batch</button>
          {form.costPrice && !Number.isNaN(toCents(form.costPrice)) && (
            <span className="muted small">Unit cost {money(toCents(form.costPrice))}</span>
          )}
        </div>
      </form>
    </section>
  );
}

function AdjustModal({ batch, onClose, onDone }) {
  const { notify } = useApp();
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await call('stock.adjust', { batchId: batch.id, qty: Number(qty), reason });
      onDone();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Adjust batch ${batch.batchNo}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" form="adjust-form" disabled={busy}>Save adjustment</button>
        </>
      }
    >
      <p className="muted">{batch.productName} · currently {batch.onHand} on hand</p>
      <form id="adjust-form" className="form-stack" onSubmit={submit}>
        <Field label="Change in quantity" hint="Use a negative number to remove stock, e.g. -2">
          <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} required />
        </Field>
        <Field label="Reason">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Damaged, counted differently, …" required />
        </Field>
      </form>
    </Modal>
  );
}
