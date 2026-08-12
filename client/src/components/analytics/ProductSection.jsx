import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { Download } from "lucide-react";
import { ChartCard, StyledTooltip, SectionHeading, Leaderboard, CHART_COLORS } from "./chartKit";
import { currency, number, percent } from "../../lib/format";
import { downloadCsv } from "../../lib/csv";

function useProductStats(orders) {
  return useMemo(() => {
    const map = new Map();
    orders.forEach((o) => {
      (o.products || []).forEach((p) => {
        const name = p.name || "Unknown product";
        if (!map.has(name)) {
          map.set(name, { name, orders: new Set(), quantity: 0, revenue: 0, cod: 0, prepaid: 0, orderRefs: [] });
        }
        const bucket = map.get(name);
        const qty = Number(p.quantity || 1);
        const lineRevenue = Number(p.total ?? (p.price || 0) * qty ?? 0);
        bucket.quantity += qty;
        bucket.revenue += lineRevenue;
        if (!bucket.orders.has(o.orderId)) {
          bucket.orders.add(o.orderId);
          bucket.orderRefs.push(o);
          if (o.paymentType === "CASH_ON_DELIVERY") bucket.cod += 1;
          else if (o.paymentType === "PREPAID") bucket.prepaid += 1;
        }
      });
    });

    const totalRevenue = orders.reduce((s, o) => s + Number(o.totalAmountPayable || 0), 0);

    const rows = [...map.values()].map((b) => ({
      name: b.name,
      orders: b.orders.size,
      quantity: b.quantity,
      revenue: Math.round(b.revenue * 100) / 100,
      avgPrice: b.quantity > 0 ? Math.round((b.revenue / b.quantity) * 100) / 100 : 0,
      cod: b.cod,
      prepaid: b.prepaid,
      contribution: totalRevenue > 0 ? (b.revenue / totalRevenue) * 100 : 0,
      orderRefs: b.orderRefs,
    }));

    return { rows: rows.sort((a, b) => b.revenue - a.revenue), totalRevenue };
  }, [orders]);
}

export default function ProductSection({ orders, openOrdersList }) {
  const { rows } = useProductStats(orders);

  const topByQuantity = useMemo(() => [...rows].sort((a, b) => b.quantity - a.quantity).slice(0, 10), [rows]);

  const openForProduct = (row) =>
    openOrdersList({ title: row.name, subtitle: `${row.orders} orders · ${row.quantity} units sold`, orders: row.orderRefs, exportFilename: `product-${row.name}.csv` });

  const exportAll = () => {
    const csvRows = [
      ["Product", "Orders", "Quantity Sold", "Revenue", "Avg Selling Price", "COD Orders", "Prepaid Orders", "Contribution %"],
      ...rows.map((r) => [r.name, r.orders, r.quantity, r.revenue, r.avgPrice, r.cod, r.prepaid, r.contribution.toFixed(2)]),
    ];
    downloadCsv("product-analytics.csv", csvRows);
  };

  return (
    <div className="space-y-5 mb-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <SectionHeading title="Product Analytics" subtitle={`${rows.length} distinct product${rows.length === 1 ? "" : "s"} sold in range`} />
        <button className="btn btn-secondary btn-sm" onClick={exportAll}>
          <Download size={13} /> Export Product Report
        </button>
      </div>

      <ChartCard title="Top Selling Products" tip="By units sold. Click a bar to see its orders." height={300} empty={topByQuantity.length === 0}>
        <BarChart data={topByQuantity} layout="vertical" margin={{ left: 40 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 11, fill: "#94a3b8" }} tickFormatter={(v) => number(v)} />
          <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 10, fill: "#64748b" }} />
          <StyledTooltip formatter={(v) => number(v)} />
          <Bar dataKey="quantity" name="Units Sold" fill={CHART_COLORS[0]} radius={[0, 6, 6, 0]} cursor="pointer" onClick={(d) => openForProduct(d)} animationDuration={500} />
        </BarChart>
      </ChartCard>

      <Leaderboard
        title="Revenue by Product"
        tip="Every product's revenue, units sold, average selling price, COD/Prepaid order split, and contribution to total revenue in range."
        columns={["Product", "Orders", "Qty Sold", "Revenue", "Avg Price", "COD", "Prepaid", "Contribution"]}
        rows={rows}
        actions={
          rows.length > 0 && (
            <span className="text-[11px] text-slate-400">
              Top product: <span className="font-medium text-slate-600">{rows[0].name}</span> ({percent(rows[0].contribution)})
            </span>
          )
        }
        renderRow={(r) => (
          <tr key={r.name} className="cursor-pointer" onClick={() => openForProduct(r)}>
            <td className="font-medium text-slate-700">{r.name}</td>
            <td>{number(r.orders)}</td>
            <td>{number(r.quantity)}</td>
            <td className="font-semibold text-slate-700">{currency(r.revenue)}</td>
            <td>{currency(r.avgPrice)}</td>
            <td>
              <span className="badge badge-amber">{r.cod}</span>
            </td>
            <td>
              <span className="badge badge-blue">{r.prepaid}</span>
            </td>
            <td>{percent(r.contribution)}</td>
          </tr>
        )}
        emptyMessage="No product line items were found on orders in this range — Shiprocket may not be returning cart line items for these orders yet."
      />
    </div>
  );
}
