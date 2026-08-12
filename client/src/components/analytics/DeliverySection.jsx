import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell } from "recharts";
import { Download, PackageCheck, Clock, Ban, RotateCcw, Undo2 } from "lucide-react";
import { ChartCard, StyledTooltip, SectionHeading } from "./chartKit";
import { number, percent } from "../../lib/format";
import { downloadCsv } from "../../lib/csv";
import { deliveryBucket } from "../../lib/analyticsUtils";

const BUCKET_DEFS = [
  { key: "delivered", label: "Delivered Orders", icon: PackageCheck, color: "#10b981", accent: "bg-emerald-50 text-emerald-600" },
  { key: "pending", label: "Pending Orders", icon: Clock, color: "#f59e0b", accent: "bg-amber-50 text-amber-600" },
  { key: "cancelled", label: "Cancelled Orders", icon: Ban, color: "#f43f5e", accent: "bg-rose-50 text-rose-600" },
  { key: "returned", label: "Returned Orders", icon: RotateCcw, color: "#94a3b8", accent: "bg-slate-100 text-slate-500" },
  { key: "rto", label: "RTO Orders", icon: Undo2, color: "#8b5cf6", accent: "bg-violet-50 text-violet-600" },
];

export default function DeliverySection({ orders, openOrdersList }) {
  const buckets = useMemo(() => {
    const map = { delivered: [], pending: [], cancelled: [], returned: [], rto: [], unknown: [] };
    orders.forEach((o) => map[deliveryBucket(o)].push(o));
    return map;
  }, [orders]);

  const total = orders.length;
  const rate = (n) => (total > 0 ? (n / total) * 100 : 0);

  const chartData = BUCKET_DEFS.map((b) => ({ name: b.label.replace(" Orders", ""), count: buckets[b.key].length, color: b.color, items: buckets[b.key] }));

  const openFor = (label, items) => openOrdersList({ title: label, subtitle: `${items.length} orders`, orders: items, exportFilename: `delivery-${label}.csv` });

  const exportAll = () => {
    const rows = [["Status", "Orders", "% of Total"], ...BUCKET_DEFS.map((b) => [b.label, buckets[b.key].length, rate(buckets[b.key].length).toFixed(1)])];
    if (buckets.unknown.length > 0) rows.push(["Unknown / Not Tracked", buckets.unknown.length, rate(buckets.unknown.length).toFixed(1)]);
    downloadCsv("delivery-analytics.csv", rows);
  };

  const noDeliveryData = total > 0 && buckets.unknown.length === total;

  return (
    <div className="space-y-5 mb-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <SectionHeading title="Delivery Analytics" subtitle="Fulfillment performance across the selected range" />
        <button className="btn btn-secondary btn-sm" onClick={exportAll}>
          <Download size={13} /> Export Delivery Report
        </button>
      </div>

      {noDeliveryData && (
        <div className="card bg-amber-50 border-amber-200 text-amber-700 text-sm">
          Delivery/shipment status isn't available on any order in this range yet — counts below will populate once Shiprocket
          returns that data.
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5">
        {BUCKET_DEFS.map((b) => (
          <button
            key={b.key}
            type="button"
            onClick={() => openFor(b.label, buckets[b.key])}
            className="text-left card !p-4 flex flex-col gap-3 hover:-translate-y-0.5 hover:border-slate-300"
          >
            <span className={`flex items-center justify-center w-9 h-9 rounded-xl ${b.accent}`}>
              <b.icon size={17} />
            </span>
            <div>
              <div className="text-[13px] text-slate-500 mb-0.5">{b.label}</div>
              <div className="text-xl font-display font-bold text-slate-800">{number(buckets[b.key].length)}</div>
            </div>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <RateCard label="Delivery Success Rate" value={rate(buckets.delivered.length)} cls="text-emerald-600" onClick={() => openFor("Delivered Orders", buckets.delivered)} />
        <RateCard label="Cancellation Percentage" value={rate(buckets.cancelled.length)} cls="text-rose-600" onClick={() => openFor("Cancelled Orders", buckets.cancelled)} />
        <RateCard
          label="Return Percentage"
          value={rate(buckets.returned.length)}
          cls="text-slate-600"
          onClick={() => openFor("Returned Orders", buckets.returned)}
        />
      </div>

      <ChartCard title="Orders by Delivery Status" tip="Click a bar to see those orders." height={300} empty={total === 0}>
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} />
          <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} tickFormatter={(v) => number(v)} allowDecimals={false} />
          <StyledTooltip formatter={(v) => number(v)} />
          <Bar dataKey="count" name="Orders" radius={[6, 6, 0, 0]} cursor="pointer" onClick={(d) => openFor(`${d.name} Orders`, d.items)} animationDuration={500}>
            {chartData.map((d, i) => (
              <Cell key={i} fill={d.color} />
            ))}
          </Bar>
        </BarChart>
      </ChartCard>
    </div>
  );
}

function RateCard({ label, value, cls, onClick }) {
  return (
    <button type="button" onClick={onClick} className="text-left card flex items-center justify-between hover:-translate-y-0.5 hover:border-slate-300">
      <div>
        <div className="text-[11px] text-slate-400 mb-1">{label}</div>
        <div className={`text-2xl font-bold ${cls}`}>{percent(value)}</div>
      </div>
    </button>
  );
}
