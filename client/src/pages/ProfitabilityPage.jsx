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
  HelpCircle,
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
// Phase 18 §3 — expense drill-down popups ("what's behind this number")
// and §4 — HALUCINATE what-if scenario mode. Both entirely new, additive,
// scoped to this page only (see file-level comments in each for why they
// live in their own components/lib modules instead of growing this file
// further).
import { ExpenseOrdersPopup, CampaignSpendPopup, OperatingExpenseBreakdownPopup } from "../components/profitability/ExpenseDrillPopups";
import HalucinatePanel, { ValueWithScenario, HalucinateTabBanner, HALUCINATE_CSS } from "../components/profitability/HalucinatePanel";
import { emptyScenario, isScenarioActive, computeScenario, wrapRollupAsScenarioData, buildScenarioRatios, applyScenarioToRow } from "../lib/scenarioMath";
// Phase 18 (part 2) — SWR data-loading plumbing for this page's 5 tabs.
// Purely additive on top of the Phase 18 §3/§4 work above — only touches
// each tab's own useState+useEffect+fetch* pattern, never the HALUCINATE
// panel, drill-down popups, or scenario math.
import {
  getCachedProfitSummary,
  setCachedProfitSummary,
  getCachedProfitCampaigns,
  setCachedProfitCampaigns,
  getCachedProfitDaily,
  setCachedProfitDaily,
  getCachedProfitCodPrepaid,
  setCachedProfitCodPrepaid,
  getCachedProfitProducts,
  setCachedProfitProducts,
  profitCacheKey,
} from "../lib/profitabilityCache";
import { useSwrFetch } from "../lib/useSwr";
import LastUpdatedIndicator from "../components/LastUpdatedIndicator";
import AbandonedCartSummaryCard from "../components/AbandonedCartSummaryCard";

// Profit numbers depend on orders (which move continuously through the
// day) — a middle-ground stale time between the fast Dashboard/Explorer
// pages and the slower Products/Expenses config pages.
const PROFIT_STALE_MS = 60000;

// Every tab shares the page-level "refreshKey" (bumped by the header's
// Refresh button and by CodRateControl's onSaved — changing the COD rate
// must always show fresh numbers immediately). refreshKey is deliberately
// NOT part of the SWR cache key (it's a "force a refetch now" signal, not
// part of "what data to fetch") — instead each tab watches it with the
// same ref-guarded pattern Dashboard.jsx's own live-sync effect uses, and
// calls the SWR hook's refresh() when it changes.
function useForceRefreshOnKeyBump(key, refresh) {
  const prevRef = useRef(key);
  useEffect(() => {
    if (key === prevRef.current) return;
    prevRef.current = key;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

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

function SectionCard({ title, children, accent, className }) {
  return (
    <div className={`card transition-all duration-500 ${className || ""}`}>
      <h3 className={`text-xs font-display font-semibold uppercase tracking-wide mb-3 ${accent || "text-slate-500"}`}>{title}</h3>
      {children}
    </div>
  );
}

// Phase 18 §3 — every Row in the Expenses card (and a few in Revenue/
// Final Result) is now optionally clickable ("what's behind this
// number"): pass `onClick` and it renders as a full-width button with a
// hover state instead of a plain div, same label/value layout either way
// so nothing about the existing look changes when onClick is omitted.
function Row({ label, value, bold, onClick, title }) {
  const content = (
    <>
      <span className="text-slate-500">{label}</span>
      <span className={bold ? "font-semibold text-slate-800" : "text-slate-700"}>{value}</span>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        title={title || "Click to see what's behind this number"}
        onClick={onClick}
        className="w-full flex items-center justify-between py-1 text-sm text-left rounded-lg px-1.5 -mx-1.5 hover:bg-slate-50 transition-colors cursor-pointer"
      >
        {content}
      </button>
    );
  }
  return <div className="flex items-center justify-between py-1 text-sm">{content}</div>;
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
// Phase 19 §3.5 — scenario state (scenario/setScenario/scenarioActive/
// resetScenario) now lives in the parent ProfitabilityPage instead of
// here, so it survives switching tabs and can be reused by
// CampaignsTab/DailyTab below. The reset-on-range-change effect moved up
// with it (see ProfitabilityPage). Everything else about this tab is
// unchanged.
function OverviewTab({ tokenId, accountIds, since, until, refreshKey, scenario, setScenario, scenarioActive, resetScenario }) {
  const overviewKey = tokenId && accountIds.length > 0 ? profitCacheKey(tokenId, accountIds, since, until) : null;
  const { data, loading, isValidating, error, backgroundError, lastUpdatedAt, refresh } = useSwrFetch(
    overviewKey,
    () => fetchProfitSummary(tokenId, { accountIds, since, until }),
    {
      staleTimeMs: PROFIT_STALE_MS,
      getCached: () => getCachedProfitSummary(tokenId, accountIds, since, until),
      setCached: (d) => setCachedProfitSummary(tokenId, accountIds, since, until, d),
    }
  );
  useForceRefreshOnKeyBump(refreshKey, refresh);
  const { openCampaign } = useCampaignDrawer();

  // Phase 18 §3 — which expense drill-down popup (if any) is open.
  // { kind: "orders", type: "productCost"|"packagingCost"|"shippingCost"|"otherCost"|"unmapped" } | { kind: "campaigns" } | { kind: "operating" } | null
  const [drill, setDrill] = useState(null);

  // Phase 18 §4 — HALUCINATE scenario result for THIS tab's own /summary
  // data. Still computed locally (each tab computes its own
  // scenarioResult from its own fetched data), only the raw override
  // state itself is lifted.
  const scenarioResult = useMemo(() => (scenarioActive ? computeScenario(data, scenario) : null), [scenarioActive, data, scenario]);

  if (loading) return <SkeletonBlock />;
  if (error) return <ErrorState message={error} />;
  if (!data) return null;

  const { revenue, expenses, result, bestCampaign, worstCampaign, bestDay, highestProfitHour } = data;
  const hasUnmapped = (expenses.unmappedProductUnits || 0) > 0;
  // Phase 19 §2/§5 — distinct from hasUnmapped above: this counts orders
  // whose raw payload had NO recognizable product-line-items array at all
  // (a data-shape gap upstream of product matching), never orders that
  // simply didn't match a configured Product. See the big comment on
  // expenses.ordersWithNoLineItemsFound in server/routes/profitability.js.
  const hasNoLineItems = (expenses.ordersWithNoLineItemsFound || 0) > 0;

  return (
    <div className="space-y-6">
      <div className="flex justify-end -mb-2">
        <LastUpdatedIndicator lastUpdatedAt={lastUpdatedAt} isValidating={isValidating} backgroundError={backgroundError} />
      </div>
      <AbandonedCartSummaryCard since={since} until={until} />
      <HalucinatePanel scenario={scenario} setScenario={setScenario} active={scenarioActive} onReset={resetScenario} data={data} scenarioResult={scenarioResult} />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <StatCard
          label="Net Profit"
          value={result.netProfit}
          tone={result.netProfit >= 0 ? "text-emerald-600" : "text-rose-600"}
          sub={scenarioActive ? `Scenario: ${currency(scenarioResult.netProfit)}` : undefined}
        />
        <StatCard
          label="Profit Margin"
          value={result.profitMargin}
          kind="percent"
          tone={result.profitMargin >= 0 ? "text-emerald-600" : "text-rose-600"}
          sub={scenarioActive ? `Scenario: ${percent(scenarioResult.profitMargin)}` : undefined}
        />
        <StatCard
          label="Total Recognized Revenue"
          value={revenue.totalRecognizedRevenue}
          sub={scenarioActive ? `Scenario: ${currency(scenarioResult.totalRecognizedRevenue)}` : undefined}
        />
        <StatCard
          label="Total Expenses"
          value={expenses.totalExpenses}
          sub={scenarioActive ? `Scenario: ${currency(scenarioResult.totalExpenses)}` : undefined}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <SectionCard title="Revenue" accent="text-blue-600">
          <Row label="Gross Order Revenue" value={currency(revenue.grossRevenue)} bold />
          <Row label="Prepaid Revenue" value={currency(revenue.prepaidRevenue)} />
          <Row label="COD Revenue (gross)" value={currency(revenue.codRevenue)} />
          <div className="border-t border-slate-100 my-1.5" />
          <Row label="Recognized Prepaid Revenue" value={currency(revenue.recognizedPrepaidRevenue)} />
          <Row
            label="Recognized COD Revenue"
            value={<ValueWithScenario actual={revenue.recognizedCodRevenue} scenarioValue={scenarioResult?.recognizedCodRevenue} active={scenarioActive} />}
          />
          <Row
            label="Total Recognized Revenue"
            value={scenarioActive ? <ValueWithScenario actual={revenue.totalRecognizedRevenue} scenarioValue={scenarioResult.totalRecognizedRevenue} active kind="currency" /> : <ProfitValue value={revenue.totalRecognizedRevenue} />}
            bold
          />
        </SectionCard>

        <SectionCard title="Expenses" accent="text-amber-600" className={scenarioActive ? "halucinate-card" : ""}>
          <Row
            label="Product Cost"
            value={<ValueWithScenario actual={expenses.productCost} scenarioValue={scenarioResult?.productCost} active={scenarioActive} />}
            onClick={() => setDrill({ kind: "orders", type: "productCost" })}
          />
          <Row
            label="Packaging Cost"
            value={<ValueWithScenario actual={expenses.packagingCost} scenarioValue={scenarioResult?.packagingCost} active={scenarioActive} />}
            onClick={() => setDrill({ kind: "orders", type: "packagingCost" })}
          />
          <Row
            label="Shipping Cost"
            value={<ValueWithScenario actual={expenses.shippingCost} scenarioValue={scenarioResult?.shippingCost} active={scenarioActive} />}
            onClick={() => setDrill({ kind: "orders", type: "shippingCost" })}
          />
          <Row
            label="Other Per-Order Cost"
            value={<ValueWithScenario actual={expenses.otherCost} scenarioValue={scenarioResult?.otherCost} active={scenarioActive} />}
            onClick={() => setDrill({ kind: "orders", type: "otherCost" })}
          />
          <Row
            label="Total Product Expense"
            value={<ValueWithScenario actual={expenses.totalProductExpense} scenarioValue={scenarioResult?.totalProductExpense} active={scenarioActive} />}
            onClick={() => setDrill({ kind: "orders", type: "totalCost" })}
            bold
          />
          {hasUnmapped && (
            <button
              type="button"
              onClick={() => setDrill({ kind: "orders", type: "unmapped" })}
              className="mt-1.5 w-full flex items-start gap-1.5 text-left text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 hover:bg-amber-100 transition-colors"
            >
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <span>
                <strong>{fmtNumber(expenses.unmappedProductUnits)}</strong> unit{expenses.unmappedProductUnits === 1 ? "" : "s"} across{" "}
                <strong>{fmtNumber(expenses.unmappedProductOrders)}</strong> order{expenses.unmappedProductOrders === 1 ? "" : "s"} have no cost config
                — Product Cost may be understated. Click to see them.
              </span>
            </button>
          )}
          {/* Phase 19 §2/§5 — a DIFFERENT failure mode from the amber
              "unmapped" box above, so it's deliberately a different color
              (sky, not amber) and deliberately not clickable (there's no
              per-order list for this yet — an admin can pull the exact
              order via the new /debug/sample-order-shape endpoint). Worded
              for a non-technical user: this means the order's underlying
              data didn't look like a product order at all, so configuring
              Product Cost pages won't help — it's a data problem, not a
              settings problem. */}
          {hasNoLineItems && (
            <div className="mt-1.5 w-full flex items-start gap-1.5 text-left text-[11px] text-sky-700 bg-sky-50 border border-sky-200 rounded-lg px-2.5 py-1.5">
              <HelpCircle size={12} className="mt-0.5 shrink-0" />
              <span>
                <strong>{fmtNumber(expenses.ordersWithNoLineItemsFound)}</strong> order{expenses.ordersWithNoLineItemsFound === 1 ? "" : "s"} had no
                recognizable product data at all in their order info — this is a <strong>data-shape issue</strong>, not a missing cost setup.
                Configuring product costs will not fix this on its own; it means these orders' underlying data doesn't match any format this app
                currently understands. If you're an admin, use the Sample Order Shape diagnostic to see exactly what's in one of these orders.
              </span>
            </div>
          )}
          <div className="border-t border-slate-100 my-1.5" />
          <Row
            label="Advertising Expense (Meta Spend)"
            value={<ValueWithScenario actual={expenses.advertisingExpense} scenarioValue={scenarioResult?.advertisingExpense} active={scenarioActive} />}
            onClick={() => setDrill({ kind: "campaigns" })}
          />
          <Row
            label="Operating Expenses"
            value={<ValueWithScenario actual={expenses.operatingExpense} scenarioValue={scenarioResult?.operatingExpense} active={scenarioActive} />}
            onClick={() => setDrill({ kind: "operating" })}
          />
          <Row
            label="Total Expenses"
            value={<ValueWithScenario actual={expenses.totalExpenses} scenarioValue={scenarioResult?.totalExpenses} active={scenarioActive} />}
            bold
          />
        </SectionCard>

        <SectionCard title="Final Result" accent="text-slate-700" className={scenarioActive ? "halucinate-card" : ""}>
          <Row label="Total Recognized Revenue" value={<ValueWithScenario actual={revenue.totalRecognizedRevenue} scenarioValue={scenarioResult?.totalRecognizedRevenue} active={scenarioActive} />} />
          <Row label="Total Expenses" value={<ValueWithScenario actual={expenses.totalExpenses} scenarioValue={scenarioResult?.totalExpenses} active={scenarioActive} />} />
          <div className="border-t border-slate-100 my-1.5" />
          <Row label="Net Profit" value={scenarioActive ? <ValueWithScenario actual={result.netProfit} scenarioValue={scenarioResult.netProfit} active /> : <ProfitValue value={result.netProfit} />} bold />
          <Row
            label="Profit Margin"
            value={scenarioActive ? <ValueWithScenario actual={result.profitMargin} scenarioValue={scenarioResult.profitMargin} active kind="percent" /> : <ProfitValue value={result.profitMargin} kind="percent" />}
            bold
          />
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

      <ExpenseOrdersPopup
        open={drill?.kind === "orders"}
        tokenId={tokenId}
        accountIds={accountIds}
        since={since}
        until={until}
        type={drill?.kind === "orders" ? drill.type : "totalCost"}
        onClose={() => setDrill(null)}
      />
      <CampaignSpendPopup open={drill?.kind === "campaigns"} tokenId={tokenId} accountIds={accountIds} since={since} until={until} onClose={() => setDrill(null)} />
      <OperatingExpenseBreakdownPopup
        open={drill?.kind === "operating"}
        breakdown={expenses.operatingExpenseBreakdown}
        since={since}
        until={until}
        onClose={() => setDrill(null)}
      />
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
// Phase 19 §3.5 — now HALUCINATE-aware. Full per-row proportional
// adjustment (not just a top banner): each row's own totalRecognizedRevenue/
// totalProductExpense/totalExpenses/netProfit/profitMargin is recomputed
// via applyScenarioToRow() using ratios derived from this tab's own
// `totals` (the same rollupOrders() shape /summary uses), so the relative
// scenario delta each cost category has overall is applied to each
// campaign's own actual figures. See lib/scenarioMath.js for why this is
// a proportional approximation rather than a full per-order recompute.
function CampaignsTab({ tokenId, accountIds, since, until, refreshKey, scenario, scenarioActive }) {
  const campaignsKey = tokenId && accountIds.length > 0 ? profitCacheKey(tokenId, accountIds, since, until) : null;
  const { data, loading, isValidating, error, backgroundError, lastUpdatedAt, refresh } = useSwrFetch(
    campaignsKey,
    () => fetchProfitCampaigns(tokenId, { accountIds, since, until }),
    {
      staleTimeMs: PROFIT_STALE_MS,
      getCached: () => getCachedProfitCampaigns(tokenId, accountIds, since, until),
      setCached: (d) => setCachedProfitCampaigns(tokenId, accountIds, since, until, d),
    }
  );
  useForceRefreshOnKeyBump(refreshKey, refresh);
  const { openCampaign } = useCampaignDrawer();

  const scenarioData = useMemo(() => (data ? wrapRollupAsScenarioData(data.totals, data.codSuccessRate) : null), [data]);
  const scenarioResult = useMemo(() => (scenarioActive && scenarioData ? computeScenario(scenarioData, scenario) : null), [scenarioActive, scenarioData, scenario]);
  const ratios = useMemo(() => (scenarioActive && scenarioData ? buildScenarioRatios(scenarioData, scenario) : null), [scenarioActive, scenarioData, scenario]);
  const adjustedByKey = useMemo(() => {
    if (!scenarioActive || !ratios || !data) return null;
    const map = new Map();
    data.campaigns.forEach((c) => map.set(c.campaignId || `unmatched:${c.campaignName}`, applyScenarioToRow(c, ratios)));
    return map;
  }, [scenarioActive, ratios, data]);

  if (loading) return <SkeletonBlock />;
  if (error) return <ErrorState message={error} />;
  if (!data) return null;

  const adjOf = (c) => adjustedByKey?.get(c.campaignId || `unmatched:${c.campaignName}`);

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
    {
      key: "totalRecognizedRevenue",
      label: "Recognized Revenue",
      render: (c) => <ValueWithScenario actual={c.totalRecognizedRevenue} scenarioValue={adjOf(c)?.totalRecognizedRevenue} active={scenarioActive} />,
    },
    { key: "spend", label: "Spend", render: (c) => currency(c.spend) },
    {
      key: "totalProductExpense",
      label: "Product Cost",
      render: (c) => <ValueWithScenario actual={c.totalProductExpense} scenarioValue={adjOf(c)?.totalProductExpense} active={scenarioActive} />,
    },
    { key: "operatingExpense", label: "Allocated Op. Expense", render: (c) => currency(c.operatingExpense) },
    {
      key: "totalExpenses",
      label: "Total Expenses",
      render: (c) => <ValueWithScenario actual={c.totalExpenses} scenarioValue={adjOf(c)?.totalExpenses} active={scenarioActive} />,
    },
    {
      key: "netProfit",
      label: "Net Profit",
      render: (c) => (scenarioActive && adjOf(c) ? <ValueWithScenario actual={c.netProfit} scenarioValue={adjOf(c).netProfit} active /> : <ProfitValue value={c.netProfit} />),
    },
    {
      key: "profitMargin",
      label: "Profit Margin",
      render: (c) =>
        scenarioActive && adjOf(c) ? (
          <ValueWithScenario actual={c.profitMargin} scenarioValue={adjOf(c).profitMargin} active kind="percent" />
        ) : (
          <ProfitValue value={c.profitMargin} kind="percent" />
        ),
    },
    { key: "roas", label: "ROAS", render: (c) => multiplier(c.roas) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <LastUpdatedIndicator lastUpdatedAt={lastUpdatedAt} isValidating={isValidating} backgroundError={backgroundError} />
      </div>
      {scenarioActive && scenarioResult && (
        <HalucinateTabBanner scenarioResult={scenarioResult} actualNetProfit={data.totals.netProfit} actualProfitMargin={data.totals.profitMargin} />
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <StatCard
          label="Total Recognized Revenue"
          value={data.totals.totalRecognizedRevenue}
          sub={scenarioActive && scenarioResult ? `Scenario: ${currency(scenarioResult.totalRecognizedRevenue)}` : undefined}
        />
        <StatCard label="Total Expenses" value={data.totals.totalExpenses} sub={scenarioActive && scenarioResult ? `Scenario: ${currency(scenarioResult.totalExpenses)}` : undefined} />
        <StatCard
          label="Net Profit"
          value={data.totals.netProfit}
          tone={data.totals.netProfit >= 0 ? "text-emerald-600" : "text-rose-600"}
          sub={scenarioActive && scenarioResult ? `Scenario: ${currency(scenarioResult.netProfit)}` : undefined}
        />
        <StatCard
          label="Profit Margin"
          value={data.totals.profitMargin}
          kind="percent"
          tone={data.totals.profitMargin >= 0 ? "text-emerald-600" : "text-rose-600"}
          sub={scenarioActive && scenarioResult ? `Scenario: ${percent(scenarioResult.profitMargin)}` : undefined}
        />
      </div>
      <p className="text-[11px] text-slate-400">
        Allocated Operating Expense is split across campaigns proportional to each campaign's share of recognized revenue in this range.
        {scenarioActive && " Recognized Revenue/Product Cost/Total Expenses/Net Profit/Margin above are HALUCINATE scenario estimates, proportionally adjusted per campaign."}
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
// Phase 19 §3.5 — same HALUCINATE propagation approach as CampaignsTab
// above: full per-row proportional adjustment via applyScenarioToRow(),
// ratios derived from this tab's own `totals`. The per-hour drill-down
// (HourlyProfitModal below) is NOT scenario-adjusted — out of this
// phase's time budget, see Phase 19 report.
function DailyTab({ tokenId, accountIds, since, until, refreshKey, scenario, scenarioActive }) {
  const [openDate, setOpenDate] = useState(null);

  const dailyKey = tokenId && accountIds.length > 0 ? profitCacheKey(tokenId, accountIds, since, until) : null;
  const { data, loading, isValidating, error, backgroundError, lastUpdatedAt, refresh } = useSwrFetch(
    dailyKey,
    () => fetchProfitDaily(tokenId, { accountIds, since, until }),
    {
      staleTimeMs: PROFIT_STALE_MS,
      getCached: () => getCachedProfitDaily(tokenId, accountIds, since, until),
      setCached: (d) => setCachedProfitDaily(tokenId, accountIds, since, until, d),
    }
  );
  useForceRefreshOnKeyBump(refreshKey, refresh);

  const scenarioData = useMemo(() => (data ? wrapRollupAsScenarioData(data.totals, data.codSuccessRate) : null), [data]);
  const scenarioResult = useMemo(() => (scenarioActive && scenarioData ? computeScenario(scenarioData, scenario) : null), [scenarioActive, scenarioData, scenario]);
  const ratios = useMemo(() => (scenarioActive && scenarioData ? buildScenarioRatios(scenarioData, scenario) : null), [scenarioActive, scenarioData, scenario]);
  const adjustedByDate = useMemo(() => {
    if (!scenarioActive || !ratios || !data) return null;
    const map = new Map();
    data.days.forEach((d) => map.set(d.date, applyScenarioToRow(d, ratios)));
    return map;
  }, [scenarioActive, ratios, data]);

  if (loading) return <SkeletonBlock />;
  if (error) return <ErrorState message={error} />;
  if (!data) return null;

  const adjOf = (d) => adjustedByDate?.get(d.date);

  const columns = [
    { key: "date", label: "Date", render: (d) => formatDayLabel(d.date) },
    { key: "orders", label: "Orders", render: (d) => fmtNumber(d.orders) },
    { key: "grossRevenue", label: "Revenue", render: (d) => currency(d.grossRevenue) },
    {
      key: "totalRecognizedRevenue",
      label: "Recognized Revenue",
      render: (d) => <ValueWithScenario actual={d.totalRecognizedRevenue} scenarioValue={adjOf(d)?.totalRecognizedRevenue} active={scenarioActive} />,
    },
    { key: "spend", label: "Spend", render: (d) => currency(d.spend) },
    {
      key: "totalProductExpense",
      label: "Product Cost",
      render: (d) => <ValueWithScenario actual={d.totalProductExpense} scenarioValue={adjOf(d)?.totalProductExpense} active={scenarioActive} />,
    },
    { key: "operatingExpense", label: "Operating Expense", render: (d) => currency(d.operatingExpense) },
    {
      key: "totalExpenses",
      label: "Total Expenses",
      render: (d) => <ValueWithScenario actual={d.totalExpenses} scenarioValue={adjOf(d)?.totalExpenses} active={scenarioActive} />,
    },
    {
      key: "netProfit",
      label: "Profit",
      render: (d) => (scenarioActive && adjOf(d) ? <ValueWithScenario actual={d.netProfit} scenarioValue={adjOf(d).netProfit} active /> : <ProfitValue value={d.netProfit} />),
    },
    {
      key: "profitMargin",
      label: "Profit Margin",
      render: (d) =>
        scenarioActive && adjOf(d) ? (
          <ValueWithScenario actual={d.profitMargin} scenarioValue={adjOf(d).profitMargin} active kind="percent" />
        ) : (
          <ProfitValue value={d.profitMargin} kind="percent" />
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <LastUpdatedIndicator lastUpdatedAt={lastUpdatedAt} isValidating={isValidating} backgroundError={backgroundError} />
      </div>
      {scenarioActive && scenarioResult && (
        <HalucinateTabBanner scenarioResult={scenarioResult} actualNetProfit={data.totals.netProfit} actualProfitMargin={data.totals.profitMargin} />
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <StatCard
          label="Total Recognized Revenue"
          value={data.totals.totalRecognizedRevenue}
          sub={scenarioActive && scenarioResult ? `Scenario: ${currency(scenarioResult.totalRecognizedRevenue)}` : undefined}
        />
        <StatCard label="Total Expenses" value={data.totals.totalExpenses} sub={scenarioActive && scenarioResult ? `Scenario: ${currency(scenarioResult.totalExpenses)}` : undefined} />
        <StatCard
          label="Net Profit"
          value={data.totals.netProfit}
          tone={data.totals.netProfit >= 0 ? "text-emerald-600" : "text-rose-600"}
          sub={scenarioActive && scenarioResult ? `Scenario: ${currency(scenarioResult.netProfit)}` : undefined}
        />
        <StatCard
          label="Profit Margin"
          value={data.totals.profitMargin}
          kind="percent"
          tone={data.totals.profitMargin >= 0 ? "text-emerald-600" : "text-rose-600"}
          sub={scenarioActive && scenarioResult ? `Scenario: ${percent(scenarioResult.profitMargin)}` : undefined}
        />
      </div>
      <p className="text-[11px] text-slate-400">
        Click a date to see its hour-by-hour Revenue → Expenses → Profit breakdown.
        {scenarioActive && " Recognized Revenue/Product Cost/Total Expenses/Profit/Margin above are HALUCINATE scenario estimates, proportionally adjusted per day (the hourly drill-down still shows actual numbers only)."}
      </p>
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
  const codPrepaidKey = tokenId && accountIds.length > 0 ? profitCacheKey(tokenId, accountIds, since, until) : null;
  const { data, loading, isValidating, error, backgroundError, lastUpdatedAt, refresh } = useSwrFetch(
    codPrepaidKey,
    () => fetchProfitCodPrepaid(tokenId, { accountIds, since, until }),
    {
      staleTimeMs: PROFIT_STALE_MS,
      getCached: () => getCachedProfitCodPrepaid(tokenId, accountIds, since, until),
      setCached: (d) => setCachedProfitCodPrepaid(tokenId, accountIds, since, until, d),
    }
  );
  useForceRefreshOnKeyBump(refreshKey, refresh);

  if (loading) return <SkeletonBlock />;
  if (error) return <ErrorState message={error} />;
  if (!data) return null;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <LastUpdatedIndicator lastUpdatedAt={lastUpdatedAt} isValidating={isValidating} backgroundError={backgroundError} />
      </div>
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
    </div>
  );
}

// ── Product Profitability tab (§22) ─────────────────────────────────
function ProductsTab({ tokenId, accountIds, since, until, refreshKey }) {
  const productsKey = tokenId && accountIds.length > 0 ? profitCacheKey(tokenId, accountIds, since, until) : null;
  const { data, loading, isValidating, error, backgroundError, lastUpdatedAt, refresh } = useSwrFetch(
    productsKey,
    () => fetchProfitProducts(tokenId, { accountIds, since, until }),
    {
      staleTimeMs: PROFIT_STALE_MS,
      getCached: () => getCachedProfitProducts(tokenId, accountIds, since, until),
      setCached: (d) => setCachedProfitProducts(tokenId, accountIds, since, until, d),
    }
  );
  useForceRefreshOnKeyBump(refreshKey, refresh);

  if (loading) return <SkeletonBlock />;
  if (error) return <ErrorState message={error} />;
  if (!data) return null;

  // Phase 18 §6 — this endpoint now matches via the same shared
  // variantId -> sku -> productId -> name tiers every other Profitability
  // endpoint uses (see server/routes/profitability.js resolveProductConfig),
  // so "Matched Via" is shown for transparency and rows are keyed by the
  // matched Product's own id (productDocId) rather than sku, since a
  // product matched only via Variant ID/Product ID may have no sku at all.
  const MATCH_LABELS = { variantId: "Variant ID", sku: "SKU", productId: "Product ID", name: "Name" };
  const columns = [
    { key: "name", label: "Product", render: (p) => <span className="font-medium text-slate-700">{p.name}</span> },
    { key: "sku", label: "SKU", render: (p) => p.sku || <span className="text-slate-400 italic">—</span> },
    {
      key: "matchedVia",
      label: "Matched Via",
      render: (p) => (p.matchedVia ? <span className="badge badge-blue text-[10px]">{MATCH_LABELS[p.matchedVia] || p.matchedVia}</span> : <span className="badge badge-slate text-[10px]">Unmapped</span>),
    },
    { key: "units", label: "Units Sold", render: (p) => fmtNumber(p.units) },
    { key: "productCost", label: "Product Cost", render: (p) => currency(p.productCost) },
    { key: "packagingCost", label: "Packaging", render: (p) => currency(p.packagingCost) },
    { key: "shippingCost", label: "Shipping", render: (p) => currency(p.shippingCost) },
    { key: "otherCost", label: "Other", render: (p) => currency(p.otherCost) },
    { key: "totalCost", label: "Total Cost", render: (p) => <span className="font-semibold text-slate-700">{currency(p.totalCost)}</span> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end -mb-2">
        <LastUpdatedIndicator lastUpdatedAt={lastUpdatedAt} isValidating={isValidating} backgroundError={backgroundError} />
      </div>
      <p className="text-[11px] text-slate-400">Units sold and cost breakdown per product across every order in this range (matched by Variant ID, then SKU, then Product ID, then product name). Configure product costs on the Products page.</p>
      <DataTable
        tableId="profit-products"
        columns={columns}
        data={data.products}
        searchKeys={["name", "sku"]}
        rowKey={(p) => p.productDocId || "unmapped"}
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

  // Phase 18 §4 — HALUCINATE scenario state. 100% local React state, never
  // sent anywhere (see lib/scenarioMath.js for the full design rationale).
  // Phase 19 §3.5 — lifted here (was local to OverviewTab) so it survives
  // switching tabs and can be shared by CampaignsTab/DailyTab, which now
  // also recompute their own numbers under the same scenario.
  const [scenario, setScenario] = useState(emptyScenario);
  const scenarioActive = isScenarioActive(scenario);
  const resetScenario = () => setScenario(emptyScenario);
  // Reset scenario whenever the underlying range/accounts/token change — a
  // scenario built against one date range/account selection shouldn't
  // silently keep applying once the actual numbers underneath it change.
  useEffect(() => {
    setScenario(emptyScenario);
  }, [TOKEN_ID, since, until, JSON.stringify(selectedAccounts)]);

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

  const activeProps = {
    tokenId: TOKEN_ID,
    accountIds: selectedAccounts,
    since,
    until,
    refreshKey,
    // Phase 19 §3.5 — shared HALUCINATE scenario state, so Campaigns/Daily
    // (and Overview, which owns the input panel) all read the exact same
    // overrides. Tabs that don't use scenarios (COD vs Prepaid, Product
    // Profitability) simply ignore these extra props.
    scenario,
    setScenario,
    scenarioActive,
    resetScenario,
  };

  return (
    <div className="min-h-screen pb-16">
      {/* Phase 19 §3.5 — injected ONCE here (always mounted regardless of
          active tab) so the halucinate-* classes are available to
          Campaigns/Daily's HalucinateTabBanner even when Overview (which
          also injects its own copy via HalucinatePanel) isn't mounted. */}
      <style>{HALUCINATE_CSS}</style>
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
