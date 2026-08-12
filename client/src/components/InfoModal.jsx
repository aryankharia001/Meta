import { useEffect } from "react";
import { X } from "lucide-react";

// Small shared placeholder modal — used by CampaignDrawer for KPI-card
// clicks ("designed as clickable... for future phases") and order-row
// clicks (Phase 3 stub). Not wired into Dashboard.jsx's own KPI modal,
// which stays exactly as Phase 1 left it.
export default function InfoModal({ open, title, subtitle, icon: Icon, accentClass, body, onClose }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3 min-w-0">
            {Icon && (
              <span className={`flex items-center justify-center w-10 h-10 rounded-xl shrink-0 ${accentClass || "bg-slate-100 text-slate-500"}`}>
                <Icon size={20} />
              </span>
            )}
            <div className="min-w-0">
              <div className="font-display font-semibold text-slate-800 truncate">{title}</div>
              {subtitle && <div className="text-xs text-slate-400 truncate">{subtitle}</div>}
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 shrink-0">
            <X size={18} />
          </button>
        </div>

        <div className="bg-slate-50 border border-dashed border-slate-200 rounded-xl p-5 text-sm text-slate-500 leading-relaxed">
          {body}
        </div>

        <button type="button" className="btn btn-secondary w-full justify-center mt-4" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
