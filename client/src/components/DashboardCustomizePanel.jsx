import { useRef, useState } from "react";
import { GripVertical, Eye, EyeOff, Pin, PinOff, RotateCcw, X, LayoutGrid, Maximize2, Minimize2 } from "lucide-react";

// Phase 7 — Dashboard Customization panel: show/hide, pin, and
// drag-drop reorder for the KPI cards. A plain popover (not a modal)
// so the grid stays visible behind it while dragging — reordering here
// updates dashboardLayout's `order` array, which Dashboard.jsx's
// `arrange()` call re-applies to its own already-computed cardList on
// every render, so this never touches how any card's number is derived.
export default function DashboardCustomizePanel({ items, layout, toggleHidden, togglePinned, toggleWide, reorder, reset, onClose }) {
  const [dragKey, setDragKey] = useState(null);
  const panelRef = useRef(null);

  return (
    <div className="absolute right-0 top-full mt-2 w-80 bg-white border border-slate-200 rounded-xl shadow-2xl z-30 py-2" ref={panelRef}>
      <div className="flex items-center justify-between px-3.5 pb-2 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <LayoutGrid size={14} className="text-slate-400" />
          <span className="font-display font-semibold text-sm text-slate-800">Customize Dashboard</span>
        </div>
        <button type="button" className="text-slate-400 hover:text-slate-600" onClick={onClose}>
          <X size={15} />
        </button>
      </div>

      <p className="px-3.5 py-2 text-[11px] text-slate-400">Drag to reorder · click the eye to hide · click the pin to pin to front.</p>

      <div className="max-h-80 overflow-y-auto">
        {items.map((c) => {
          const hidden = layout.hidden.includes(c.key);
          const pinned = layout.pinned.includes(c.key);
          const wide = (layout.wide || []).includes(c.key);
          return (
            <div
              key={c.key}
              draggable
              onDragStart={() => setDragKey(c.key)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dragKey && dragKey !== c.key) reorder(dragKey, c.key);
                setDragKey(null);
              }}
              onDragEnd={() => setDragKey(null)}
              className={`flex items-center gap-2 px-3.5 py-2 hover:bg-slate-50 cursor-grab active:cursor-grabbing ${
                dragKey === c.key ? "opacity-40" : ""
              } ${hidden ? "opacity-50" : ""}`}
            >
              <GripVertical size={13} className="text-slate-300 shrink-0" />
              <c.icon size={13} className="text-slate-400 shrink-0" />
              <span className="text-xs text-slate-700 flex-1 truncate">{c.label}</span>
              <button
                type="button"
                onClick={() => toggleWide(c.key)}
                className={`p-1 rounded ${wide ? "text-indigo-500" : "text-slate-300 hover:text-slate-500"}`}
                title={wide ? "Shrink to normal width" : "Widen (span 2 columns)"}
              >
                {wide ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              </button>
              <button
                type="button"
                onClick={() => togglePinned(c.key)}
                className={`p-1 rounded ${pinned ? "text-amber-500" : "text-slate-300 hover:text-slate-500"}`}
                title={pinned ? "Unpin" : "Pin to front"}
              >
                {pinned ? <Pin size={13} fill="currentColor" /> : <PinOff size={13} />}
              </button>
              <button
                type="button"
                onClick={() => toggleHidden(c.key)}
                className={`p-1 rounded ${hidden ? "text-slate-300 hover:text-slate-500" : "text-slate-500 hover:text-slate-700"}`}
                title={hidden ? "Show" : "Hide"}
              >
                {hidden ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
          );
        })}
      </div>

      <div className="px-3.5 pt-2 border-t border-slate-100">
        <button type="button" className="btn btn-secondary btn-sm w-full" onClick={reset}>
          <RotateCcw size={12} /> Reset to default
        </button>
      </div>
    </div>
  );
}
