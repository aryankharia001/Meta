import { useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { Download } from "lucide-react";
import { ChartCard, StyledTooltip, SectionHeading, Leaderboard, CHART_COLORS } from "./chartKit";
import { currency, number } from "../../lib/format";
import { downloadCsv } from "../../lib/csv";
import { groupBy, sortDesc } from "../../lib/analyticsUtils";

export default function GeoSection({ orders, openOrdersList }) {
  const [metric, setMetric] = useState("revenue"); // "revenue" | "orders"

  const byState = useMemo(() => sortDesc(groupBy(orders, (o) => o.state || "Unknown"), "revenue"), [orders]);
  const byCity = useMemo(
    () =>
      sortDesc(
        groupBy(orders, (o) => (o.city ? `${o.city}${o.state ? `, ${o.state}` : ""}` : "Unknown"), {
          labelFn: (o) => (o.city ? `${o.city}${o.state ? `, ${o.state}` : ""}` : "Unknown"),
        }),
        "revenue"
      ),
    [orders]
  );

  const topStates = byState.slice(0, 10);
  const topCities = byCity.slice(0, 12);

  const openForBucket = (row) => openOrdersList({ title: row.label, subtitle: `${row.orders} orders`, orders: row.items, exportFilename: `geo-${row.label}.csv` });

  const exportAll = () => {
    const rows = [
      ["Type", "Location", "Orders", "Revenue"],
      ...byState.map((r) => ["State", r.label, r.orders, r.revenue]),
      ...byCity.map((r) => ["City", r.label, r.orders, r.revenue]),
    ];
    downloadCsv("geographic-report.csv", rows);
  };

  return (
    <div className="space-y-5 mb-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <SectionHeading title="Geographic Analytics" subtitle={`${byState.length} states · ${byCity.length} cities in range`} />
        <button className="btn btn-secondary btn-sm" onClick={exportAll}>
          <Download size={13} /> Export Geographic Report
        </button>
      </div>

      <ChartCard
        title="Orders & Revenue by State"
        tip="Top 10 states. Click a bar to see its orders."
        height={320}
        empty={topStates.length === 0}
        actions={
          <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5">
            {[{ key: "revenue", label: "Revenue" }, { key: "orders", label: "Orders" }].map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setMetric(m.key)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  metric === m.key ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        }
      >
        <BarChart data={topStates} layout="vertical" margin={{ left: 24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 11, fill: "#94a3b8" }} tickFormatter={(v) => number(v)} />
          <YAxis type="category" dataKey="label" width={110} tick={{ fontSize: 10, fill: "#64748b" }} />
          <StyledTooltip formatter={(v) => (metric === "revenue" ? currency(v) : number(v))} />
          <Bar dataKey={metric} name={metric === "revenue" ? "Revenue" : "Orders"} fill={CHART_COLORS[0]} radius={[0, 6, 6, 0]} cursor="pointer" onClick={(d) => openForBucket(d)} animationDuration={500} />
        </BarChart>
      </ChartCard>

      <ChartCard title="Orders & Revenue by City" tip="Top 12 cities. Click a bar to see its orders." height={320} empty={topCities.length === 0}>
        <BarChart data={topCities}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#64748b" }} interval={0} angle={-25} textAnchor="end" height={70} />
          <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} tickFormatter={(v) => number(v)} />
          <StyledTooltip formatter={(v) => (metric === "revenue" ? currency(v) : number(v))} />
          <Bar dataKey={metric} name={metric === "revenue" ? "Revenue" : "Orders"} fill={CHART_COLORS[5]} radius={[6, 6, 0, 0]} cursor="pointer" onClick={(d) => openForBucket(d)} animationDuration={500} />
        </BarChart>
      </ChartCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Leaderboard
          title="Orders by State"
          columns={["State", "Orders", "Revenue"]}
          rows={byState.slice(0, 15)}
          renderRow={(r) => (
            <tr key={r.key} className="cursor-pointer" onClick={() => openForBucket(r)}>
              <td className="font-medium text-slate-700">{r.label}</td>
              <td>{number(r.orders)}</td>
              <td className="font-semibold text-slate-700">{currency(r.revenue)}</td>
            </tr>
          )}
        />
        <Leaderboard
          title="Orders by City"
          columns={["City", "Orders", "Revenue"]}
          rows={byCity.slice(0, 15)}
          renderRow={(r) => (
            <tr key={r.key} className="cursor-pointer" onClick={() => openForBucket(r)}>
              <td className="font-medium text-slate-700">{r.label}</td>
              <td>{number(r.orders)}</td>
              <td className="font-semibold text-slate-700">{currency(r.revenue)}</td>
            </tr>
          )}
        />
      </div>
    </div>
  );
}
