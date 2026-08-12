import { useState } from "react";
import { Download, ShoppingCart, Users, BarChart3, Megaphone, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { fetchAnalyticsOrders, fetchLiveCampaigns, fetchLiveAdAccounts, logActivity } from "../lib/api";
import { useSelectedToken } from "../lib/useSelectedToken";
import { useNotifications } from "../lib/NotificationsContext";
import { usePreferences } from "../lib/PreferencesContext";

// ────────────────────────────────────────────────────────────────
// Phase 7 — Export Center. A dedicated page to trigger exports without
// first having to open a specific drawer/section (CampaignDrawer,
// OrdersListPopup, and every AnalyticsPage section already have their
// own inline CSV export buttons scoped to what's currently on screen —
// this page is the CRM-style "one place for all exports" companion,
// not a replacement for those). Every export here derives from the
// same two already-existing, read-only endpoints Dashboard/Analytics
// already use (fetchLiveCampaigns, fetchAnalyticsOrders) — no new
// backend routes, no new aggregation logic duplicated for the third
// time. CSV only for now; PDF/Excel buttons are visible but disabled,
// same "future ready" pattern Phase 5 used for the live-sync transport.
// ────────────────────────────────────────────────────────────────

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const todayIso = () => new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
const shiftDays = (dateStr, days) => {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

function toCsvValue(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function downloadCsv(filename, rows) {
  const csv = rows.map((r) => r.map(toCsvValue).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const EXPORTS = [
  {
    key: "orders",
    title: "Order List",
    desc: "Every order in the selected date range — ID, customer, campaign, amount, payment, status.",
    icon: ShoppingCart,
    accent: "bg-sky-50 text-sky-600",
  },
  {
    key: "customers",
    title: "Customer Report",
    desc: "One row per customer — total orders, total revenue, first/last order, location.",
    icon: Users,
    accent: "bg-emerald-50 text-emerald-600",
  },
  {
    key: "campaigns",
    title: "Campaign Report",
    desc: "Spend, orders, revenue and ROAS per campaign — same data as the Dashboard's campaign table.",
    icon: Megaphone,
    accent: "bg-indigo-50 text-indigo-600",
  },
  {
    key: "summary",
    title: "Analytics Summary",
    desc: "Headline totals plus a revenue-by-campaign breakdown for the selected range.",
    icon: BarChart3,
    accent: "bg-violet-50 text-violet-600",
  },
];

export default function ExportCenterPage() {
  const { tokenId, tokens, setTokenId } = useSelectedToken();
  const { addNotification } = useNotifications();
  const { prefs } = usePreferences();

  const [presetKey, setPresetKey] = useState("30d");
  const since = presetKey === "7d" ? shiftDays(todayIso(), -6) : presetKey === "90d" ? shiftDays(todayIso(), -89) : shiftDays(todayIso(), -29);
  const until = todayIso();

  const [running, setRunning] = useState(null); // key of export currently in flight

  const finishExport = (key, title, rowCount) => {
    logActivity("export", `Exported ${title} (${rowCount} row${rowCount === 1 ? "" : "s"})`, { key, since, until });
    if (prefs.notifyOnExport) addNotification("export", `${title} export ready — ${rowCount} row${rowCount === 1 ? "" : "s"}`);
  };

  const runExport = async (key) => {
    if (!tokenId || running) return;
    setRunning(key);
    try {
      if (key === "orders") {
        const res = await fetchAnalyticsOrders(tokenId, { since, until });
        const orders = res.orders || [];
        const rows = [
          ["Order ID", "Order Date", "Customer", "Phone", "Campaign", "Amount", "Payment Type", "Payment Status", "Delivery Status", "City", "State"],
          ...orders.map((o) => [o.orderId, o.orderDate, o.customerName || "N/A", o.phone || "N/A", o.campaignName || "N/A", o.totalAmountPayable, o.paymentType || "N/A", o.paymentStatus || "N/A", o.deliveryStatus || "N/A", o.city || "N/A", o.state || "N/A"]),
        ];
        downloadCsv(`orders-${since}-to-${until}.csv`, rows);
        finishExport(key, "Order List", orders.length);
      } else if (key === "customers") {
        const res = await fetchAnalyticsOrders(tokenId, { since, until });
        const orders = res.orders || [];
        const byPhone = new Map();
        orders.forEach((o) => {
          if (!o.phone) return;
          const cur = byPhone.get(o.phone) || { phone: o.phone, name: o.customerName, city: o.city, state: o.state, orders: 0, revenue: 0, first: o.orderDate, last: o.orderDate };
          cur.orders += 1;
          cur.revenue += Number(o.totalAmountPayable || 0);
          if (o.orderDate < cur.first) cur.first = o.orderDate;
          if (o.orderDate > cur.last) cur.last = o.orderDate;
          byPhone.set(o.phone, cur);
        });
        const customers = [...byPhone.values()].sort((a, b) => b.revenue - a.revenue);
        const rows = [
          ["Phone", "Name", "City", "State", "Total Orders", "Total Revenue", "First Order", "Last Order"],
          ...customers.map((c) => [c.phone, c.name || "N/A", c.city || "N/A", c.state || "N/A", c.orders, c.revenue.toFixed(2), c.first, c.last]),
        ];
        downloadCsv(`customers-${since}-to-${until}.csv`, rows);
        finishExport(key, "Customer Report", customers.length);
      } else if (key === "campaigns") {
        const accRes = await fetchLiveAdAccounts(tokenId);
        const accountIds = (accRes.success ? accRes.adAccounts || [] : []).map((a) => a.id);
        if (accountIds.length === 0) throw new Error("No ad accounts connected for this token");
        const res = await fetchLiveCampaigns(tokenId, { accountIds, since, until });
        const campaigns = res.campaigns || [];
        const rows = [
          ["Campaign", "Spend", "Orders", "Revenue", "Cost/Order", "ROAS"],
          ...campaigns.map((c) => [c.campaignName, c.spend ?? 0, c.orders ?? 0, c.revenue ?? 0, c.costPerOrder ?? 0, c.roas ?? 0]),
        ];
        downloadCsv(`campaign-report-${since}-to-${until}.csv`, rows);
        finishExport(key, "Campaign Report", campaigns.length);
      } else if (key === "summary") {
        const res = await fetchAnalyticsOrders(tokenId, { since, until });
        const orders = res.orders || [];
        const totalRevenue = orders.reduce((s, o) => s + Number(o.totalAmountPayable || 0), 0);
        const prepaid = orders.filter((o) => o.paymentType === "PREPAID").length;
        const cod = orders.filter((o) => o.paymentType === "CASH_ON_DELIVERY").length;
        const delivered = orders.filter((o) => (o.deliveryStatus || "").toLowerCase().includes("deliver")).length;
        const cancelled = orders.filter((o) => (o.deliveryStatus || "").toLowerCase().includes("cancel")).length;

        const byCampaign = new Map();
        orders.forEach((o) => {
          const key2 = o.campaignName || "Unattributed";
          const cur = byCampaign.get(key2) || { campaign: key2, orders: 0, revenue: 0 };
          cur.orders += 1;
          cur.revenue += Number(o.totalAmountPayable || 0);
          byCampaign.set(key2, cur);
        });
        const campaignRows = [...byCampaign.values()].sort((a, b) => b.revenue - a.revenue);

        const rows = [
          ["Metric", "Value"],
          ["Date Range", `${since} to ${until}`],
          ["Total Orders", orders.length],
          ["Total Revenue", totalRevenue.toFixed(2)],
          ["Avg Order Value", orders.length ? (totalRevenue / orders.length).toFixed(2) : "0.00"],
          ["Prepaid Orders", prepaid],
          ["COD Orders", cod],
          ["Delivered Orders", delivered],
          ["Cancelled Orders", cancelled],
          [],
          ["Campaign", "Orders", "Revenue"],
          ...campaignRows.map((c) => [c.campaign, c.orders, c.revenue.toFixed(2)]),
        ];
        downloadCsv(`analytics-summary-${since}-to-${until}.csv`, rows);
        finishExport(key, "Analytics Summary", orders.length);
      }
    } catch (err) {
      addNotification("error", `Export failed: ${err.message || "Unknown error"}`);
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-2.5 mb-1">
        <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md shadow-emerald-500/30">
          <Download size={18} />
        </span>
        <div>
          <h1 className="text-lg font-display font-bold text-slate-800 leading-tight">Export Center</h1>
          <p className="text-xs text-slate-400">Download dashboard, campaign, order and customer data as CSV</p>
        </div>
      </div>

      <div className="card flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          Token
          <select className="input w-auto" value={tokenId || ""} onChange={(e) => setTokenId(e.target.value)}>
            {tokens.length === 0 && <option value={tokenId}>{tokenId}</option>}
            {tokens.map((t) => (
              <option key={t._id} value={t._id}>
                {t.label || t._id}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          Date Range
          <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
            {[
              { key: "7d", label: "7 Days" },
              { key: "30d", label: "30 Days" },
              { key: "90d", label: "90 Days" },
            ].map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setPresetKey(p.key)}
                className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  presetKey === p.key ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </label>
        <div className="text-xs text-slate-400 ml-auto">
          {since} → {until}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {EXPORTS.map((exp) => (
          <div key={exp.key} className="card flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <span className={`flex items-center justify-center w-9 h-9 rounded-lg shrink-0 ${exp.accent}`}>
                <exp.icon size={16} />
              </span>
              <div className="min-w-0">
                <div className="font-display font-semibold text-sm text-slate-800">{exp.title}</div>
                <p className="text-xs text-slate-400 mt-0.5">{exp.desc}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <button
                type="button"
                className="btn btn-primary btn-sm flex-1"
                onClick={() => runExport(exp.key)}
                disabled={!tokenId || running !== null}
              >
                {running === exp.key ? <Loader2 size={13} className="animate-spin" /> : <FileSpreadsheet size={13} />}
                {running === exp.key ? "Exporting…" : "Export CSV"}
              </button>
              <button type="button" className="btn btn-secondary btn-sm !px-2.5 opacity-50 cursor-not-allowed" disabled title="PDF export coming soon">
                <FileText size={13} />
              </button>
              <span className="badge badge-slate text-[10px] shrink-0">PDF/Excel soon</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
