import { useMemo } from "react";
import { PieChart, Pie, Cell, Legend } from "recharts";
import { Download } from "lucide-react";
import { ChartCard, StyledTooltip, SectionHeading, CHART_COLORS } from "./chartKit";
import { currency, number, percent } from "../../lib/format";
import { downloadCsv } from "../../lib/csv";
import { deliveryBucket, isPrepaid, isCod } from "../../lib/analyticsUtils";

function paymentStats(list) {
  const orders = list.length;
  const revenue = Math.round(list.reduce((s, o) => s + Number(o.totalAmountPayable || 0), 0) * 100) / 100;
  const buckets = { delivered: 0, cancelled: 0, returned: 0, rto: 0, pending: 0, unknown: 0 };
  list.forEach((o) => (buckets[deliveryBucket(o)] += 1));
  const pct = (n) => (orders > 0 ? (n / orders) * 100 : 0);
  return {
    orders,
    revenue,
    delivered: buckets.delivered,
    deliveredRate: pct(buckets.delivered),
    cancelled: buckets.cancelled,
    cancelledRate: pct(buckets.cancelled),
    returnedRto: buckets.returned + buckets.rto,
    returnedRtoRate: pct(buckets.returned + buckets.rto),
    items: list,
  };
}

export default function PaymentSection({ orders, openOrdersList }) {
  const prepaid = useMemo(() => orders.filter(isPrepaid), [orders]);
  const cod = useMemo(() => orders.filter(isCod), [orders]);

  const prepaidStats = useMemo(() => paymentStats(prepaid), [prepaid]);
  const codStats = useMemo(() => paymentStats(cod), [cod]);

  const orderSplit = [
    { name: "Prepaid", value: prepaidStats.orders, items: prepaid },
    { name: "COD", value: codStats.orders, items: cod },
  ].filter((d) => d.value > 0);

  const revenueSplit = [
    { name: "Prepaid", value: prepaidStats.revenue, items: prepaid },
    { name: "COD", value: codStats.revenue, items: cod },
  ].filter((d) => d.value > 0);

  const openFor = (title, items) => openOrdersList({ title, subtitle: `${items.length} orders`, orders: items, exportFilename: "payment-analytics.csv" });

  const exportAll = () => {
    const rows = [
      ["Payment Type", "Orders", "Revenue", "Delivered", "Delivered %", "Cancelled", "Cancelled %", "Returned/RTO", "Returned/RTO %"],
      ["Prepaid", prepaidStats.orders, prepaidStats.revenue, prepaidStats.delivered, prepaidStats.deliveredRate.toFixed(1), prepaidStats.cancelled, prepaidStats.cancelledRate.toFixed(1), prepaidStats.returnedRto, prepaidStats.returnedRtoRate.toFixed(1)],
      ["COD", codStats.orders, codStats.revenue, codStats.delivered, codStats.deliveredRate.toFixed(1), codStats.cancelled, codStats.cancelledRate.toFixed(1), codStats.returnedRto, codStats.returnedRtoRate.toFixed(1)],
    ];
    downloadCsv("payment-analytics.csv", rows);
  };

  return (
    <div className="space-y-5 mb-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <SectionHeading title="Payment Analytics" subtitle="COD vs Prepaid performance across orders, revenue, and fulfillment" />
        <button className="btn btn-secondary btn-sm" onClick={exportAll}>
          <Download size={13} /> Export Payment Report
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ChartCard title="Order Split" tip="Order count by payment type." empty={orderSplit.length === 0}>
          <PieChart>
            <Pie data={orderSplit} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={95} paddingAngle={2} cursor="pointer" onClick={(d) => openFor(`${d.name} Orders`, d.items)} animationDuration={500}>
              {orderSplit.map((_, i) => (
                <Cell key={i} fill={[CHART_COLORS[0], CHART_COLORS[3]][i % 2]} />
              ))}
            </Pie>
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <StyledTooltip formatter={(v) => number(v)} />
          </PieChart>
        </ChartCard>

        <ChartCard title="Revenue Split" tip="Revenue by payment type." empty={revenueSplit.length === 0}>
          <PieChart>
            <Pie data={revenueSplit} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={95} paddingAngle={2} cursor="pointer" onClick={(d) => openFor(`${d.name} Revenue`, d.items)} animationDuration={500}>
              {revenueSplit.map((_, i) => (
                <Cell key={i} fill={[CHART_COLORS[0], CHART_COLORS[3]][i % 2]} />
              ))}
            </Pie>
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <StyledTooltip formatter={(v) => currency(v)} />
          </PieChart>
        </ChartCard>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100">
          <h3 className="font-display font-semibold text-sm text-slate-700">Fulfillment Performance by Payment Type</h3>
          <p className="text-[11px] text-slate-400 mt-0.5">Delivery success, cancellation, and return/RTO rates — click a row to see those orders.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Payment Type</th>
                <th>Orders</th>
                <th>Revenue</th>
                <th>Delivered</th>
                <th>Cancelled</th>
                <th>Returned / RTO</th>
              </tr>
            </thead>
            <tbody>
              {[
                { label: "Prepaid", s: prepaidStats, list: prepaid },
                { label: "COD", s: codStats, list: cod },
              ].map(({ label, s, list }) => (
                <tr key={label}>
                  <td className="font-medium text-slate-700">
                    <span className={`badge ${label === "PREPAID" || label === "Prepaid" ? "badge-blue" : "badge-amber"}`}>{label}</span>
                  </td>
                  <td>{number(s.orders)}</td>
                  <td>{currency(s.revenue)}</td>
                  <td>
                    <button type="button" className="text-emerald-600 hover:underline" onClick={() => openFor(`${label} — Delivered`, list.filter((o) => deliveryBucket(o) === "delivered"))}>
                      {number(s.delivered)} ({percent(s.deliveredRate)})
                    </button>
                  </td>
                  <td>
                    <button type="button" className="text-rose-600 hover:underline" onClick={() => openFor(`${label} — Cancelled`, list.filter((o) => deliveryBucket(o) === "cancelled"))}>
                      {number(s.cancelled)} ({percent(s.cancelledRate)})
                    </button>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="text-amber-600 hover:underline"
                      onClick={() => openFor(`${label} — Returned / RTO`, list.filter((o) => ["returned", "rto"].includes(deliveryBucket(o))))}
                    >
                      {number(s.returnedRto)} ({percent(s.returnedRtoRate)})
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
