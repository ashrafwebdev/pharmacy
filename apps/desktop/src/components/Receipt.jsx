import { PAYMENT_LABELS, formatDate, formatDateTime } from '../lib/format';
import { useApp, useMoney } from '../lib/context';

function Row({ label, value, strong }) {
  return (
    <div className={`total-row${strong ? ' strong' : ''}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

/** Groups line-level GST into the rate-wise summary printed under a tax invoice. */
function gstBreakdown(items) {
  const byRate = new Map();
  for (const item of items) {
    const row = byRate.get(item.gstRate) ?? { rate: item.gstRate, taxable: 0, cgst: 0, sgst: 0 };
    row.taxable += item.taxableValue;
    row.cgst += item.cgst;
    row.sgst += item.sgst;
    byRate.set(item.gstRate, row);
  }
  return [...byRate.values()].sort((a, b) => a.rate - b.rate);
}

/** Printable GST tax invoice. Only #receipt is shown when printing (see the @media print rules). */
export default function Receipt({ sale }) {
  const { settings } = useApp();
  const money = useMoney();
  const breakdown = gstBreakdown(sale.items);
  const voided = sale.status === 'voided';

  return (
    <div id="receipt" className="receipt">
      <div className="receipt-head">
        <strong className="receipt-name">{settings?.pharmacyName}</strong>
        {settings?.address && <div>{settings.address}</div>}
        {settings?.phone && <div>Ph: {settings.phone}</div>}
        {settings?.gstin && <div>GSTIN: {settings.gstin}</div>}
        {settings?.drugLicence20 && <div>Drug Lic. (Form 20): {settings.drugLicence20}</div>}
        {settings?.drugLicence21 && <div>Drug Lic. (Form 21): {settings.drugLicence21}</div>}
        <div className="receipt-title">{voided ? 'VOIDED TAX INVOICE' : 'TAX INVOICE'}</div>
      </div>

      <div className="receipt-meta">
        <div><span>Invoice</span><strong>{sale.invoiceNo}</strong></div>
        <div><span>Date</span><span>{formatDateTime(sale.createdAt)}</span></div>
        <div><span>Cashier</span><span>{sale.cashierName}</span></div>
        <div><span>Customer</span><span>{sale.customerName || 'Walk-in'}</span></div>
        {sale.customerGstin && <div><span>Customer GSTIN</span><span>{sale.customerGstin}</span></div>}
      </div>

      <table className="receipt-items">
        <thead>
          <tr>
            <th>Item</th>
            <th>HSN</th>
            <th className="num">Qty</th>
            <th className="num">Rate</th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {sale.items.map((item) => (
            <tr key={item.id}>
              <td>
                {item.productName}
                {item.schedule !== 'OTC' && <span className="tag">{item.schedule}</span>}
                <div className="muted small">GST {item.gstRate}%</div>
              </td>
              <td className="mono">{item.hsnCode || '—'}</td>
              <td className="num">{item.qty}</td>
              <td className="num">{money(item.mrp)}</td>
              <td className="num">{money(item.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="totals">
        <Row label="MRP value (incl. GST)" value={money(sale.subtotal)} />
        {sale.discount > 0 && <Row label="Discount" value={`- ${money(sale.discount)}`} />}
        {sale.roundOff !== 0 && <Row label="Round off" value={money(sale.roundOff)} />}
        <Row label="Total payable" value={money(sale.total)} strong />
        <Row label={`Paid (${PAYMENT_LABELS[sale.paymentMethod]})`} value={sale.paymentMethod === 'credit' ? 'On credit' : money(sale.amountPaid)} />
        {sale.changeGiven > 0 && <Row label="Change returned" value={money(sale.changeGiven)} />}
      </div>

      <p className="words">{sale.totalInWords}</p>

      <table className="gst-table">
        <thead>
          <tr>
            <th>GST rate</th>
            <th className="num">Taxable</th>
            <th className="num">CGST</th>
            <th className="num">SGST</th>
          </tr>
        </thead>
        <tbody>
          {breakdown.map((row) => (
            <tr key={row.rate}>
              <td>{row.rate}%</td>
              <td className="num">{money(row.taxable)}</td>
              <td className="num">{money(row.cgst)}</td>
              <td className="num">{money(row.sgst)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {sale.prescription && (
        <div className="rx-block">
          <strong>Prescription</strong>
          <div>Patient: {sale.prescription.patientName}</div>
          {sale.prescription.patientAddress && <div>Address: {sale.prescription.patientAddress}</div>}
          <div>
            Doctor: {sale.prescription.doctorName}
            {sale.prescription.doctorRegNo && ` (Reg. ${sale.prescription.doctorRegNo})`}
          </div>
          <div>
            Rx no. {sale.prescription.prescriptionNo || '—'} dated {formatDate(sale.prescription.prescriptionDate)}
          </div>
        </div>
      )}

      {settings?.pharmacistName && (
        <div className="receipt-sign">
          Pharmacist: {settings.pharmacistName}
          {settings.pharmacistRegNo && ` (Reg. ${settings.pharmacistRegNo})`}
        </div>
      )}
      <p className="receipt-foot">{settings?.receiptFooter}</p>
    </div>
  );
}
