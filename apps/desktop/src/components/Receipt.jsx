import { PAYMENT_LABELS, formatDateTime } from '../lib/format';
import { useApp, useMoney } from '../lib/context';

function Row({ label, value, strong }) {
  return (
    <div className={`total-row${strong ? ' strong' : ''}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

/** Printable receipt. Only #receipt is shown when printing (see the @media print rules). */
export default function Receipt({ sale }) {
  const { settings } = useApp();
  const money = useMoney();
  return (
    <div id="receipt" className="receipt">
      <div className="receipt-head">
        <strong>{settings?.pharmacyName}</strong>
        <div>Invoice {sale.invoiceNo}</div>
        <div>{formatDateTime(sale.createdAt)}</div>
        {sale.customerName && <div>Customer: {sale.customerName}</div>}
        {sale.status === 'voided' && <div className="error">VOIDED</div>}
      </div>
      <table>
        <tbody>
          {sale.items.map((item) => (
            <tr key={item.id}>
              <td>
                {item.productName}
                <div className="muted small">{item.qty} × {money(item.unitPrice)}</div>
              </td>
              <td className="num">{money(item.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="totals">
        <Row label="Subtotal" value={money(sale.subtotal)} />
        {sale.discount > 0 && <Row label="Discount" value={`- ${money(sale.discount)}`} />}
        <Row label="Total" value={money(sale.total)} strong />
        <Row label={PAYMENT_LABELS[sale.paymentMethod]} value={money(sale.amountPaid)} />
        {sale.changeGiven > 0 && <Row label="Change" value={money(sale.changeGiven)} />}
      </div>
      <p className="receipt-foot">{settings?.receiptFooter}</p>
    </div>
  );
}
