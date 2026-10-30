import { useEffect, useState } from 'react';
import { call, can } from '../lib/api';
import { useApp, useMoney } from '../lib/context';
import { PAYMENT_LABELS, daysAgo, formatDate, formatDateTime, localDateString } from '../lib/format';
import { Empty, Field, Modal, PageHeader, Stat } from '../components/ui';
import Receipt from '../components/Receipt';

export default function Reports() {
  const { user, notify } = useApp();
  const money = useMoney();
  const [range, setRange] = useState({ from: daysAgo(29), to: localDateString() });
  const [summary, setSummary] = useState(null);
  const [daily, setDaily] = useState([]);
  const [top, setTop] = useState([]);
  const [gst, setGst] = useState([]);
  const [register, setRegister] = useState([]);
  const [sales, setSales] = useState([]);
  const [viewing, setViewing] = useState(null);
  const [voiding, setVoiding] = useState(null);

  const load = async () => {
    try {
      const [s, d, t, g, r, list] = await Promise.all([
        call('reports.summary', range),
        call('reports.dailySales', range),
        call('reports.topProducts', { ...range, limit: 10 }),
        call('reports.gstSummary', range),
        call('reports.scheduleRegister', range),
        call('sales.list', range),
      ]);
      setSummary(s);
      setDaily(d);
      setTop(t);
      setGst(g);
      setRegister(r);
      setSales(list);
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function exportCsv(kind) {
    try {
      const result = await call('reports.exportCsv', { ...range, kind });
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

  const gstTotals = gst.reduce(
    (acc, row) => ({
      taxable: acc.taxable + row.taxableValue,
      cgst: acc.cgst + row.cgst,
      sgst: acc.sgst + row.sgst,
      total: acc.total + row.total,
    }),
    { taxable: 0, cgst: 0, sgst: 0, total: 0 },
  );

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Sales, GST for your returns, and the Schedule H1 register"
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
          <Stat label="Bills" value={summary.count} />
          <Stat label="Sales (incl. GST)" value={money(summary.revenue)} />
          <Stat label="GST collected" value={money(summary.gstCollected)} />
          <Stat label="Average bill" value={money(summary.averageTicket)} />
          <Stat label="Discounts given" value={money(summary.discounts)} />
          <Stat label="Units sold" value={summary.unitsSold} />
        </div>
      )}

      <div className="grid-2">
        <section className="card">
          <h2>Daily sales</h2>
          {daily.length === 0 ? <Empty>No sales in this period.</Empty> : (
            <table>
              <thead><tr><th>Day</th><th className="num">Bills</th><th className="num">Sales</th></tr></thead>
              <tbody>
                {daily.map((d) => (
                  <tr key={d.date}>
                    <td>{formatDate(d.date)}</td>
                    <td className="num">{d.count}</td>
                    <td className="num">{money(d.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="card">
          <h2>Top products</h2>
          {top.length === 0 ? <Empty>No product sales in this period.</Empty> : (
            <table>
              <thead><tr><th>Product</th><th className="num">Units</th><th className="num">Sales</th></tr></thead>
              <tbody>
                {top.map((t) => (
                  <tr key={t.productId}>
                    <td>{t.productName}</td>
                    <td className="num">{t.qty}</td>
                    <td className="num">{money(t.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>GST summary (for GSTR-1 and GSTR-3B)</h2>
          <button className="btn btn-small" onClick={() => exportCsv('gst')}>Export CSV</button>
        </div>
        {gst.length === 0 ? <Empty>No taxable sales in this period.</Empty> : (
          <table>
            <thead>
              <tr><th>GST rate</th><th className="num">Taxable value</th><th className="num">CGST</th><th className="num">SGST</th><th className="num">Total incl. GST</th></tr>
            </thead>
            <tbody>
              {gst.map((row) => (
                <tr key={row.rate}>
                  <td>{row.rate}%</td>
                  <td className="num">{money(row.taxableValue)}</td>
                  <td className="num">{money(row.cgst)}</td>
                  <td className="num">{money(row.sgst)}</td>
                  <td className="num">{money(row.total)}</td>
                </tr>
              ))}
              <tr className="total-line">
                <td><strong>Total</strong></td>
                <td className="num"><strong>{money(gstTotals.taxable)}</strong></td>
                <td className="num"><strong>{money(gstTotals.cgst)}</strong></td>
                <td className="num"><strong>{money(gstTotals.sgst)}</strong></td>
                <td className="num"><strong>{money(gstTotals.total)}</strong></td>
              </tr>
            </tbody>
          </table>
        )}
        <p className="muted small">
          Round-off on bills is not included in the line totals above. Check the bill-level totals before filing.
        </p>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Schedule H / H1 / X register</h2>
          <button className="btn btn-small" onClick={() => exportCsv('register')}>Export CSV</button>
        </div>
        {register.length === 0 ? <Empty>No scheduled medicines sold in this period.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th><th>Invoice</th><th>Patient</th><th>Prescriber</th>
                  <th>Rx no.</th><th>Drug</th><th>Schedule</th><th className="num">Qty</th><th>Batch</th>
                </tr>
              </thead>
              <tbody>
                {register.map((r, index) => (
                  <tr key={`${r.invoiceNo}-${index}`}>
                    <td>{formatDate(r.createdAt)}</td>
                    <td className="mono">{r.invoiceNo}</td>
                    <td>{r.patientName}</td>
                    <td>{r.doctorName}{r.doctorRegNo && <div className="muted small">Reg. {r.doctorRegNo}</div>}</td>
                    <td>{r.prescriptionNo || '—'}</td>
                    <td>{r.productName}</td>
                    <td><span className="tag">{r.schedule}</span></td>
                    <td className="num">{r.qty}</td>
                    <td className="mono">{r.batchNo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Bills</h2>
          {can(user, 'data.export') && <button className="btn btn-small" onClick={() => exportCsv('sales')}>Export CSV</button>}
        </div>
        {sales.length === 0 ? <Empty>No bills recorded for these dates.</Empty> : (
          <div className="table-wrap">
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
                      <button className="btn btn-ghost btn-small" onClick={() => openSale(s)}>Invoice</button>
                      {s.status === 'completed' && can(user, 'sale.void') && (
                        <button className="btn btn-ghost btn-small" onClick={() => setVoiding(s)}>Void</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {viewing && (
        <Modal
          title={`Tax invoice ${viewing.invoiceNo}`}
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
            notify('Bill voided and stock returned');
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
          <button className="btn btn-danger" form="void-form" disabled={busy}>Void bill</button>
        </>
      }
    >
      <p className="muted">
        The items go back into their batches. The bill stays in the list marked as voided, so invoice
        numbers have no gaps. This cannot be undone.
      </p>
      <form id="void-form" className="form-stack" onSubmit={submit}>
        <Field label="Reason">
          <input value={reason} onChange={(e) => setReason(e.target.value)} required autoFocus />
        </Field>
      </form>
    </Modal>
  );
}
