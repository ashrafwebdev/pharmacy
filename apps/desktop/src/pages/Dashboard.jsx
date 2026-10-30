import { useEffect, useState } from 'react';
import { call } from '../lib/api';
import { useApp, useMoney } from '../lib/context';
import { formatDate } from '../lib/format';
import { Empty, PageHeader, Stat, StatusBadge } from '../components/ui';

export default function Dashboard() {
  const { user, navigate } = useApp();
  const money = useMoney();
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    call('dashboard.stats').then(setStats).catch((err) => setError(err.message));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!stats) return <p className="muted">Loading…</p>;

  const attention = stats.expiredBatches.length + stats.expiringBatches.length + stats.lowStock.length;

  return (
    <>
      <PageHeader
        title={`Welcome back, ${user.name.split(' ')[0]}`}
        subtitle={attention ? `${attention} item(s) need attention today` : 'Everything looks good today'}
      />

      <div className="stats">
        <Stat label="Sales today" value={stats.todaySalesCount} />
        <Stat label="Revenue today" value={money(stats.todayRevenue)} />
        <Stat label="Products" value={stats.productCount} />
        <Stat label="Low stock" value={stats.lowStock.length} tone={stats.lowStock.length ? 'warn' : null} />
        <Stat
          label="Expired batches"
          value={stats.expiredBatches.length}
          tone={stats.expiredBatches.length ? 'danger' : null}
        />
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <h2>Low stock</h2>
            <button className="btn btn-ghost btn-small" onClick={() => navigate('products')}>Products</button>
          </div>
          {stats.lowStock.length === 0 ? (
            <Empty>Nothing below its reorder level.</Empty>
          ) : (
            <table>
              <thead><tr><th>Product</th><th className="num">On hand</th><th className="num">Reorder at</th></tr></thead>
              <tbody>
                {stats.lowStock.map((item) => (
                  <tr key={item.id}>
                    <td>{item.name}</td>
                    <td className="num">{item.onHand}</td>
                    <td className="num">{item.reorderLevel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Expiry watch</h2>
            <button className="btn btn-ghost btn-small" onClick={() => navigate('stock')}>Batches</button>
          </div>
          {stats.expiredBatches.length + stats.expiringBatches.length === 0 ? (
            <Empty>No batches expire within {stats.expiryWarningDays} days.</Empty>
          ) : (
            <table>
              <thead><tr><th>Product</th><th>Batch</th><th>Expiry</th><th className="num">Qty</th><th /></tr></thead>
              <tbody>
                {[...stats.expiredBatches, ...stats.expiringBatches].map((batch) => (
                  <tr key={batch.id}>
                    <td>{batch.productName}</td>
                    <td>{batch.batchNo}</td>
                    <td>{formatDate(batch.expiryDate)}</td>
                    <td className="num">{batch.onHand}</td>
                    <td><StatusBadge status={batch.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </>
  );
}
