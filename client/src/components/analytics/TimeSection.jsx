import { useMemo, useState } from "react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid } from "recharts";
import { TrendingUp, TrendingDown, Minus, Download } from "lucide-react";
import { ChartCard, StyledTooltip, SectionHeading, CHART_COLORS } from "./chartKit";
import { currency, number } from "../../lib/format";
import { groupBy, dayKey, hourOfDay, isoWeekKey, monthKey, sortDesc } from "../../lib/analyticsUtils";
import { downloadCsv } from "../../lib/csv";

const HOUR_LABEL = (h) => `${String(h).padStart(2, "0")}:00`;

export default function TimeSection({ orders, openOrdersList }) {
  const [dailyMetric, setDailyMetric] = useState("revenue"); // "revenue" | "orders"

  const byHour = useMemo(() => {
    const buckets = Array.from({ length: 24 }, (_, h) => ({ hour: h, name: HOUR_LABEL(h), orders: 0, revenue: 0, items: [] }));
    orders.forEach((o) => {
      const h = hourOfDay(o);
      if (h === null) return;
      buckets[h].orders += 1;
      buckets[h].revenue += Number(o.totalAmountPayable || 0);
      buckets[h].items.push(o);
    });
    return buckets.map((b) => ({ ...b, revenue: Math.round(b.revenue * 100) / 100 }));
  }, [orders]);

  const byDay = useMemo(() => {
    const rows = groupBy(orders, dayKey);
    return sortDesc(rows, "key").reverse().map((r) => ({ ...r, name: r.key }));
  }, [orders]);

  const byWeek = useMemo(() => {
    const rows = groupBy(orders, (o) => isoWeekKey(o.orderDate), { labelFn: (o) => isoWeekKey(o.orderDate) });
    return sortDesc(rows, "key").reverse();
  }, [orders]);

  const byMonth = useMemo(() => {
    const rows = groupBy(orders, (o) => monthKey(o.orderDate), { labelFn: (o) => monthKey(o.orderDate) });
    return sortDesc(rows, "key").reverse();
  }, [orders]);

  const weekComparison = useMemo(() => {
    if (byWeek.length < 2) return null;
    const current = byWeek[byWeek.length - 1];
    const prev = byWeek[byWeek.length - 2];
    const revenueDelta = prev.revenue > 0 ? ((current.revenue - prev.revenue) / prev.revenue) * 100 : null;
    const ordersDelta = prev.orders > 0 ? ((current.orders - prev.orders) / prev.orders) * 100 : null;
    return { current, prev, revenueDelta, ordersDelta };
  }, [byWeek]);

  const monthComparison = useMemo(() => {
    if (byMonth.length < 2) return null;
    const current = byMonth[byMonth.length - 1];
    const prev = byMonth[byMonth.length - 2];
    const revenueDelta = prev.revenue > 0 ? ((current.revenue - prev.revenue) / prev.revenue) * 100 : null;
    const ordersDelta = prev.orders > 0 ? ((current.orders - prev.orders) / prev.orders) * 100 : null;
    return { current, prev, revenueDelta, ordersDelta };
  }, [byMonth]);

  const openForBucket = (label, items, exportFilename) =>
    openOrdersList({ title: label, subtitle: `${items.length} orders`, orders: items, exportFilename });

  const exportAll = () => {
    const rows = [
      ["Granularity", "Bucket", "Orders", "Revenue"],
      ...byHour.map((r) => ["Hour", r.name, r.orders, r.revenue]),
      ...byDay.map((r) => ["Day", r.name, r.orders, r.revenue]),
      ...byWeek.map((r) => ["Week", r.label, r.orders, r.revenue]),
      ...byMonth.map((r) => ["Month", r.label, r.orders, r.revenue]),
    ];
    downloadCsv("time-based-analytics.csv", rows);
  };

  return (
    <div className="space-y-5 mb-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <SectionHeading title="Time-Based Analytics" subtitle="Orders and revenue trends across hours, days, weeks, and months" />
        <button className="btn btn-secondary btn-sm" onClick={exportAll}>
          <Download size={13} /> Export Time Report
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ComparisonCard title="Week-over-Week" comparison={weekComparison} unitLabel="week" onOpen={openForBucket} />
        <ComparisonCard title="Month-over-Month" comparison={monthComparison} unitLabel="month" onOpen={openForBucket} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ChartCard title="Orders by Hour" tip="Order volume by hour of day (IST), summed across the whole selected range." empty={byHour.every((b) => b.orders === 0)}>
          <BarChart data={byHour}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#94a3b8" }} interval={2} />
            <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} tickFormatter={(v) => number(v)} />
            <StyledTooltip formatter={(v) => number(v)} />
            <Bar dataKey="orders" name="Orders" fill={CHART_COLORS[1]} radius={[6, 6, 0, 0]} cursor="pointer" onClick={(d) => openForBucket(`Orders — ${d.name}`, d.items, "orders-by-hour.csv")} animationDuration={500} />
          </BarChart>
        </ChartCard>

        <ChartCard title="Revenue by Hour" tip="Revenue by hour of day (IST), summed across the whole selected range." empty={byHour.every((b) => b.revenue === 0)}>
          <BarChart data={byHour}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#94a3b8" }} interval={2} />
            <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} tickFormatter={(v) => number(v)} />
            <StyledTooltip formatter={(v) => currency(v)} />
            <Bar dataKey="revenue" name="Revenue" fill={CHART_COLORS[0]} radius={[6, 6, 0, 0]} cursor="pointer" onClick={(d) => openForBucket(`Revenue — ${d.name}`, d.items, "revenue-by-hour.csv")} animationDuration={500} />
          </BarChart>
        </ChartCard>
      </div>

      <ChartCard
        title="Orders & Revenue by Day"
        tip="Daily trend across the selected range. Toggle between order count and revenue."
        height={300}
        empty={byDay.length === 0}
        actions={
          <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5">
            {[
              { key: "revenue", label: "Revenue" },
              { key: "orders", label: "Orders" },
            ].map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setDailyMetric(m.key)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  dailyMetric === m.key ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        }
      >
        <LineChart data={byDay}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#94a3b8" }} />
          <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} tickFormatter={(v) => number(v)} />
          <StyledTooltip formatter={(v) => (dailyMetric === "revenue" ? currency(v) : number(v))} />
          <Line
            type="monotone"
            dataKey={dailyMetric}
            name={dailyMetric === "revenue" ? "Revenue" : "Orders"}
            stroke={CHART_COLORS[dailyMetric === "revenue" ? 0 : 1]}
            strokeWidth={2}
            dot={{ r: 3, cursor: "pointer" }}
            activeDot={{ r: 5, onClick: (_, p) => openForBucket(`${dailyMetric === "revenue" ? "Revenue" : "Orders"} — ${p.payload.name}`, p.payload.items, "daily-trend.csv") }}
            animationDuration={500}
          />
        </LineChart>
      </ChartCard>
    </div>
  );
}

function ComparisonCard({ title, comparison, unitLabel, onOpen }) {
  if (!comparison) {
    return (
      <div className="card flex items-center justify-center text-center py-10 text-sm text-slate-400">
        Need at least two {unitLabel}s of data in range for a {title.toLowerCase()} comparison.
      </div>
    );
  }
  const { current, prev, revenueDelta, ordersDelta } = comparison;
  return (
    <div className="card">
      <h3 className="font-display font-semibold text-sm text-slate-700 mb-4">{title}</h3>
      <div className="grid grid-cols-2 gap-4">
        <DeltaStat label="Revenue" current={currency(current.revenue)} prevLabel={`vs ${currency(prev.revenue)}`} delta={revenueDelta} />
        <DeltaStat label="Orders" current={number(current.orders)} prevLabel={`vs ${number(prev.orders)}`} delta={ordersDelta} />
      </div>
      <button
        type="button"
        className="text-xs text-blue-600 hover:underline mt-4"
        onClick={() => onOpen(`${title} — Current ${unitLabel}`, current.items, `${unitLabel}-comparison.csv`)}
      >
        View current {unitLabel}'s orders →
      </button>
    </div>
  );
}

function DeltaStat({ label, current, prevLabel, delta }) {
  const Icon = delta === null ? Minus : delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  const cls = delta === null ? "text-slate-400" : delta > 0 ? "text-emerald-600" : delta < 0 ? "text-rose-600" : "text-slate-400";
  return (
    <div>
      <div className="text-[11px] text-slate-400 mb-0.5">{label}</div>
      <div className="text-xl font-bold text-slate-800">{current}</div>
      <div className={`text-xs flex items-center gap-1 mt-0.5 ${cls}`}>
        <Icon size={12} />
        {delta === null ? "N/A" : `${delta > 0 ? "+" : ""}${delta.toFixed(1)}%`}
        <span className="text-slate-400">{prevLabel}</span>
      </div>
    </div>
  );
}
