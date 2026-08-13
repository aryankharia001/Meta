import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  TrendingUp,
  Building2,
  ChevronDown,
  RefreshCw,
  AlertTriangle,
  LayoutGrid,
  Megaphone,
  CalendarDays,
  CreditCard,
  Package,
  Settings2,
  Trophy,
  TrendingDown,
  Clock4,
  X,
  Loader2,
} from "lucide-react";
import {
  fetchProfitSummary,
  fetchProfitCampaigns,
  fetchProfitDaily,
  fetchProfitHourly,
  fetchProfitCodPrepaid,
  fetchProfitProducts,
  fetchProfitSettings,
  updateProfitSettings,
  fetchLiveAdAccounts,
} from "../lib/api";
import { currency, percent, multiplier, number as fmtNumber } from "../lib/format";
import { todayIso, shiftDays, formatDayLabel } from "../lib/dateIst";
import { useSelectedToken } from "../lib/useSelectedToken";
import { useCampaignDrawer } from "../lib/CampaignDrawerContext";
import CampaignLink from "../components/CampaignLink";
import DataTable from "../components/DataTable";
import HourOrdersPopup from "../components/daily/HourOrdersPopup";

// ─────────────────────────────────────────────────────────────
// Phase 16 — Profitability. Entirely new, additive top-level page.
// Reads only from the new /api/profitability, /api/products, and
// /api/expenses endpoints — never touches Dashboard, Campaign Explorer,
// Daily, or Analytics's own data fetching. Every "open the campaign" /
// "open this hour's orders" action reuses the EXISTING Campaign Drawer
// (CampaignLink/useCampaignDrawer) and the EXISTING Phase 15
// HourOrdersPopup — nothing here re-implements those.
//
// §21 — Revenue, Recognized Revenue, Expenses, and Profit are always
// rendered in visibly separate blocks/cards, never merged into one
// number, so it's always clear which figure is which.
// ─────────────────────────────────────────────────────────────

const PRESETS = [
  { key: "today", label: "Today", range: () => ({ since: todayIso(), until: todayIso() }) },
  { key: "yesterday", label: "Yesterday", range: () => { const y = shiftDays(todayIso(), -1); return { since: y, until: y }; } },
  { key: "7d", label: "Last 7 Days", range: () => ({ since: shiftDays(todayIso(), -6), until: todayIso() }) },
  { key: "30d", label: "Last 30 Days", range: () => ({ since: shiftDays(todayIso(), -29), until: todayIso() }) },
  { key: "custom", label: "Custom Range", range: null },
];

const TABS = [
  { key: "overview", label: "Overview", icon: LayoutGrid },
  { key: "campaigns", label: "Campaign Profit", icon: Megaphone },
  { key: "daily", label: "Daily Profit", icon: CalendarDays },
  { key: "codPrepaid", label: "COD vs Prepaid", icon: CreditCard },
  { key: "products", label: "Product Profitability", icon: Package },
];

function pad2(n) {
  return String(n).padStart(2, "0");
}
function hourLabel(h) {
  return `${pad2(h)}:00–${pad2(h)}:59`;
}

// §12 — clear positive/negative visual state for profit numbers.
function ProfitValue({ value, kind = "currency", className = "" }) {
  const n = Number(value || 0);
  const tone = n > 0 ? "text-emerald-600" : n < 0 ? "text-rose-600" : "text-slate-700";
  const display = kind === "percent" ? percent(n) : kind === "multiplier" ? multiplier(n) : currency(n);
  return <span className={`font-semibold ${tone} ${className}`}>{display}</span>;
}

function StatCard({ label, value, kind = "currency", sub, tone }) {
  const display = kind === "percent" ? percent(value) : kind === "multiplier" ? multiplier(value) : kind === "number" ? fmtNumber(value) : currency(value);
  return (
    <div className="card !p-3.5">
      <div className="text-[11px] text-slate-500 mb-0.5">{label}</div>
      <div className={`text-lg font-display font-bold truncate ${tone || "text-slate-800"}`}>{display}</div>
      {sub && <div className="text-[10px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function SectionCard({ title, children, accent }) {
  return (
    <div className="card">
      <h3 className={`text-xs font-display font-semibold uppercase tracking-wide mb-3 ${accent || "text-slate-500"}`}>{title}</h3>
      {children}
    </div>
  );
}

function Row({ label, value, bold }) {
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className={bold ? "font-semibold text-slate-800" : "text-slate-700"}>{value}</span>
    </div>
  );
}

function AccountsPicker({ accounts, selected, loading, onToggle, onSelectAll, onClear }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen((o) => !o)}>
        <Building2 size={14} />
        {loading ? "Loading…" : `Accounts (${selected.length}/${accounts.length})`}
        <ChevronDown size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute z-30 mt-2 w-72 max-h-80 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-xl p-2">
          <div className="flex gap-3 px-1 pb-2 mb-1 border-b border-slate-100">
            <button type="button" className="text-xs font-medium text-blue-600 hover:underline" onClick={onSelectAll}>Select all</button>
            <button type="button" className="text-xs font-medium text-slate-400 hover:underline" onClick={onClear}>Clear</button>
          </div>
          {accounts.length === 0 && <div className="text-xs text-slate-400 px-2 py-3">No ad accounts found.</div>}
          {accounts.map((a) => (
            <label key={a.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 text-sm cursor-pointer">
              <input type="checkbox" checked={selected.includes(a.id)} onChange={() => onToggle(a.id)} />
              <span className="truncate">{a.name || a.id}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// §18 — configurable COD success rate, changing it invalidates every
// cached tab (the parent bumps a refreshKey) so every profit number
// across the page recalculates; never touches actual order/revenue data.
function CodRateControl({ rate, onSaved }) {
  const [value, setValue] = useState(rate ?? 70);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => setValue(rate ?? 70), [rate]);

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await updateProfitSettings(Number(value));
      onSaved(res.codSuccessRate);
      setEditing(false);
    } catch (err) {
      setError(err.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(true)} title="COD Success Rate — used to calculate Recognized COD Revenue">
        <Settings2 size={13} /> COD Success Rate: {rate ?? 70}%
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number"
        min="0"
        max="100"
        className="input !py-1 !text-xs w-20"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoFocus
      />
      <span className="text-xs text-slate-400">%</span>
      <button type="button" className="btn btn-primary btn-sm !py-1" disabled={saving} onClick={save}>
        {saving ? <Loader2 size={12} className="animate-spin" /> : "Save"}
      </button>
      <button type="button" className="btn btn-secondary btn-sm !py-1" onClick={() => setEditing(false)}>
        Cancel
      </button>
      {error && <span className="text-[11px] text-rose-600">{error}</span>}
    </div>
  );
}

// ── Overview tab (§4/§10/§11/§12/§20/§21) ──────────────────────────
function OverviewTab({ tokenId, accountIds, since, until, refreshKey }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { openCampaign } = useCampaignDrawer();

  useEffect(() => {
    if (!tokenId || accountIds.length === 0) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchProfitSummary(tokenId, { accountIds, since, until })
      .then((res) => !cancelled && setData(res))
      .catch((err) => !cancelled && setError(err.message || "Failed to load profitability summary"))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [tokenId, accountIds, since, until, refreshKey]);

  if (loading && !data) return <SkeletonBlock />;
  if (error) return <ErrorState message={error} />;
  if (!data) return null;

  const { revenue, expenses, result, bestCampaign, worstCampaign, bestDay, highestProfitHour } = data;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <StatCard label="Net Profit" value={result.netProfit} tone={result.netProfit >= 0 ? "text-emerald-600" : "text-rose-600"} />
        <StatCard label="Profit Margin" value={result.profitMargin} kind="percent" tone={result.profitMargin >= 0 ? "text-emerald-600" : "text-rose-600"} />
        <StatCard label="Total Recognized Revenue" value={revenue.totalRecognizedRevenue} />
        <StatCard label="Total Expenses" value={expenses.totalExpenses} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <SectionCard title="Revenue" accent="text-blue-600">
          <Row label="Gross Order Revenue" value={currency(revenue.grossRevenue)} bold />
          <Row label="Prepaid Revenue" value={currency(revenue.prepaidRevenue)} />
          <Row label="COD Revenue (gross)" value={currency(revenue.codRevenue)} />
          <div className="border-t border-slate-100 my-1.5" />
          <Row label="Recognized Prepaid Revenue" value={currency(revenue.recognizedPrepaidRevenue)} />
          <Row label="Recognized COD Revenue" value={currency(revenue.recognizedCodRevenue)} />
          <Row label="Total Recognized Revenue" value={<ProfitValue value={revenue.totalRecognizedRevenue} />} bold />
        </SectionCard>

        <SectionCard title="Expenses" accent="text-amber-600">
          <Row label="Product Cost" value={currency(expenses.productCost)} />
          <Row label="Packaging Cost" value={currency(expenses.packagingCost)} />
          <Row label="Shipping Cost" value={currency(expenses.shippingCost)} />
          <Row label="Other Per-Order Cost" value={currency(expenses.otherCost)} />
          <Row label="Total Product Expense" value={currency(expenses.totalProductExpense)} bold />
          <div className="border-t border-slate-100 my-1.5" />
          <Row label="Advertising Expense (Meta Spend)" value={currency(expenses.advertisingExpense)} />
          <Row label="Operating Expenses" value={currency(expenses.operatingExpense)} />
          <Row label="Total Expenses" value={currency(expenses.totalExpenses)} bold />
        </SectionCard>

        <SectionCard title="Final Result" accent="text-slate-700">
          <Row label="Total Recognized Revenue" value={currency(revenue.totalRecognizedRevenue)} />
          <Row label="Total Expenses" value={currency(expenses.totalExpenses)} />
          <div className="border-t border-slate-100 my-1.5" />
          <Row label="Net Profit" value={<ProfitValue value={result.netProfit} />} bold />
          <Row label="Profit Margin" value={<ProfitValue value={result.profitMargin} kind="percent" />} bold />
          <Row label="ROAS (on ad spend)" value={multiplier(result.roas)} />
          <Row label="Orders" value={fmtNumber(result.orders)} />
        </SectionCard>
      </div>

      <div>
        <h3 className="text-xs font-display font-semibold uppercase tracking-wide text-slate-500 mb-3">Highlights</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <HighlightCard
            icon={Trophy}
            tone="emerald"
            title="Best Profitable Campaign"
            item={bestCampaign}
            renderLabel={(c) => c.campaignName}
            onClick={bestCampaign?.campaignId ? () => openCampaign({ tokenId, campaignId: bestCampaign.campaignId, campaignName: bestCampaign.campaignName, since, until }) : null}
          />
          <HighlightCard
            icon={TrendingDown}
            tone="rose"
            title="Worst Profitable Campaign"
            item={worstCampaign}
            renderLabel={(c) => c.campaignName}
            onClick={worstCampaign?.campaignId ? () => openCampaign({ tokenId, campaignId: worstCampaign.campaignId, campaignName: worstCampaign.campaignName, since, until }) : null}
          />
          <HighlightCard
            icon={CalendarDays}
            tone="indigo"
            title="Best Profitable Day"
            item={bestDay}
            renderLabel={(d) => formatDayLabel(d.date)}
          />
        </div>
        {highestProfitHour && (
          <div className="mt-4 card !p-3.5 flex items-center gap-3">
            <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-violet-100 text-violet-600">
              <Clock4 size={16} />
            </span>
            <div>
              <div className="text-[11px] text-slate-500">Highest Profit Hour (typical, aggregated across range)</div>
              <div className="text-sm font-semibold text-slate-700">
                {hourLabel(highestProfitHour.hour)} · <ProfitValue value={highestProfitHour.netProfit} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function HighlightCard({ icon: Icon, tone, title, item, renderLabel, onClick }) {
  const toneClasses = { emerald: "bg-emerald-100 text-emerald-600", rose: "bg-rose-100 text-rose-600", indigo: "bg-indigo-100 text-indigo-600" };
  if (!item) {
    return (
      <div className="card !p-3.5 flex items-center gap-3 opacity-50">
        <span className={`flex items-center justify-center w-9 h-9 rounded-xl ${toneClasses[tone]}`}><Icon size={16} /></span>
        <div>
          <div className="text-[11px] text-slate-500">{title}</div>
          <div className="text-sm text-slate-400">No data</div>
        </div>
      </div>
    );
  }
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper type={onClick ? "button" : undefined} onClick={onClick} className={`card !p-3.5 flex items-center gap-3 w-full text-left ${onClick ? "hover:border-slate-300 cursor-pointer" : ""}`}>
      <span className={`flex items-center justify-center w-9 h-9 rounded-xl shrink-0 ${toneClasses[tone]}`}><Icon size={16} /></span>
      <div className="min-w-0">
        <div className="text-[11px] text-slate-500">{title}</div>
        <div className="text-sm font-semibold text-slate-700 truncate">{renderLabel(item)}</div>
        <div className="text-xs"><ProfitValue value={item.netProfit} /></div>
      </div>
    </Wrapper>
  );
}

// ── Campaign Profit tab (§13) ───────────────────────────────────────
function CampaignsTab({ tokenId, accountIds, since, until, refreshKey }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { openCampaign } = useCampaignDrawer();

  useEffect(() => {
    if (!tokenId || accountIds.length === 0) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchProfitCampaigns(tokenId, { accountIds, since, until })
      .then((res) => !cancelled && setData(res))
      .catch((err) => !cancelled && setError(err.message || "Failed to load campaign profit"))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [tokenId, accountIds, since, until, refreshKey]);

  if (loading && !data) return <SkeletonBlock />;
  if (error) return <ErrorState message={error} />;
  if (!data) return null;

  const columns = [
    {
      key: "campaignName",
      label: "Campaign",
      render: (c) =>
        c.campaignId ? (
          <CampaignLink tokenId={tokenId} campaignId={c.campaignId} campaignName={c.campaignName} accountId={c.accountId} accountName={c.accountName} since={since} until={until} />
        ) : (
          <span className="text-slate-400 italic">{c.campaignName}</span>
        ),
    },
    { key: "orders", label: "Orders", render: (c) => fmtNumber(c.orders) },
    { key: "grossRevenue", label: "Revenue", render: (c) => currency(c.grossRevenue) },
    { key: "totalRecognizedRevenue", label: "Recognized Revenue", render: (c) => currency(c.totalRecognizedRevenue) },
    { key: "spend", label: "Spend", render: (c) => currency(c.spend) },
    { key: "totalProductExpense", label: "Product Cost", render: (c) => currency(c.totalProductExpense) },
    { key: "operatingExpense", label: "Allocated Op. Expense", render: (c) => currency(c.operatingExpense) },
    { key: "totalExpenses", label: "Total Expenses", render: (c) => currency(c.totalExpenses) },
    { key: "netProfit", label: "Net Profit", render: (c) => <ProfitValue value={c.netProfit} /> },
    { key: "profitMargin", label: "Profit Margin", render: (c) => <ProfitValue value={c.profitMargin} kind="percent" /> },
    { key: "roas", label: "ROAS", render: (c) => multiplier(c.roas) },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <StatCard label="Total Recognized Revenue" value={data.totals.totalRecognizedRevenue} />
        <StatCard label="Total Expenses" value={data.totals.totalExpenses} />
        <StatCard label="Net Profit" value={data.totals.netProfit} tone={data.totals.netProfit >= 0 ? "text-emerald-600" : "text-rose-600"} />
        <StatCard label="Profit Margin" value={data.totals.profitMargin} kind="percent" tone={data.totals.profitMargin >= 0 ? "text-emerald-600" : "text-rose-600"} />
      </div>
      <p className="text-[11px] text-slate-400">
        Allocated Operating Expense is split across campaigns proportional to each campaign's share of recognized revenue in this range.
      </p>
      <DataTable
        tableId="profit-campaigns"
        columns={columns}
        data={data.campaigns}
        searchKeys={["campaignName"]}
        rowKey={(c) => c.campaignId || `unmatched:${c.campaignName}`}
        onRowClick={(c) => c.campaignId && openCampaign({ tokenId, campaignId: c.campaignId, campaignName: c.campaignName, accountId: c.accountId, accountName: c.accountName, since, until })}
        exportFilename="campaign-profit.csv"
        emptyMessage="No campaign activity in this range."
      />
    </div>
  );
}

// ── Daily Profit tab (§14) ──────────────────────────────────────────
function DailyTab({ tokenId, accountIds, since, until, refreshKey }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [openDate, setOpenDate] = useState(null);

  useEffect(() => {
    if (!tokenId || accountIds.length === 0) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchProfitDaily(tokenId, { accountIds, since, until })
      .then((res) => !cancelled && setData(res))
      .catch((err) => !cancelled && setError(err.message || "Failed to load daily profit"))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [tokenId, accountIds, since, until, refreshKey]);

  if (loading && !data) return <SkeletonBlock />;
  if (error) return <ErrorState message={error} />;
  if (!data) return null;

  const columns = [
    { key: "date", label: "Date", render: (d) => formatDayLabel(d.date) },
    { key: "orders", label: "Orders", render: (d) => fmtNumber(d.orders) },
    { key: "grossRevenue", label: "Revenue", render: (d) => currency(d.grossRevenue) },
    { key: "totalRecognizedRevenue", label: "Recognized Revenue", render: (d) => currency(d.totalRecognizedRevenue) },
    { key: "spend", label: "Spend", render: (d) => currency(d.spend) },
    { key: "totalProductExpense", label: "Product Cost", render: (d) => currency(d.totalProductExpense) },
    { key: "operatingExpense", label: "Operating Expense", render: (d) => currency(d.operatingExpense) },
    { key: "totalExpenses", label: "Total Expenses", render: (d) => currency(d.totalExpenses) },
    { key: "netProfit", label: "Profit", render: (d) => <ProfitValue value={d.netProfit} /> },
    { key: "profitMargin", label: "Profit Margin", render: (d) => <ProfitValue value={d.profitMargin} kind="percent" /> },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <StatCard label="Total Recognized Revenue" value={data.totals.totalRecognizedRevenue} />
        <StatCard label="Total Expenses" value={data.totals.totalExpenses} />
        <StatCard label="Net Profit" value={data.totals.netProfit} tone={data.totals.netProfit >= 0 ? "text-emerald-600" : "text-rose-600"} />
        <StatCard label="Profit Margin" value={data.totals.profitMargin} kind="percent" tone={data.totals.profitMargin >= 0 ? "text-emerald-600" : "text-rose-600"} />
      </div>
      <p className="text-[11px] text-slate-400">Click a date to see its hour-by-hour Revenue → Expenses → Profit breakdown.</p>
      <DataTable
        tableId="profit-daily"
        columns={columns}
        data={data.days}
        searchKeys={["date"]}
        rowKey={(d) => d.date}
        onRowClick={(d) => setOpenDate(d.date)}
        exportFilename="daily-profit.csv"
        emptyMessage="No orders in this range."
      />
      {openDate && <HourlyProfitModal tokenId={tokenId} accountIds={accountIds} date={openDate} onClose={() => setOpenDate(null)} />}
    </div>
  );
}

// §15/§16 — Hourly Profit + Campaign+Hour drill-down for one date. Order
// drill-down at the hour level reuses the EXISTING Phase 15
// HourOrdersPopup rather than a new orders table.
function HourlyProfitModal({ tokenId, accountIds, date, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expandedHour, setExpandedHour] = useState(null);
  const [ordersPopup, setOrdersPopup] = useState(null);
  const { openCampaign } = useCampaignDrawer();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchProfitHourly(tokenId, { accountIds, date })
      .then((res) => !cancelled && setData(res))
      .catch((err) => !cancelled && setError(err.message || "Failed to load hourly profit"))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [tokenId, accountIds, date]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
          <div>
            <div className="font-display font-semibold text-sm text-slate-800">{formatDayLabel(date)} — Hourly Profit</div>
            {data && <div className="text-xs text-slate-400">Net Profit: <ProfitValue value={data.dayTotals.netProfit} /></div>}
          </div>
          <button type="button" className="text-slate-400 hover:text-slate-600" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="overflow-auto p-3">
          {loading && !data && (
            <div className="space-y-1.5">
              {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-9 bg-slate-100 rounded animate-pulse" />)}
            </div>
          )}
          {error && <ErrorState message={error} />}
          {data && (
            <table className="w-full text-xs">
              <thead className="text-left text-[10px] uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="py-1.5 px-2">Hour</th>
                  <th className="py-1.5 px-2">Orders</th>
                  <th className="py-1.5 px-2">Revenue</th>
                  <th className="py-1.5 px-2">Spend</th>
                  <th className="py-1.5 px-2">Total Expenses</th>
                  <th className="py-1.5 px-2">Profit</th>
                  <th className="py-1.5 px-2"></th>
                </tr>
              </thead>
              <tbody>
                {data.hours.map((h) => (
                  <Fragment key={h.hour}>
                    <tr className={`border-t border-slate-50 ${h.orders > 0 ? "cursor-pointer hover:bg-slate-50" : "opacity-50"}`} onClick={() => h.orders > 0 && setExpandedHour(expandedHour === h.hour ? null : h.hour)}>
                      <td className="py-1.5 px-2 font-medium text-slate-600">{hourLabel(h.hour)}</td>
                      <td className="py-1.5 px-2">{fmtNumber(h.orders)}</td>
                      <td className="py-1.5 px-2">{currency(h.grossRevenue)}</td>
                      <td className="py-1.5 px-2">{currency(h.spend)}</td>
                      <td className="py-1.5 px-2">{currency(h.totalExpenses)}</td>
                      <td className="py-1.5 px-2"><ProfitValue value={h.netProfit} /></td>
                      <td className="py-1.5 px-2">
                        {h.orders > 0 && (
                          <button
                            type="button"
                            className="text-[10px] text-blue-600 hover:underline"
                            onClick={(e) => { e.stopPropagation(); setOrdersPopup({ hour: h.hour }); }}
                          >
                            View orders
                          </button>
                        )}
                      </td>
                    </tr>
                    {expandedHour === h.hour && h.campaigns.length > 0 && (
                      <tr>
                        <td colSpan={7} className="bg-slate-50 px-4 py-2">
                          <div className="space-y-1">
                            {h.campaigns.map((c) => (
                              <div key={c.campaignId || c.campaignName} className="flex items-center justify-between text-[11px]">
                                {c.campaignId ? (
                                  <CampaignLink tokenId={tokenId} campaignId={c.campaignId} campaignName={c.campaignName} since={date} until={date} className="!text-[11px]" />
                                ) : (
                                  <span className="text-slate-400 italic">{c.campaignName}</span>
                                )}
                                <span className="text-slate-500">{fmtNumber(c.orders)} orders · <ProfitValue value={c.netProfit} /></span>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {ordersPopup && (
        <HourOrdersPopup
          open
          tokenId={tokenId}
          date={date}
          hour={ordersPopup.hour}
          scopeLabel={hourLabel(ordersPopup.hour)}
          onClose={() => setOrdersPopup(null)}
        />
      )}
    </div>
  );
}

// ── COD vs Prepaid tab (§17) ────────────────────────────────────────
function CodPrepaidTab({ tokenId, accountIds, since, until, refreshKey }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!tokenId || accountIds.length === 0) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchProfitCodPrepaid(tokenId, { accountIds, since, until })
      .then((res) => !cancelled && setData(res))
      .catch((err) => !cancelled && setError(err.message || "Failed to load COD vs Prepaid breakdown"))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [tokenId, accountIds, since, until, refreshKey]);

  if (loading && !data) return <SkeletonBlock />;
  if (error) return <ErrorState message={error} />;
  if (!data) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <SectionCard title="Prepaid" accent="text-blue-600">
        <Row label="Orders" value={fmtNumber(data.prepaid.orders)} bold />
        <Row label="Revenue" value={currency(data.prepaid.revenue)} />
        <div className="border-t border-slate-100 my-1.5" />
        <Row label="Product Expense" value={currency(data.prepaid.productExpense)} />
        <Row label="Advertising Expense (allocated)" value={currency(data.prepaid.advertisingExpense)} />
        <Row label="Operating Expense (allocated)" value={currency(data.prepaid.operatingExpense)} />
        <Row label="Total Expenses" value={currency(data.prepaid.totalExpenses)} bold />
        <div className="border-t border-slate-100 my-1.5" />
        <Row label="Profit" value={<ProfitValue value={data.prepaid.profit} />} bold />
        <Row label="Profit Margin" value={<ProfitValue value={data.prepaid.profitMargin} kind="percent" />} bold />
      </SectionCard>

      <SectionCard title="COD (estimated)" accent="text-amber-600">
        <Row label="Orders" value={fmtNumber(data.cod.orders)} bold />
        <Row label="Gross Revenue" value={currency(data.cod.grossRevenue)} />
        <Row label="Expected Recognized Revenue" value={currency(data.cod.expectedRecognizedRevenue)} />
        <div className="border-t border-slate-100 my-1.5" />
        <Row label="Product Expense" value={currency(data.cod.productExpense)} />
        <Row label="Advertising Expense (allocated)" value={currency(data.cod.advertisingExpense)} />
        <Row label="Operating Expense (allocated)" value={currency(data.cod.operatingExpense)} />
        <Row label="Total Expenses" value={currency(data.cod.totalExpenses)} bold />
        <div className="border-t border-slate-100 my-1.5" />
        <Row label="Expected Profit" value={<ProfitValue value={data.cod.expectedProfit} />} bold />
        <Row label="Expected Profit Margin" value={<ProfitValue value={data.cod.expectedProfitMargin} kind="percent" />} bold />
        <p className="text-[10px] text-amber-600 mt-2 flex items-center gap-1"><AlertTriangle size={11} /> Estimated — assumes {data.codSuccessRate}% COD success rate.</p>
      </SectionCard>
    </div>
  );
}

// ── Product Profitability tab (§22) ─────────────────────────────────
function ProductsTab({ tokenId, accountIds, since, until, refreshKey }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!tokenId || accountIds.length === 0) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchProfitProducts(tokenId, { accountIds, since, until })
      .then((res) => !cancelled && setData(res))
      .catch((err) => !cancelled && setError(err.message || "Failed to load product profitability"))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [tokenId, accountIds, since, until, refreshKey]);

  if (loading && !data) return <SkeletonBlock />;
  if (error) return <ErrorState message={error} />;
  if (!data) return null;

  const columns = [
    { key: "name", label: "Product", render: (p) => <span className="font-medium text-slate-700">{p.name}</span> },
    { key: "sku", label: "SKU", render: (p) => p.sku || <span className="text-slate-400 italic">Unmatched</span> },
    { key: "units", label: "Units Sold", render: (p) => fmtNumber(p.units) },
    { key: "productCost", label: "Product Cost", render: (p) => currency(p.productCost) },
    { key: "packagingCost", label: "Packaging", render: (p) => currency(p.packagingCost) },
    { key: "shippingCost", label: "Shipping", render: (p) => currency(p.shippingCost) },
    { key: "otherCost", label: "Other", render: (p) => currency(p.otherCost) },
    { key: "totalCost", label: "Total Cost", render: (p) => <span className="font-semibold text-slate-700">{currency(p.totalCost)}</span> },
  ];

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-slate-400">Units sold and cost breakdown per product/SKU across every order in this range. Configure product costs on the Products page.</p>
      <DataTable
        tableId="profit-products"
        columns={columns}
        data={data.products}
        searchKeys={["name", "sku"]}
        rowKey={(p) => p.sku || "unmatched"}
        exportFilename="product-profitability.csv"
        emptyMessage="No product line items found in this range."
      />
    </div>
  );
}

function SkeletonBlock() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card !p-3.5">
            <div className="h-3 w-16 bg-slate-100 rounded animate-pulse mb-2" />
            <div className="h-5 w-20 bg-slate-100 rounded animate-pulse" />
          </div>
        ))}
      </div>
      <div className="card h-72 animate-pulse bg-slate-100" />
    </div>
  );
}

function ErrorState({ message }) {
  return (
    <div className="card border-rose-200 bg-rose-50/60 flex flex-col items-center text-center py-10 px-6">
      <span className="flex items-center justify-center w-11 h-11 rounded-2xl bg-rose-100 text-rose-600 mb-2.5">
        <AlertTriangle size={20} />
      </span>
      <p className="text-sm text-rose-600">{message}</p>
    </div>
  );
}

export default function ProfitabilityPage() {
  const { tokenId: TOKEN_ID, setTokenId, tokens } = useSelectedToken();

  const [adAccounts, setAdAccounts] = useState([]);
  const [selectedAccounts, setSelectedAccounts] = useState([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);

  const [presetKey, setPresetKey] = useState("today");
  const [customSince, setCustomSince] = useState(shiftDays(todayIso(), -6));
  const [customUntil, setCustomUntil] = useState(todayIso());
  const { since, until } = useMemo(() => {
    if (presetKey === "custom") return { since: customSince, until: customUntil };
    return PRESETS.find((p) => p.key === presetKey).range();
  }, [presetKey, customSince, customUntil]);

  const [activeTab, setActiveTab] = useState("overview");
  const [codRate, setCodRate] = useState(70);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    fetchProfitSettings()
      .then((res) => setCodRate(res.codSuccessRate))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!TOKEN_ID) return;
    let cancelled = false;
    (async () => {
      setLoadingAccounts(true);
      try {
        const res = await fetchLiveAdAccounts(TOKEN_ID);
        const list = res.success ? res.adAccounts || [] : [];
        if (cancelled) return;
        setAdAccounts(list);
        setSelectedAccounts(list.map((a) => a.id));
      } catch {
        if (!cancelled) setAdAccounts([]);
      } finally {
        if (!cancelled) setLoadingAccounts(false);
      }
    })();
    return () => { cancelled = true; };
  }, [TOKEN_ID]);

  const toggleAccount = (id) => setSelectedAccounts((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const selectAllAccounts = () => setSelectedAccounts(adAccounts.map((a) => a.id));
  const clearAccounts = () => setSelectedAccounts([]);

  const handlePresetClick = (key) => {
    if (key === "custom") {
      setCustomSince(since);
      setCustomUntil(until);
    }
    setPresetKey(key);
  };

  const activeProps = { tokenId: TOKEN_ID, accountIds: selectedAccounts, since, until, refreshKey };

  return (
    <div className="min-h-screen pb-16">
      <div className="sticky top-0 z-20 bg-white/85 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-[1600px] mx-auto px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3.5">
            <div className="flex items-center gap-2.5">
              <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md shadow-emerald-500/30">
                <TrendingUp size={18} />
              </span>
              <div>
                <h1 className="text-lg font-display font-bold text-slate-800 leading-tight">Profitability</h1>
                <p className="text-xs text-slate-400">Real profit after product, shipping, advertising, COD risk, and operating expenses</p>
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <CodRateControl rate={codRate} onSaved={(r) => { setCodRate(r); setRefreshKey((k) => k + 1); }} />
              <button className="btn btn-secondary btn-sm" onClick={() => setRefreshKey((k) => k + 1)}>
                <RefreshCw size={14} /> Refresh
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 mb-3.5">
            <select className="input w-auto" value={TOKEN_ID || ""} onChange={(e) => setTokenId(e.target.value)}>
              {tokens.length === 0 && <option value={TOKEN_ID}>{TOKEN_ID}</option>}
              {tokens.map((t) => (
                <option key={t._id} value={t._id}>{t.label || t._id}</option>
              ))}
            </select>
            <AccountsPicker accounts={adAccounts} selected={selectedAccounts} loading={loadingAccounts} onToggle={toggleAccount} onSelectAll={selectAllAccounts} onClear={clearAccounts} />
          </div>

          <div className="flex flex-wrap items-center gap-2.5 mb-3.5">
            <div className="flex gap-1 bg-slate-100 rounded-lg p-1 flex-wrap">
              {PRESETS.map((p) => (
                <button key={p.key} type="button" onClick={() => handlePresetClick(p.key)} className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${presetKey === p.key ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                  {p.label}
                </button>
              ))}
            </div>
            {presetKey === "custom" && (
              <div className="flex items-center gap-2">
                <input type="date" className="input w-auto" value={customSince} max={customUntil} onChange={(e) => setCustomSince(e.target.value)} />
                <span className="text-slate-400 text-sm">to</span>
                <input type="date" className="input w-auto" value={customUntil} min={customSince} max={todayIso()} onChange={(e) => setCustomUntil(e.target.value)} />
              </div>
            )}
            <div className="ml-auto text-xs text-slate-400">{since === until ? since : `${since} → ${until}`}</div>
          </div>

          <div className="flex gap-1 bg-slate-100 rounded-lg p-1 flex-wrap w-fit">
            {TABS.map((t) => (
              <button key={t.key} type="button" onClick={() => setActiveTab(t.key)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${activeTab === t.key ? "bg-white text-emerald-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                <t.icon size={13} /> {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-6 pt-6">
        {selectedAccounts.length === 0 ? (
          <div className="text-sm text-slate-400">Select at least one ad account above to load profitability data.</div>
        ) : (
          <>
            {activeTab === "overview" && <OverviewTab {...activeProps} />}
            {activeTab === "campaigns" && <CampaignsTab {...activeProps} />}
            {activeTab === "daily" && <DailyTab {...activeProps} />}
            {activeTab === "codPrepaid" && <CodPrepaidTab {...activeProps} />}
            {activeTab === "products" && <ProductsTab {...activeProps} />}
          </>
        )}
      </div>
    </div>
  );
}
