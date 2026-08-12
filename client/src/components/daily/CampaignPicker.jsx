import { useEffect, useRef, useState } from "react";
import { Megaphone, ChevronDown } from "lucide-react";

// ────────────────────────────────────────────────────────────────
// Phase 10 (campaign selection) — multi-select campaign filter for the
// Daily page. Same checkbox-list-in-a-popover pattern DailyPage's own
// AccountsPicker (and Dashboard's AccountsPicker) already use, scoped
// to campaigns instead of ad accounts — a plain dropdown list to check
// campaigns off, no search-to-filter step required. An empty selection
// means "All Campaigns" — the picker never forces a choice, it only
// narrows one down.
// ────────────────────────────────────────────────────────────────

export default function CampaignPicker({ options, selected, onToggle, onSelectAll, onClear }) {
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
        <Megaphone size={14} />
        {selected.size === 0 ? "All Campaigns" : `${selected.size} Campaign${selected.size === 1 ? "" : "s"}`}
        <ChevronDown size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute z-30 mt-2 w-80 max-h-96 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-xl p-2">
          <div className="flex gap-3 px-1 pb-2 mb-1 border-b border-slate-100">
            <button type="button" className="text-xs font-medium text-blue-600 hover:underline" onClick={() => onSelectAll(options.map((o) => o.key))}>
              Select all
            </button>
            <button type="button" className="text-xs font-medium text-slate-400 hover:underline" onClick={onClear}>
              Clear (All Campaigns)
            </button>
          </div>
          {options.length === 0 && <div className="text-xs text-slate-400 px-2 py-3">No campaigns in this date range.</div>}
          {options.map((o) => (
            <label key={o.key} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 text-sm cursor-pointer">
              <input type="checkbox" checked={selected.has(o.key)} onChange={() => onToggle(o.key)} />
              <span className="truncate">{o.campaignName}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
