import { Brain, RotateCcw, X, Eraser } from "lucide-react";
import { currency, percent } from "../../lib/format";

// ─────────────────────────────────────────────────────────────
// Phase 18 §4/§12, extended Phase 19 §3 — HALUCINATE scenario/assumption
// mode. Purely presentational + local input wiring; ALL scenario state
// lives in the parent (ProfitabilityPage, see lib/scenarioMath.js for the
// math) as plain React state — this component never calls
// updateProduct/updateProfitSettings/updateExpense/any create/POST/PUT
// function, and never touches an API at all. The visual "HALUCINATE"
// theme (gradient border, glow, badge) below activates purely off the
// `active` prop the parent derives from isScenarioActive(scenario) — i.e.
// the instant any field here holds a value, never a separate manual
// toggle, per §12.
//
// Phase 19 §3 additions, all still 100% local state:
//   - Per-expense-category overrides for Operating Expenses (one input
//     per row of data.expenses.operatingExpenseBreakdown), alongside the
//     original single lump "Operating Expenses (total)" shortcut.
//   - A small reset ("×") control next to EVERY individual input, not
//     just the one global "Reset Assumptions" button.
//   - "Clear Scenario" alongside "Reset All Assumptions" — two labels,
//     identical full-revert behavior (both call onReset), per the Phase
//     19 spec explicitly naming both.
//   - A Scenario Summary list ("Active Overrides — At a Glance") showing
//     every currently-active override as Actual → Scenario (diff), so the
//     user can see everything they've changed in one place instead of
//     hunting through the scattered inline badges.
//
// The scoped <style> block below uses uniquely-prefixed `halucinate-*`
// class names/keyframes so it can never collide with or depend on
// index.css's existing global animations. It's also exported as
// HALUCINATE_CSS so ProfitabilityPage.jsx can inject it ONCE at the
// page's top level (always mounted, regardless of which tab is active) —
// necessary now that Phase 19 §3.5 reuses these same halucinate-* classes
// on the Campaigns/Daily tabs, which don't otherwise mount this panel.
// ─────────────────────────────────────────────────────────────

export default function HalucinatePanel({ scenario, setScenario, active, onReset, data, scenarioResult }) {
  const set = (key) => (e) => setScenario((s) => ({ ...s, [key]: e.target.value }));
  const clear = (key) => () => setScenario((s) => ({ ...s, [key]: "" }));

  const breakdown = data?.expenses?.operatingExpenseBreakdown || [];
  const lumpSet = scenario.operatingExpense !== "";

  const setExpenseOverride = (expenseId) => (e) =>
    setScenario((s) => ({ ...s, operatingExpenseByExpenseId: { ...s.operatingExpenseByExpenseId, [expenseId]: e.target.value } }));
  const clearExpenseOverride = (expenseId) => () =>
    setScenario((s) => ({ ...s, operatingExpenseByExpenseId: { ...s.operatingExpenseByExpenseId, [expenseId]: "" } }));

  const summaryRows = buildScenarioSummaryRows(scenario, data, scenarioResult);

  return (
    <div>
      <style>{HALUCINATE_CSS}</style>
      <div className={`card !p-4 transition-all duration-500 ${active ? "halucinate-card" : ""}`}>
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3.5">
          <div className="flex items-center gap-2.5">
            <span className={`flex items-center justify-center w-9 h-9 rounded-xl transition-all duration-500 ${active ? "halucinate-icon" : "bg-slate-100 text-slate-400"}`}>
              <Brain size={16} />
            </span>
            <div>
              <div className={`text-sm font-display font-semibold transition-all duration-500 ${active ? "halucinate-badge-text" : "text-slate-700"}`}>
                {active ? "🧠 HALUCINATE MODE — Estimated Profit" : "HALUCINATE — What-If Scenario"}
              </div>
              <p className="text-[11px] text-slate-400 max-w-md">
                {active
                  ? "Showing hypothetical numbers only — nothing below is saved or sent to the server."
                  : "Type any assumption below (product cost, spend, COD rate, operating expense…) for an instant estimated profit. Nothing is saved here — use the real Edit/Save controls on Products, Expenses, or the COD Success Rate button for that."}
              </p>
            </div>
          </div>
          {active && (
            <div className="flex items-center gap-1.5 shrink-0">
              <button type="button" className="btn btn-secondary btn-sm" onClick={onReset} title="Empty every override field and exit HALUCINATE mode">
                <Eraser size={13} /> Clear Scenario
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={onReset} title="Same as Clear Scenario — revert every assumption to actual">
                <RotateCcw size={13} /> Reset All Assumptions
              </button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <ScenarioInput label="Product Cost (total)" placeholder={data ? currency(data.expenses.productCost) : "—"} value={scenario.productCost} onChange={set("productCost")} onClear={clear("productCost")} />
          <ScenarioInput label="Packaging Cost (total)" placeholder={data ? currency(data.expenses.packagingCost) : "—"} value={scenario.packagingCost} onChange={set("packagingCost")} onClear={clear("packagingCost")} />
          <ScenarioInput label="Shipping Cost (total)" placeholder={data ? currency(data.expenses.shippingCost) : "—"} value={scenario.shippingCost} onChange={set("shippingCost")} onClear={clear("shippingCost")} />
          <ScenarioInput label="Other Cost (total)" placeholder={data ? currency(data.expenses.otherCost) : "—"} value={scenario.otherCost} onChange={set("otherCost")} onClear={clear("otherCost")} />
          <ScenarioInput
            label="Operating Expenses (total)"
            placeholder={data ? currency(data.expenses.operatingExpense) : "—"}
            value={scenario.operatingExpense}
            onChange={set("operatingExpense")}
            onClear={clear("operatingExpense")}
          />
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            <span className="flex items-center justify-between gap-1">
              <span>Meta Spend (Advertising)</span>
              {(scenario.metaSpend !== "" || scenario.metaSpendPercent !== "") && (
                <ClearButton label="Meta Spend" onClick={() => setScenario((s) => ({ ...s, metaSpend: "", metaSpendPercent: "" }))} />
              )}
            </span>
            <div className="flex gap-1">
              <select
                className="input !py-1.5 !text-xs w-16 shrink-0"
                value={scenario.metaSpendMode}
                onChange={(e) => setScenario((s) => ({ ...s, metaSpendMode: e.target.value }))}
              >
                <option value="flat">₹</option>
                <option value="percent">%</option>
              </select>
              {scenario.metaSpendMode === "flat" ? (
                <input
                  type="number"
                  step="0.01"
                  className="input !py-1.5 !text-xs flex-1 min-w-0"
                  placeholder={data ? currency(data.expenses.advertisingExpense) : "—"}
                  value={scenario.metaSpend}
                  onChange={set("metaSpend")}
                />
              ) : (
                <input
                  type="number"
                  step="1"
                  className="input !py-1.5 !text-xs flex-1 min-w-0"
                  placeholder="e.g. -10"
                  value={scenario.metaSpendPercent}
                  onChange={set("metaSpendPercent")}
                />
              )}
            </div>
          </label>
          <ScenarioInput
            label="COD Success Rate (%)"
            placeholder={data ? `${data.codSuccessRate}%` : "—"}
            value={scenario.codRate}
            onChange={set("codRate")}
            onClear={clear("codRate")}
            min="0"
            max="100"
          />
        </div>

        {breakdown.length > 0 && (
          <div className="mt-3.5 pt-3.5 border-t border-slate-100">
            <div className="flex items-center justify-between flex-wrap gap-1 mb-2">
              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Operating Expenses — Override Individually</div>
              {lumpSet && <span className="text-[10px] text-amber-600">Ignored while "Operating Expenses (total)" above is set</span>}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {breakdown.map((row) => (
                <ScenarioInput
                  key={row.expenseId}
                  label={row.name}
                  sublabel={row.category}
                  placeholder={currency(row.amount)}
                  value={scenario.operatingExpenseByExpenseId?.[row.expenseId] ?? ""}
                  onChange={setExpenseOverride(row.expenseId)}
                  onClear={clearExpenseOverride(row.expenseId)}
                  disabled={lumpSet}
                />
              ))}
            </div>
          </div>
        )}

        {active && scenarioResult && data && (
          <div className="mt-4 pt-3.5 border-t border-violet-200/60 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <ComparisonStat label="Net Profit" actual={data.result.netProfit} scenario={scenarioResult.netProfit} kind="currency" />
            <ComparisonStat label="Profit Margin" actual={data.result.profitMargin} scenario={scenarioResult.profitMargin} kind="percent" />
            <div className="halucinate-improvement">
              <div className="text-[11px] opacity-85">Expected Improvement</div>
              <div className="text-base font-display font-bold">
                {scenarioResult.improvement >= 0 ? "+" : ""}
                {currency(scenarioResult.improvement)}
              </div>
            </div>
          </div>
        )}

        {active && summaryRows.length > 0 && (
          <div className="mt-4 pt-3.5 border-t border-violet-200/60">
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Active Overrides — At a Glance</div>
            <div className="space-y-1">
              {summaryRows.map((r) => (
                <div key={r.label} className="flex items-center justify-between text-xs bg-violet-50/60 rounded-lg px-2.5 py-1.5">
                  <span className="text-slate-600">{r.label}</span>
                  <span className="font-medium text-slate-800">
                    {fmtByKind(r.kind, r.actual)} → {fmtByKind(r.kind, r.scenario)}
                    <span className={`ml-1.5 text-[10px] ${r.scenario - r.actual >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                      ({r.scenario - r.actual >= 0 ? "+" : ""}
                      {fmtByKind(r.kind, r.scenario - r.actual)})
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Phase 19 §3.4 — pure derivation of "which fields currently have an
// active override" for the Scenario Summary list. Kept in this file
// (rather than scenarioMath.js) since it's purely about presentation
// (labels/ordering), not the actual profit formula.
function buildScenarioSummaryRows(scenario, data, scenarioResult) {
  if (!data || !scenarioResult) return [];
  const rows = [];
  if (scenario.productCost !== "") rows.push({ label: "Product Cost", actual: data.expenses.productCost, scenario: scenarioResult.productCost, kind: "currency" });
  if (scenario.packagingCost !== "") rows.push({ label: "Packaging Cost", actual: data.expenses.packagingCost, scenario: scenarioResult.packagingCost, kind: "currency" });
  if (scenario.shippingCost !== "") rows.push({ label: "Shipping Cost", actual: data.expenses.shippingCost, scenario: scenarioResult.shippingCost, kind: "currency" });
  if (scenario.otherCost !== "") rows.push({ label: "Other Cost", actual: data.expenses.otherCost, scenario: scenarioResult.otherCost, kind: "currency" });
  if ((scenario.metaSpendMode === "flat" && scenario.metaSpend !== "") || (scenario.metaSpendMode === "percent" && scenario.metaSpendPercent !== "")) {
    rows.push({ label: "Meta Spend (Advertising)", actual: data.expenses.advertisingExpense, scenario: scenarioResult.advertisingExpense, kind: "currency" });
  }
  if (scenario.codRate !== "") rows.push({ label: "COD Success Rate", actual: data.codSuccessRate, scenario: scenarioResult.codRate, kind: "percent" });
  if (scenario.operatingExpense !== "") {
    rows.push({ label: "Operating Expenses (total, overrides all individual expenses)", actual: data.expenses.operatingExpense, scenario: scenarioResult.operatingExpense, kind: "currency" });
  } else {
    (scenarioResult.operatingExpenseRows || [])
      .filter((r) => r.overridden)
      .forEach((r) => rows.push({ label: r.name, actual: r.actual, scenario: r.scenario, kind: "currency" }));
  }
  return rows;
}

function fmtByKind(kind, v) {
  return kind === "percent" ? percent(v) : currency(v);
}

function ClearButton({ label, onClick }) {
  return (
    <button type="button" onClick={onClick} title={`Reset ${label} to actual`} className="text-slate-300 hover:text-rose-500 transition-colors">
      <X size={11} />
    </button>
  );
}

function ScenarioInput({ label, sublabel, placeholder, value, onChange, onClear, min, max, disabled }) {
  return (
    <label className={`flex flex-col gap-1 text-xs text-slate-500 ${disabled ? "opacity-50" : ""}`}>
      <span className="flex items-center justify-between gap-1 min-w-0">
        <span className="truncate" title={label}>
          {label}
          {sublabel && <span className="text-slate-300"> · {sublabel}</span>}
        </span>
        {value !== "" && onClear && !disabled && <ClearButton label={label} onClick={onClear} />}
      </span>
      <input type="number" min={min} max={max} step="0.01" disabled={disabled} className="input !py-1.5 !text-xs" placeholder={placeholder} value={value} onChange={onChange} />
    </label>
  );
}

function ComparisonStat({ label, actual, scenario, kind }) {
  const fmt = kind === "percent" ? percent : currency;
  const diff = Number(scenario) - Number(actual);
  return (
    <div className="halucinate-compare">
      <div className="text-[11px] opacity-85">{label}</div>
      <div className="text-xs">
        Actual: <span className="font-medium">{fmt(actual)}</span>
      </div>
      <div className="text-sm font-semibold">
        Scenario: {fmt(scenario)}
        <span className="ml-1.5 text-xs opacity-90">
          ({diff >= 0 ? "+" : ""}
          {fmt(diff)})
        </span>
      </div>
    </div>
  );
}

// Reusable everywhere else in the Overview tab (Expenses/Final Result
// cards) to show "Actual: X · Scenario: Y" inline next to a single
// number, using the same `.halucinate-inline-badge` class this file's
// injected <style> block defines below.
export function ValueWithScenario({ actual, scenarioValue, active, kind = "currency" }) {
  const fmt = kind === "percent" ? percent : currency;
  if (!active || scenarioValue === undefined || scenarioValue === null) return <>{fmt(actual)}</>;
  const diff = Number(scenarioValue) - Number(actual);
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
      <span className="text-slate-400 line-through decoration-slate-300 text-xs">{fmt(actual)}</span>
      <span className="halucinate-inline-badge">{fmt(scenarioValue)}</span>
      <span className={`text-[10px] ${diff >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
        ({diff >= 0 ? "+" : ""}
        {fmt(diff)})
      </span>
    </span>
  );
}

// Phase 19 §3.5 — small banner for tabs OTHER than Overview (Campaigns,
// Daily) that don't mount the full HalucinatePanel input form (assumptions
// are edited on Overview only), but still need to visibly flag "you're
// looking at scenario-adjusted numbers right now" and repeat the overall
// scenario profit/margin at the top of the tab. Reuses the exact same
// halucinate-* classes/ComparisonStat styling — no second visual language.
export function HalucinateTabBanner({ scenarioResult, actualNetProfit, actualProfitMargin }) {
  if (!scenarioResult) return null;
  return (
    <div className="halucinate-card rounded-2xl p-3.5 flex flex-wrap items-center gap-4">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="flex items-center justify-center w-8 h-8 rounded-xl halucinate-icon shrink-0">
          <Brain size={14} />
        </span>
        <div className="min-w-0">
          <div className="text-xs font-display font-semibold halucinate-badge-text">HALUCINATE MODE — rows below are scenario-adjusted estimates</div>
          <p className="text-[10px] text-slate-400">Adjusted proportionally to match the Overview tab's assumptions — edit them there.</p>
        </div>
      </div>
      <div className="flex items-center gap-3 ml-auto">
        <ComparisonStat label="Net Profit" actual={actualNetProfit} scenario={scenarioResult.netProfit} kind="currency" />
        <ComparisonStat label="Profit Margin" actual={actualProfitMargin} scenario={scenarioResult.profitMargin} kind="percent" />
      </div>
    </div>
  );
}

export const HALUCINATE_CSS = `
.halucinate-card {
  position: relative;
  border-radius: 1rem;
  border: 1px solid transparent;
  background:
    linear-gradient(#ffffff, #ffffff) padding-box,
    linear-gradient(120deg, #6366f1, #a855f7, #ec4899, #6366f1) border-box;
  background-size: 100% 100%, 300% 300%;
  animation: halucinateBorderShift 6s ease infinite;
  box-shadow: 0 0 0 1px rgba(168, 85, 247, 0.06), 0 10px 28px -10px rgba(139, 92, 246, 0.38);
}
.halucinate-icon {
  background: linear-gradient(120deg, #6366f1, #a855f7);
  color: #ffffff;
  box-shadow: 0 0 14px 1px rgba(168, 85, 247, 0.55);
  animation: halucinatePulseGlow 2.6s ease-in-out infinite;
}
.halucinate-badge-text {
  background: linear-gradient(120deg, #4f46e5, #a21caf, #db2777);
  background-size: 200% 200%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: halucinateBorderShift 5s ease infinite;
}
.halucinate-compare,
.halucinate-improvement {
  border-radius: 0.85rem;
  padding: 0.65rem 0.9rem;
  color: #ffffff;
  background: linear-gradient(120deg, rgba(99, 102, 241, 0.94), rgba(168, 85, 247, 0.94));
  background-size: 200% 200%;
  animation: halucinateBorderShift 6s ease infinite;
}
.halucinate-inline-badge {
  display: inline-block;
  padding: 0.05rem 0.5rem;
  border-radius: 999px;
  font-weight: 600;
  font-size: 0.75rem;
  color: #ffffff;
  background: linear-gradient(120deg, #6366f1, #a855f7);
  box-shadow: 0 0 8px 0 rgba(168, 85, 247, 0.4);
}
@keyframes halucinateBorderShift {
  0% { background-position: 0% 0%, 0% 50%; }
  50% { background-position: 0% 0%, 100% 50%; }
  100% { background-position: 0% 0%, 0% 50%; }
}
@keyframes halucinatePulseGlow {
  0%, 100% { box-shadow: 0 0 10px 0 rgba(168, 85, 247, 0.45); }
  50% { box-shadow: 0 0 18px 3px rgba(168, 85, 247, 0.7); }
}
`;
