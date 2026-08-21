import { useEffect, useState } from "react";
import { X, ArrowRight } from "lucide-react";
import { useOverlayEscape } from "../../lib/overlayStack";
import { fetchChangeCompare } from "../../lib/api";
import { currency, number, multiplier, formatDateTime } from "../../lib/format";

// Phase 27 §9 — Before vs After comparison modal for one Budget or Bid
// Cap change. Orders/Revenue/Prepaid/COD/Profit come from stored
// Shiprocket orders (exact timestamps); Spend/ROAS/CPA come from Meta's
// hourly breakdown (see server/lib/controlHelpers.js) — hour-level
// precision, surfaced honestly via `spendAvailable`/`spendGranularity`
// rather than presented as exact-to-the-minute.
const ROWS = [
  { key: "spend", label: "Spend", fmt: currency },
  { key: "orders", label: "Orders", fmt: number },
  { key: "prepaidOrders", label: "Prepaid", fmt: number },
  { key: "codOrders", label: "COD", fmt: number },
  { key: "revenue", label: "Revenue", fmt: currency },
  { key: "roas", label: "ROAS", fmt: multiplier },
  { key: "cpa", label: "CPA", fmt: currency },
  { key: "profit", label: "Profit", fmt: currency },
];

export default function BeforeAfterCompare({ level, tokenId, entityId, changeId, type, onClose }) {
  useOverlayEscape(true, onClose);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchChangeCompare(tokenId, level, entityId, { changeId, type });
        if (!cancelled) setData(res);
      } catch (err) {
        if (!cancelled) setError(err.response?.data?.message || err.message || "Failed to load comparison");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [tokenId, level, entityId, changeId, type]);

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div className="font-display font-semibold text-slate-800">
            Before vs After — {type === "bid_cap" ? "Bid Cap" : "Budget"} Change
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        {loading && <div className="text-sm text-slate-400">Loading…</div>}
        {error && <div className="text-sm text-rose-600">{error}</div>}

        {data && (
          <>
            <div className="flex items-center justify-center gap-3 mb-4 text-sm">
              <span className="font-semibold text-slate-700">{currency(data.change.from)}</span>
              <ArrowRight size={16} className="text-slate-400" />
              <span className="font-semibold text-slate-700">{currency(data.change.to)}</span>
              <span className="text-xs text-slate-400">at {formatDateTime(data.change.at)}</span>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="text-xs text-slate-400 mb-2">
                  Before · {formatDateTime(data.before.window.from)} – {formatDateTime(data.before.window.to)}
                </div>
                {ROWS.map((r) => (
                  <div key={r.key} className="flex items-center justify-between text-sm py-1">
                    <span className="text-slate-500">{r.label}</span>
                    <span className="font-medium text-slate-700">{r.fmt(data.before[r.key])}</span>
                  </div>
                ))}
                {!data.before.spendAvailable && (
                  <div className="text-[11px] text-amber-600 mt-2">Meta spend data not available for this window.</div>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 p-4">
                <div className="text-xs text-slate-400 mb-2">
                  After · {formatDateTime(data.after.window.from)} – {formatDateTime(data.after.window.to)}
                </div>
                {ROWS.map((r) => (
                  <div key={r.key} className="flex items-center justify-between text-sm py-1">
                    <span className="text-slate-500">{r.label}</span>
                    <span className="font-medium text-slate-700">{r.fmt(data.after[r.key])}</span>
                  </div>
                ))}
                {!data.after.spendAvailable && (
                  <div className="text-[11px] text-amber-600 mt-2">Meta spend data not available for this window.</div>
                )}
              </div>
            </div>

            <div className="text-[11px] text-slate-400 mt-3">
              Spend is summed from Meta's hourly breakdown (hour-level precision), not exact-to-the-minute.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
