import { useEffect, useState } from 'react';
import { call, can } from '../lib/api';
import { useApp, useMoney } from '../lib/context';
import { PAYMENT_LABELS, daysAgo, formatDateTime, localDateString } from '../lib/format';
import { Empty, Field, Modal, PageHeader, Stat } from '../components/ui';
import Receipt from '../components/Receipt';

export default function Reports() {
  const { user, notify } = useApp();
  const money = useMoney();
  const [range, setRange] = useState({ from: daysAgo(29), to: localDateString() });
  const [summary, setSummary] = useState(null);
  const [daily, setDaily] = useState([]);
  const [top, setTop] = useState([]);
  const [sales, setSales] = useState([]);
  const [viewing, setViewing] = useState(null);
  const [voiding, setVoiding] = useState(null);

  const load = async () => {
    try {
      const [s, d, t, list] = await Promise.all([
        call('reports.summary', range),
        call('reports.dailySales', range),
        call('reports.topProducts', { ...range, limit: 10 }),
        call('sales.list', range),
      ]);
      setSummary(s);
      setDaily(d);
      setTop(t);
      setSales(list);
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function exportCsv() {
    try {
      const result = await call('reports.exportCsv', range);
      if (result.saved) notify(`Exported to ${result.path}`);
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  async function openSale(row) {
    try {
      setViewing(await call('sales.get', { id: row.id }));
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Sales performance and sales history"
        actions={can(user, 'data.export') && <button className="btn" onClick={exportCsv}>Export CSV</button>}
      />

      <div className="toolbar">
        <Field label="From">
          <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        </Field>
        <Field label="To">
          <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
        </Field>
        <button className="btn btn-primary" onClick={load}>Apply</button>
      </div>

      {summary && (
        <div className="stats">
          <Stat label="Sales" value={summary.count} />
          <Stat label="Revenue" value={money(summary.revenue)} />
          <Stat label="Average sale" value={money(summary.averageTicket)} />
          <Stat label="Discounts given" value={money(summary.discounts)} />
          <Stat label="Units sold" value={summary.unitsSold} />
        </div>
      )}

      <div className="grid-2">
        <section className="card">
          <h2>Daily sales</h2>
          {daily.length === 0 ? <Empty>No sales in this period.</Empty> : (
            <table>
              <thead><tr><th>Day</th><th className="num">Sales</th><th className="num">Revenue</th></tr></thead>
              <tbody>
                {daily.map((d) => (
                  <tr key={d.date}><td>{d.date}</td><td className="num">{d.count}</td><td className="num">{money(d.revenue)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="card">
          <h2>Top products</h2>
          {top.length === 0 ? <Empty>No product sales in this period.</Empty> : (
            <table>
              <thead><tr><th>Product</th><th className="num">Units</th><th className="num">Revenue</th></tr></thead>
              <tbody>
                {top.map((t) => (
                  <tr key={t.productId}><td>{t.productName}</td><td className="num">{t.qty}</td><td className="num">{money(t.revenue)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section className="card">
        <h2>Sales history</h2>
        {sales.length === 0 ? <Empty>No sales recorded for these dates.</Empty> : (
          <table>
            <thead>
              <tr>
                <th>Invoice</th><th>Date</th><th>Customer</th><th>Payment</th>
                <th className="num">Total</th><th>Status</th><th />
              </tr>
            </thead>
            <tbody>
              {sales.map((s) => (
                <tr key={s.id} className={s.status === 'voided' ? 'muted' : ''}>
                  <td className="mono">{s.invoiceNo}</td>
                  <td>{formatDateTime(s.createdAt)}</td>
                  <td>{s.customerName || 'Walk-in'}</td>
                  <td>{PAYMENT_LABELS[s.paymentMethod]}</td>
                  <td className="num">{money(s.total)}</td>
                  <td>{s.status === 'voided' ? 'Voided' : 'Completed'}</td>
                  <td className="row-actions">
                    <button className="btn btn-ghost btn-small" onClick={() => openSale(s)}>Receipt</button>
                    {s.status === 'completed' && can(user, 'sale.void') && (
                      <button className="btn btn-ghost btn-small" onClick={() => setVoiding(s)}>Void</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {viewing && (
        <Modal
          title={`Receipt ${viewing.invoiceNo}`}
          onClose={() => setViewing(null)}
          footer={<button className="btn btn-primary" onClick={() => window.print()}>Print</button>}
        >
          <Receipt sale={viewing} />
        </Modal>
      )}

      {voiding && (
        <VoidModal
          sale={voiding}
          onClose={() => setVoiding(null)}
          onDone={() => {
            setVoiding(null);
            notify('Sale voided and stock returned');
            load();
          }}
        />
      )}
    </>
  );
}

function VoidModal({ sale, onClose, onDone }) {
  const { notify } = useApp();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await call('sales.void', { id: sale.id, reason });
      onDone();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Void ${sale.invoiceNo}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-danger" form="void-form" disabled={busy}>Void sale</button>
        </>
      }
    >
      <p className="muted">The sold items go back into their batches. This cannot be undone.</p>
      <form id="void-form" className="form-stack" onSubmit={submit}>
        <Field label="Reason">
          <input value={reason} onChange={(e) => setReason(e.target.value)} required autoFocus />
        </Field>
      </form>
    </Modal>
  );
}
