import { useEffect, useRef, useState } from 'react';
import { call } from '../lib/api';
import { useApp, useMoney } from '../lib/context';
import { PAYMENT_LABELS, fromCents, toCents } from '../lib/format';
import { Modal } from '../components/ui';
import Receipt from '../components/Receipt';

const PAYMENTS = ['cash', 'card', 'mobile'];

export default function Pos() {
  const { notify } = useApp();
  const money = useMoney();
  const searchRef = useRef(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [cart, setCart] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [customerId, setCustomerId] = useState('');
  const [discount, setDiscount] = useState('');
  const [method, setMethod] = useState('cash');
  const [tendered, setTendered] = useState('');
  const [rxVerified, setRxVerified] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    call('customers.list', { search: '' }).then(setCustomers).catch(() => {});
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    const term = query.trim();
    if (!term) {
      setResults([]);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      call('products.list', { search: term, limit: 40 })
        .then((rows) => !cancelled && setResults(rows))
        .catch(() => !cancelled && setResults([]));
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const subtotal = cart.reduce((sum, line) => sum + line.unitPrice * line.qty, 0);
  const discountCents = discount.trim() ? toCents(discount) : 0;
  const validDiscount = !Number.isNaN(discountCents) && discountCents <= subtotal;
  const total = validDiscount ? subtotal - discountCents : subtotal;
  const tenderedCents = tendered.trim() ? toCents(tendered) : total;
  const change = method === 'cash' && !Number.isNaN(tenderedCents) ? tenderedCents - total : 0;
  const needsPrescription = cart.some((line) => line.requiresPrescription);

  function addLine(product) {
    if (product.onHand <= 0) {
      notify(`${product.name} is out of stock`, 'error');
      return;
    }
    const existing = cart.find((line) => line.productId === product.id);
    if (existing && existing.qty + 1 > product.onHand) {
      notify(`Only ${product.onHand} of ${product.name} in stock`, 'error');
      return;
    }
    if (existing) {
      setCart(cart.map((line) => (line.productId === product.id ? { ...line, qty: line.qty + 1 } : line)));
    } else {
      setCart([
        ...cart,
        {
          productId: product.id,
          name: product.name,
          sku: product.sku,
          unitPrice: product.unitPrice,
          requiresPrescription: product.requiresPrescription,
          onHand: product.onHand,
          qty: 1,
        },
      ]);
    }
    setQuery('');
    setResults([]);
    searchRef.current?.focus();
  }

  async function onSearchKey(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const term = query.trim();
    if (!term) return;
    // A scanned barcode matches exactly; otherwise take the top search result.
    const exact = await call('products.getBySku', { sku: term }).catch(() => null);
    const match = exact ?? results[0];
    if (match) addLine(match);
    else notify(`No product found for "${term}"`, 'error');
  }

  function setQty(productId, qty) {
    const line = cart.find((l) => l.productId === productId);
    const next = Math.floor(Number(qty));
    if (!Number.isFinite(next) || next < 1) return;
    if (line && next > line.onHand) {
      notify(`Only ${line.onHand} in stock`, 'error');
      return;
    }
    setCart(cart.map((l) => (l.productId === productId ? { ...l, qty: next } : l)));
  }

  function removeLine(productId) {
    setCart(cart.filter((l) => l.productId !== productId));
  }

  function reset() {
    setCart([]);
    setTendered('');
    setDiscount('');
    setCustomerId('');
    setRxVerified(false);
    setMethod('cash');
  }

  async function checkout() {
    if (cart.length === 0) return;
    if (!validDiscount) return notify('Discount is invalid or larger than the subtotal', 'error');
    if (Number.isNaN(tenderedCents)) return notify('Enter a valid amount tendered', 'error');
    if (needsPrescription && !rxVerified) return notify('Verify the prescription for prescription items', 'error');
    if (method === 'cash' && change < 0) return notify('Amount tendered is less than the total', 'error');

    setBusy(true);
    try {
      const sale = await call('sales.create', {
        items: cart.map((line) => ({ productId: line.productId, qty: line.qty })),
        customerId: customerId || null,
        discount: validDiscount ? discountCents : 0,
        paymentMethod: method,
        amountPaid: method === 'cash' ? tenderedCents : total,
        prescriptionVerified: needsPrescription ? rxVerified : false,
      });
      setReceipt(sale);
      reset();
      notify(`Sale ${sale.invoiceNo} completed`);
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
      searchRef.current?.focus();
    }
  }

  return (
    <div className="pos">
      <section className="pos-search">
        <div className="search-bar">
          <input
            ref={searchRef}
            className="search-input"
            placeholder="Scan barcode or type a medicine name, then press Enter"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKey}
            autoComplete="off"
          />
        </div>
        <div className="product-grid">
          {results.map((product) => (
            <button
              key={product.id}
              className="product-tile"
              onClick={() => addLine(product)}
              disabled={product.onHand <= 0}
            >
              <strong>{product.name}</strong>
              <span className="muted">{product.genericName || product.category || product.sku || '—'}</span>
              <div className="tile-foot">
                <span>{money(product.unitPrice)}</span>
                <span className={product.onHand > 0 ? 'muted' : 'error'}>
                  {product.onHand > 0 ? `${product.onHand} in stock` : 'Out of stock'}
                </span>
              </div>
              {product.requiresPrescription && <span className="tag">Rx</span>}
            </button>
          ))}
          {query.trim() && results.length === 0 && <p className="muted">No matching products.</p>}
          {!query.trim() && <p className="muted">Start typing to find medicines.</p>}
        </div>
      </section>

      <aside className="cart">
        <h2>Current sale</h2>
        {cart.length === 0 ? (
          <p className="muted cart-empty">The cart is empty.</p>
        ) : (
          <table className="cart-table">
            <tbody>
              {cart.map((line) => (
                <tr key={line.productId}>
                  <td>
                    <strong>{line.name}</strong>
                    <div className="muted small">
                      {money(line.unitPrice)} each{line.requiresPrescription ? ' · Rx' : ''}
                    </div>
                  </td>
                  <td className="num">
                    <input
                      className="qty"
                      type="number"
                      min="1"
                      value={line.qty}
                      onChange={(e) => setQty(line.productId, e.target.value)}
                      aria-label={`Quantity of ${line.name}`}
                    />
                  </td>
                  <td className="num">{money(line.unitPrice * line.qty)}</td>
                  <td>
                    <button className="icon-btn" onClick={() => removeLine(line.productId)} aria-label="Remove">×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <label className="field">
          <span>Customer (optional)</span>
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Walk-in customer</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ''}</option>
            ))}
          </select>
        </label>

        <div className="totals">
          <Row label="Subtotal" value={money(subtotal)} />
          <label className="total-row">
            <span>Discount</span>
            <input
              className="discount"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
              placeholder="0.00"
              inputMode="decimal"
            />
          </label>
          <Row label="Total" value={money(total)} strong />
        </div>

        <div className="pay-methods" role="radiogroup" aria-label="Payment method">
          {PAYMENTS.map((p) => (
            <button
              key={p}
              role="radio"
              aria-checked={method === p}
              className={`chip${method === p ? ' active' : ''}`}
              onClick={() => setMethod(p)}
            >
              {PAYMENT_LABELS[p]}
            </button>
          ))}
        </div>

        {method === 'cash' && (
          <>
            <label className="field">
              <span>Amount tendered</span>
              <input
                value={tendered}
                onChange={(e) => setTendered(e.target.value)}
                placeholder={fromCents(total)}
                inputMode="decimal"
              />
            </label>
            <Row label="Change" value={money(Math.max(change, 0))} />
          </>
        )}

        {needsPrescription && (
          <label className="check rx-check">
            <input type="checkbox" checked={rxVerified} onChange={(e) => setRxVerified(e.target.checked)} />
            I have verified the prescription for Rx items
          </label>
        )}

        <button
          className="btn btn-primary btn-block btn-lg"
          onClick={checkout}
          disabled={busy || cart.length === 0}
        >
          {busy ? 'Saving…' : `Complete sale · ${money(total)}`}
        </button>
        {cart.length > 0 && (
          <button className="btn btn-ghost btn-block" onClick={reset}>Clear sale</button>
        )}
      </aside>

      {receipt && (
        <Modal
          title={`Receipt ${receipt.invoiceNo}`}
          onClose={() => setReceipt(null)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setReceipt(null)}>Close</button>
              <button className="btn btn-primary" onClick={() => window.print()}>Print</button>
            </>
          }
        >
          <Receipt sale={receipt} />
        </Modal>
      )}
    </div>
  );
}

function Row({ label, value, strong }) {
  return (
    <div className={`total-row${strong ? ' strong' : ''}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
