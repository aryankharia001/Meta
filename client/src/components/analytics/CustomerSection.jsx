import { useMemo } from "react";
import { AreaChart, Area, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Legend } from "recharts";
import { Download } from "lucide-react";
import { ChartCard, StyledTooltip, SectionHeading, Leaderboard, CHART_COLORS } from "./chartKit";
import { currency, number, percent } from "../../lib/format";
import { downloadCsv } from "../../lib/csv";
import { dayKey, sortDesc } from "../../lib/analyticsUtils";

// "New vs returning" and "growth trend" here are scoped to the
// currently selected date range (a customer is "returning" if they
// placed more than one order within the range) rather than compared
// against a customer's full lifetime history. Doing the latter
// accurately would mean an unindexed full-collection scan by phone for
// every customer in range on every filter change — exactly what this
// phase's own performance requirements ("avoid unnecessary
// recalculations", "remain performant with large datasets") say not to
// do, and it isn't information the existing schema indexes for. The
// Order Drawer's own "Repeat Customer" badge (Phase 4) still shows true
// all-time history per order, one at a time — this section is the
// aggregate view across the whole filtered range.
function useCustomerStats(orders) {
  return useMemo(() => {
    const map = new Map();
    orders.forEach((o) => {
      const key = o.phone || `__no-phone__${o.orderId}`;
      if (!map.has(key)) {
        map.set(key, { phone: o.phone || null, name: o.customerName || null, orders: [], firstDate: o.orderDate });
      }
      const bucket = map.get(key);
      bucket.orders.push(o);
      if (o.orderDate && (!bucket.firstDate || o.orderDate < bucket.firstDate)) bucket.firstDate = o.orderDate;
      if (!bucket.name && o.customerName) bucket.name = o.customerName;
    });

    const customers = [...map.values()].map((c) => ({
      ...c,
      orderCount: c.orders.length,
      revenue: Math.round(c.orders.reduce((s, o) => s + Number(o.totalAmountPayable || 0), 0) * 100) / 100,
    }));

    const newCustomers = customers.filter((c) => c.orderCount === 1);
    const returningCustomers = customers.filter((c) => c.orderCount > 1);
    const totalRevenue = customers.reduce((s, c) => s + c.revenue, 0);

    const growth = sortDesc(
      Object.entries(
        customers.reduce((acc, c) => {
          const d = c.firstDate || "Unknown";
          acc[d] = (acc[d] || 0) + 1;
          return acc;
        }, {})
      ).map(([date, count]) => ({ key: date, name: date, newCustomers: count })),
      "key"
    ).reverse();

    return {
      customers,
      newCustomers,
      returningCustomers,
      repeatRate: customers.length > 0 ? (returningCustomers.length / customers.length) * 100 : 0,
      avgRevenuePerCustomer: customers.length > 0 ? totalRevenue / customers.length : 0,
      totalRevenue,
      growth,
      topBySpend: sortDesc(customers, "revenue").slice(0, 10),
      topByOrders: sortDesc(customers, "orderCount").slice(0, 10),
    };
  }, [orders]);
}

export default function CustomerSection({ orders, openOrdersList }) {
  const stats = useCustomerStats(orders);

  const openForCustomer = (c) =>
    openOrdersList({
      title: c.name || c.phone || "Customer",
      subtitle: `${c.phone || "No phone on file"} · ${c.orderCount} order${c.orderCount === 1 ? "" : "s"}`,
      orders: c.orders,
      exportFilename: `customer-${c.phone || "unknown"}.csv`,
    });

  const splitData = [
    { name: "New", value: stats.newCustomers.length, items: stats.newCustomers.flatMap((c) => c.orders) },
    { name: "Returning", value: stats.returningCustomers.length, items: stats.returningCustomers.flatMap((c) => c.orders) },
  ].filter((d) => d.value > 0);

  const exportAll = () => {
    const rows = [
      ["Phone", "Name", "Orders", "Revenue", "First Order In Range"],
      ...stats.customers.map((c) => [c.phone || "N/A", c.name || "N/A", c.orderCount, c.revenue, c.firstDate]),
    ];
    downloadCsv("customer-report.csv", rows);
  };

  return (
    <div className="space-y-5 mb-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <SectionHeading title="Customer Analytics" subtitle={`${stats.customers.length} distinct customers in range`} />
        <button className="btn btn-secondary btn-sm" onClick={exportAll}>
          <Download size={13} /> Export Customer Report
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <StatCard label="Repeat Purchase Rate" value={percent(stats.repeatRate)} tip="Share of customers with more than one order within the selected range." />
        <StatCard label="Avg Revenue / Customer" value={currency(stats.avgRevenuePerCustomer)} />
        <StatCard label="New Customers" value={number(stats.newCustomers.length)} tip="Exactly one order within the selected range." />
        <StatCard label="Returning Customers" value={number(stats.returningCustomers.length)} tip="More than one order within the selected range." />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ChartCard title="New vs Returning Customers" tip="Within the selected date range." empty={splitData.length === 0}>
          <PieChart>
            <Pie
              data={splitData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={95}
              paddingAngle={2}
              cursor="pointer"
              onClick={(d) => openOrdersList({ title: `${d.name} Customers`, subtitle: `${d.items.length} orders`, orders: d.items, exportFilename: "customer-split.csv" })}
              animationDuration={500}
            >
              {splitData.map((_, i) => (
                <Cell key={i} fill={[CHART_COLORS[0], CHART_COLORS[2]][i % 2]} />
              ))}
            </Pie>
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <StyledTooltip formatter={(v) => number(v)} />
          </PieChart>
        </ChartCard>

        <ChartCard title="Customer Growth Trend" tip="New customers by the date of their first order within the selected range." empty={stats.growth.length === 0}>
          <AreaChart data={stats.growth}>
            <defs>
              <linearGradient id="custGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={CHART_COLORS[1]} stopOpacity={0.35} />
                <stop offset="95%" stopColor={CHART_COLORS[1]} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#94a3b8" }} />
            <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} tickFormatter={(v) => number(v)} allowDecimals={false} />
            <StyledTooltip formatter={(v) => number(v)} />
            <Area type="monotone" dataKey="newCustomers" name="New Customers" stroke={CHART_COLORS[1]} fill="url(#custGrad)" strokeWidth={2} animationDuration={500} />
          </AreaChart>
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Leaderboard
          title="Customers with Highest Spend"
          columns={["Customer", "Phone", "Orders", "Revenue"]}
          rows={stats.topBySpend}
          renderRow={(c) => (
            <tr key={c.phone || c.orders[0]?.orderId} className="cursor-pointer" onClick={() => openForCustomer(c)}>
              <td className="font-medium text-slate-700">{c.name || "N/A"}</td>
              <td>{c.phone || "N/A"}</td>
              <td>{number(c.orderCount)}</td>
              <td className="font-semibold text-slate-700">{currency(c.revenue)}</td>
            </tr>
          )}
        />
        <Leaderboard
          title="Customers with Most Orders"
          columns={["Customer", "Phone", "Orders", "Revenue"]}
          rows={stats.topByOrders}
          renderRow={(c) => (
            <tr key={c.phone || c.orders[0]?.orderId} className="cursor-pointer" onClick={() => openForCustomer(c)}>
              <td className="font-medium text-slate-700">{c.name || "N/A"}</td>
              <td>{c.phone || "N/A"}</td>
              <td className="font-semibold text-slate-700">{number(c.orderCount)}</td>
              <td>{currency(c.revenue)}</td>
            </tr>
          )}
        />
      </div>
    </div>
  );
}

function StatCard({ label, value, tip }) {
  return (
    <div className="card !p-4" title={tip}>
      <div className="text-[11px] text-slate-400 mb-1">{label}</div>
      <div className="text-xl font-bold text-slate-800">{value}</div>
    </div>
  );
}
