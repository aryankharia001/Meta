import { X } from "lucide-react";

// Phase 8 — the long tail of Campaign Explorer's additional filters,
// split out of the main filter bar into its own popover so the top of
// the page doesn't turn into a wall of controls. All filtering happens
// client-side over the already-fetched campaign list (see
// CampaignExplorerPage.jsx's `filteredCampaigns` useMemo) — none of
// these trigger a re-fetch from Meta.

export const DEFAULT_FILTERS = {
  status: "",
  objective: "",
  accountId: "",
  activePaused: "", // "" | "active" | "paused"
  minRevenue: "",
  minOrders: "",
  minRoas: "",
  minSpend: "",
  minProfit: "",
  codOnly: false,
  prepaidOnly: false,
  minDelivered: "",
  minPending: "",
  minCancelled: "",
  minReturned: "",
};

export function applyExplorerFilters(campaigns, filters) {
  return campaigns.filter((c) => {
    if (filters.status && (c.effectiveStatus || c.status) !== filters.status) return false;
    if (filters.objective && c.objective !== filters.objective) return false;
    if (filters.accountId && c.accountId !== filters.accountId) return false;
    if (filters.activePaused === "active" && c.effectiveStatus !== "ACTIVE") return false;
    if (filters.activePaused === "paused" && !["PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED"].includes(c.effectiveStatus)) return false;
    if (filters.minRevenue !== "" && c.revenue < Number(filters.minRevenue)) return false;
    if (filters.minOrders !== "" && c.totalOrders < Number(filters.minOrders)) return false;
    if (filters.minRoas !== "" && c.roas < Number(filters.minRoas)) return false;
    if (filters.minSpend !== "" && c.spend < Number(filters.minSpend)) return false;
    if (filters.minProfit !== "" && c.profit < Number(filters.minProfit)) return false;
    if (filters.codOnly && c.codOrders === 0) return false;
    if (filters.prepaidOnly && c.prepaidOrders === 0) return false;
    if (filters.minDelivered !== "" && c.delivered < Number(filters.minDelivered)) return false;
    if (filters.minPending !== "" && c.pending < Number(filters.minPending)) return false;
    if (filters.minCancelled !== "" && c.cancelled < Number(filters.minCancelled)) return false;
    if (filters.minReturned !== "" && c.returned < Number(filters.minReturned)) return false;
    return true;
  });
}

export function countActiveFilters(filters) {
  return Object.entries(filters).filter(([k, v]) => v !== "" && v !== false).length;
}

export default function MoreFiltersPanel({ filters, onChange, options, onClose, onClear }) {
  const set = (key, value) => onChange({ ...filters, [key]: value });

  return (
    <div className="absolute right-0 mt-2 w-[420px] bg-white border border-slate-200 rounded-xl shadow-2xl z-30 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display font-semibold text-sm text-slate-800">More Filters</h3>
        <button type="button" className="text-slate-400 hover:text-slate-600" onClick={onClose}>
          <X size={15} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Campaign Status">
          <select className="input !py-1.5 !text-xs" value={filters.status} onChange={(e) => set("status", e.target.value)}>
            <option value="">All</option>
            {options.statuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Ad Account">
          <select className="input !py-1.5 !text-xs" value={filters.accountId} onChange={(e) => set("accountId", e.target.value)}>
            <option value="">All</option>
            {options.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Objective">
          <select className="input !py-1.5 !text-xs" value={filters.objective} onChange={(e) => set("objective", e.target.value)}>
            <option value="">All</option>
            {options.objectives.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Active / Paused">
          <select className="input !py-1.5 !text-xs" value={filters.activePaused} onChange={(e) => set("activePaused", e.target.value)}>
            <option value="">All</option>
            <option value="active">Active only</option>
            <option value="paused">Paused only</option>
          </select>
        </Field>

        <NumField label="Minimum Revenue" value={filters.minRevenue} onChange={(v) => set("minRevenue", v)} />
        <NumField label="Minimum Orders" value={filters.minOrders} onChange={(v) => set("minOrders", v)} />
        <NumField label="Minimum ROAS" value={filters.minRoas} onChange={(v) => set("minRoas", v)} step="0.1" />
        <NumField label="Minimum Spend" value={filters.minSpend} onChange={(v) => set("minSpend", v)} />
        {/* Phase 19 §4 — relabeled "Minimum Profit" → "Minimum Gross Profit"
            for the same reason as every other "Profit" label in Campaign
            Explorer: this filters on c.profit (Revenue − Ad Spend only),
            not Profitability's real Net Profit. Filter logic untouched. */}
        <NumField label="Minimum Gross Profit" value={filters.minProfit} onChange={(v) => set("minProfit", v)} />
        <NumField label="Min. Delivered Orders" value={filters.minDelivered} onChange={(v) => set("minDelivered", v)} />
        <NumField label="Min. Pending Orders" value={filters.minPending} onChange={(v) => set("minPending", v)} />
        <NumField label="Min. Cancelled Orders" value={filters.minCancelled} onChange={(v) => set("minCancelled", v)} />
        <NumField label="Min. Returned Orders" value={filters.minReturned} onChange={(v) => set("minReturned", v)} />
      </div>

      <div className="flex items-center gap-4 mt-3">
        <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
          <input type="checkbox" checked={filters.codOnly} onChange={(e) => set("codOnly", e.target.checked)} /> COD only
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
          <input type="checkbox" checked={filters.prepaidOnly} onChange={(e) => set("prepaidOnly", e.target.checked)} /> Prepaid only
        </label>
      </div>

      <button type="button" className="text-xs text-blue-600 hover:underline mt-3" onClick={onClear}>
        Clear all filters
      </button>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1 text-[11px] text-slate-500">
      {label}
      {children}
    </label>
  );
}

function NumField({ label, value, onChange, step = "1" }) {
  return (
    <Field label={label}>
      <input type="number" step={step} className="input !py-1.5 !text-xs" placeholder="Any" value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}
