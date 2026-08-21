import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Wallet, Gauge, TrendingUp } from "lucide-react";
import { fetchCampaignCurrent, fetchAdSetCurrent, syncEntityNow } from "../../lib/api";
import { formatBudget } from "../../lib/campaignDisplay";
import { currency, formatDateTime } from "../../lib/format";

// Phase 27 §1/§11 — "Current Values" block for the Budget & Bid Cap
// Control section: always-fresh Budget/Bid Cap/Bid Strategy (the GET
// .../current endpoint does a live Meta reconcile before responding),
// Edit buttons, and an explicit Refresh/Sync action.
export default function CurrentValuesCard({ level, tokenId, entityId, onEditBudget, onEditBidCap }) {
  const [current, setCurrent] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [syncedAt, setSyncedAt] = useState(null);

  const load = useCallback(
    async (isManualSync = false) => {
      setLoading(true);
      setError(null);
      try {
        const fn = isManualSync ? syncEntityNow : level === "adset" ? fetchAdSetCurrent : fetchCampaignCurrent;
        const res = isManualSync ? await syncEntityNow(tokenId, level, entityId) : await fn(tokenId, entityId);
        setCurrent(res.current);
        setSyncedAt(new Date());
      } catch (err) {
        setError(err.response?.data?.message || err.message || "Failed to load current values");
      } finally {
        setLoading(false);
      }
    },
    [tokenId, entityId, level]
  );

  useEffect(() => {
    load(false);
  }, [load]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-slate-700">Current Values</div>
        <button
          type="button"
          className="btn btn-secondary btn-sm flex items-center gap-1.5"
          onClick={() => load(true)}
          disabled={loading}
          title="Check Meta for the latest values"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Refresh / Sync
        </button>
      </div>

      {error && <div className="text-sm text-rose-600 mb-2">{error}</div>}

      {!current && loading && <div className="text-sm text-slate-400">Loading…</div>}

      {current && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-lg bg-slate-50 border border-slate-100 p-3">
            <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
              <Wallet size={14} /> Current Budget
            </div>
            <div className="text-lg font-semibold text-slate-800">{formatBudget(current.budget, current.budgetType) || "N/A"}</div>
            <button type="button" className="text-xs text-indigo-600 hover:underline mt-1" onClick={() => onEditBudget?.(current)}>
              Edit
            </button>
          </div>

          <div className="rounded-lg bg-slate-50 border border-slate-100 p-3">
            <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
              <Gauge size={14} /> Current Bid Cap
            </div>
            {level === "adset" ? (
              <>
                <div className="text-lg font-semibold text-slate-800">
                  {current.bidAmount !== null && current.bidAmount !== undefined ? currency(current.bidAmount) : "Not set"}
                </div>
                <button type="button" className="text-xs text-indigo-600 hover:underline mt-1" onClick={() => onEditBidCap?.(current)}>
                  Edit
                </button>
              </>
            ) : (
              <div className="text-sm text-slate-500">Set at Ad Set level — open an ad set to edit its bid cap.</div>
            )}
          </div>

          <div className="rounded-lg bg-slate-50 border border-slate-100 p-3">
            <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
              <TrendingUp size={14} /> Bid Strategy
            </div>
            <div className="text-sm font-medium text-slate-700">{current.bidStrategy || "N/A"}</div>
          </div>
        </div>
      )}

      {syncedAt && <div className="text-[11px] text-slate-400 mt-2">Last synced: {formatDateTime(syncedAt)}</div>}
    </div>
  );
}
