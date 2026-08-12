import { useMemo, useState } from "react";
import { AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Legend } from "recharts";
import { Download } from "lucide-react";
import { ChartCard, StyledTooltip, SectionHeading, CHART_COLORS } from "./chartKit";
import { currency, number } from "../../lib/format";
import { groupBy, dayKey, isoWeekKey, monthKey, isPrepaid, isCod, sortDesc } from "../../lib/analyticsUtils";
import { downloadCsv } from "../../lib/csv";
import { useCampaignDrawer } from "../../lib/CampaignDrawerContext";

const GRANULARITIES = [
  { key: "day", label: "Daily" },
  { key: "week", label: "Weekly" },
  { key: "month", label: "Monthly" },
];

export default function RevenueSection({ orders, tokenId, since, until, openOrdersList }) {
  const { openCampaign } = useCampaignDrawer();
  const [granularity, setGranularity] = useState("day");

  const totalRevenue = useMemo(() => orders.reduce((s, o) => s + Number(o.totalAmountPayable || 0), 0), [orders]);

  const overTime = useMemo(() => {
    const keyFn = granularity === "day" ? dayKey : granularity === "week" ? (o) => isoWeekKey(o.orderDate) : (o) => monthKey(o.orderDate);
    const rows = groupBy(orders, keyFn);
    return sortDesc(rows, "key").reverse().map((r) => ({ ...r, name: r.key }));
  }, [orders, granularity]);

  const byCampaign = useMemo(() => {
    const rows = groupBy(
      orders,
      (o) => o.campaignName || "No Campaign",
      { labelFn: (o) => o.campaignName || "No Campaign" }
    ).map((r) => ({
      ...r,
      campaignId: r.items.find((o) => o.campaignId)?.campaignId || null,
      campaignName: r.items.find((o) => o.campaignName)?.campaignName || null,
    }));
    return sortDesc(rows, "revenue").slice(0, 10);
  }, [orders]);

  const byPaymentType = useMemo(() => {
    const prepaid = orders.filter(isPrepaid);
    const cod = orders.filter(isCod);
    return [
      { name: "Prepaid", value: Math.round(prepaid.reduce((s, o) => s + Number(o.totalAmountPayable || 0), 0) * 100) / 100, items: prepaid },
      { name: "COD", value: Math.round(cod.reduce((s, o) => s + Number(o.totalAmountPayable || 0), 0) * 100) / 100, items: cod },
    ].filter((r) => r.items.length > 0);
  }, [orders]);

  const byProduct = useMemo(() => {
    const map = new Map();
    orders.forEach((o) => {
      (o.products || []).forEach((p) => {
        const key = p.name || "Unknown product";
        if (!map.has(key)) map.set(key, { key, revenue: 0, orders: new Set() });
        const bucket = map.get(key);
        bucket.revenue += Number(p.total ?? (p.price || 0) * (p.quantity || 1) ?? 0);
        bucket.orders.add(o.orderId);
      });
    });
    return sortDesc(
      [...map.values()].map((b) => ({ name: b.key, revenue: Math.round(b.revenue * 100) / 100, orders: b.orders.size })),
      "revenue"
    ).slice(0, 10);
  }, [orders]);

  const byState = useMemo(() => sortDesc(groupBy(orders, (o) => o.state || "Unknown"), "revenue").slice(0, 10), [orders]);
  const byCity = useMemo(() => sortDesc(groupBy(orders, (o) => o.city || "Unknown"), "revenue").slice(0, 10), [orders]);

  const handleCampaignClick = (row) => {
    if (!row.campaignId || !row.campaignName) return;
    openCampaign({ tokenId, campaignId: row.campaignId, campaignName: row.campaignName, since, until });
  };

  const openForBucket = (title, items, exportFilename) =>
    openOrdersList({ title, subtitle: `${items.length} orders`, orders: items, exportFilename });

  const exportSummary = () => {
    const rows = [
      ["Section", "Label", "Orders", "Revenue"],
      ...byCampaign.map((r) => ["Revenue by Campaign", r.label, r.orders, r.revenue]),
      ...byState.map((r) => ["Revenue by State", r.label, r.orders, r.revenue]),
      ...byCity.map((r) => ["Revenue by City", r.label, r.orders, r.revenue]),
      ...byProduct.map((r) => ["Revenue by Product", r.name, r.orders, r.revenue]),
    ];
    downloadCsv("revenue-analytics.csv", rows);
  };

  return (
    <div className="space-y-5 mb-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <SectionHeading title="Revenue Analytics" subtitle={`${currency(totalRevenue)} total revenue in range`} />
        <button className="btn btn-secondary btn-sm" onClick={exportSummary}>
          <Download size={13} /> Export Summary
        </button>
      </div>

      <ChartCard
        title="Revenue Over Time"
        tip="Revenue grouped by day, week, or ISO calendar month for the selected range."
        height={300}
        empty={overTime.length === 0}
        actions={
          <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5">
            {GRANULARITIES.map((g) => (
              <button
                key={g.key}
                type="button"
                onClick={() => setGranularity(g.key)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  granularity === g.key ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
        }
      >
        <AreaChart data={overTime} onClick={(e) => e?.activePayload?.[0] && openForBucket(`Revenue — ${e.activePayload[0].payload.name}`, e.activePayload[0].payload.items, "revenue-over-time.csv")}>
          <defs>
            <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={CHART_COLORS[0]} stopOpacity={0.35} />
              <stop offset="95%" stopColor={CHART_COLORS[0]} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#94a3b8" }} />
          <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} tickFormatter={(v) => number(v)} />
          <StyledTooltip formatter={(v) => currency(v)} />
          <Area type="monotone" dataKey="revenue" name="Revenue" stroke={CHART_COLORS[0]} fill="url(#revGrad)" strokeWidth={2} cursor="pointer" animationDuration={500} />
        </AreaChart>
      </ChartCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ChartCard title="Revenue by Campaign" tip="Top 10 campaigns by Shiprocket-matched revenue. Click a bar to open the campaign." empty={byCampaign.length === 0}>
          <BarChart data={byCampaign} layout="vertical" margin={{ left: 24 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11, fill: "#94a3b8" }} tickFormatter={(v) => number(v)} />
            <YAxis type="category" dataKey="label" width={110} tick={{ fontSize: 10, fill: "#64748b" }} />
            <StyledTooltip formatter={(v) => currency(v)} />
            <Bar dataKey="revenue" name="Revenue" fill={CHART_COLORS[0]} radius={[0, 6, 6, 0]} cursor="pointer" onClick={(d) => handleCampaignClick(d)} animationDuration={500} />
          </BarChart>
        </ChartCard>

        <ChartCard title="Revenue by Payment Type" tip="COD vs Prepaid revenue split." empty={byPaymentType.length === 0}>
          <PieChart>
            <Pie
              data={byPaymentType}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={95}
              paddingAngle={2}
              cursor="pointer"
              onClick={(d) => openForBucket(`Revenue — ${d.name}`, d.items, "revenue-by-payment.csv")}
              animationDuration={500}
            >
              {byPaymentType.map((_, i) => (
                <Cell key={i} fill={[CHART_COLORS[2], CHART_COLORS[3]][i % 2]} />
              ))}
            </Pie>
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <StyledTooltip formatter={(v) => currency(v)} />
          </PieChart>
        </ChartCard>

        <ChartCard title="Revenue by Product" tip="Top 10 products by line-item revenue. Click a bar to see its orders." empty={byProduct.length === 0}>
          <BarChart data={byProduct} layout="vertical" margin={{ left: 24 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11, fill: "#94a3b8" }} tickFormatter={(v) => number(v)} />
            <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 10, fill: "#64748b" }} />
            <StyledTooltip formatter={(v) => currency(v)} />
            <Bar
              dataKey="revenue"
              name="Revenue"
              fill={CHART_COLORS[2]}
              radius={[0, 6, 6, 0]}
              cursor="pointer"
              onClick={(d) => openForBucket(`Revenue — ${d.name}`, orders.filter((o) => (o.products || []).some((p) => p.name === d.name)), "revenue-by-product.csv")}
              animationDuration={500}
            />
          </BarChart>
        </ChartCard>

        <ChartCard title="Revenue by State" tip="Top 10 states by revenue. Click a bar to see its orders." empty={byState.length === 0}>
          <BarChart data={byState} layout="vertical" margin={{ left: 24 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11, fill: "#94a3b8" }} tickFormatter={(v) => number(v)} />
            <YAxis type="category" dataKey="label" width={110} tick={{ fontSize: 10, fill: "#64748b" }} />
            <StyledTooltip formatter={(v) => currency(v)} />
            <Bar dataKey="revenue" name="Revenue" fill={CHART_COLORS[5]} radius={[0, 6, 6, 0]} cursor="pointer" onClick={(d) => openForBucket(`Revenue — ${d.label}`, d.items, "revenue-by-state.csv")} animationDuration={500} />
          </BarChart>
        </ChartCard>
      </div>

      <ChartCard title="Revenue by City" tip="Top 10 cities by revenue. Click a bar to see its orders." height={300} empty={byCity.length === 0}>
        <BarChart data={byCity}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#64748b" }} interval={0} angle={-20} textAnchor="end" height={60} />
          <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} tickFormatter={(v) => number(v)} />
          <StyledTooltip formatter={(v) => currency(v)} />
          <Bar dataKey="revenue" name="Revenue" fill={CHART_COLORS[6]} radius={[6, 6, 0, 0]} cursor="pointer" onClick={(d) => openForBucket(`Revenue — ${d.label}`, d.items, "revenue-by-city.csv")} animationDuration={500} />
        </BarChart>
      </ChartCard>
    </div>
  );
}
