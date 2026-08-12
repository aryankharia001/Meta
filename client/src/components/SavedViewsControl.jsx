import { useEffect, useRef, useState } from "react";
import { Bookmark, Plus, Pencil, Trash2, Check, X } from "lucide-react";
import { fetchSavedViews, createSavedView, renameSavedView, deleteSavedView, logActivity } from "../lib/api";

// ────────────────────────────────────────────────────────────────
// Phase 7 — Saved Filters & Views. A small reusable dropdown any page
// with its own filter state can drop in: pass a `page` key (so views
// don't leak across pages), a `getFilters()` snapshot function, and an
// `applyFilters(filters)` callback that sets that page's own state.
// This component never touches what those filters mean to the page —
// it only persists/restores whatever plain object the page hands it,
// via the new /api/saved-views routes.
// ────────────────────────────────────────────────────────────────

export default function SavedViewsControl({ page, getFilters, applyFilters }) {
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const load = () => {
    setLoading(true);
    fetchSavedViews(page)
      .then((res) => setViews(res.views || []))
      .catch(() => setViews([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleSave = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const res = await createSavedView(newName.trim(), page, getFilters());
      setViews((prev) => [res.view, ...prev]);
      logActivity("saved-view", `Saved view "${newName.trim()}" on ${page}`, { page });
      setNewName("");
    } catch {
      // best-effort — dropdown just won't show the new entry
    } finally {
      setSaving(false);
    }
  };

  const handleApply = (view) => {
    applyFilters(view.filters || {});
    setOpen(false);
  };

  const handleRename = async (id) => {
    if (!editingName.trim()) return;
    try {
      const res = await renameSavedView(id, editingName.trim());
      setViews((prev) => prev.map((v) => (v.id === id ? res.view : v)));
      setEditingId(null);
    } catch {
      // leave list as-is on failure
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteSavedView(id);
      setViews((prev) => prev.filter((v) => v.id !== id));
    } catch {
      // leave list as-is on failure
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen((o) => !o)}>
        <Bookmark size={13} /> Views {views.length > 0 ? `(${views.length})` : ""}
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-72 bg-white border border-slate-200 rounded-lg shadow-lg z-30 py-2">
          <div className="px-3 pb-2 flex gap-1.5">
            <input
              className="input !py-1.5 !text-xs flex-1"
              placeholder="Save current filters as…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
            />
            <button type="button" className="btn btn-primary btn-sm !px-2" onClick={handleSave} disabled={saving || !newName.trim()}>
              <Plus size={13} />
            </button>
          </div>

          <div className="max-h-64 overflow-y-auto border-t border-slate-100">
            {loading ? (
              <div className="px-3 py-3 text-xs text-slate-400">Loading…</div>
            ) : views.length === 0 ? (
              <div className="px-3 py-3 text-xs text-slate-400">No saved views yet for this page.</div>
            ) : (
              views.map((v) => (
                <div key={v.id} className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-slate-50">
                  {editingId === v.id ? (
                    <div className="flex items-center gap-1 flex-1">
                      <input
                        className="input !py-1 !text-xs flex-1"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleRename(v.id)}
                        autoFocus
                      />
                      <button type="button" className="text-emerald-600 p-1" onClick={() => handleRename(v.id)}>
                        <Check size={13} />
                      </button>
                      <button type="button" className="text-slate-400 p-1" onClick={() => setEditingId(null)}>
                        <X size={13} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <button type="button" className="text-left text-xs text-slate-700 flex-1 truncate" onClick={() => handleApply(v)}>
                        {v.name}
                      </button>
                      <button
                        type="button"
                        className="text-slate-400 hover:text-slate-600 p-1"
                        onClick={() => {
                          setEditingId(v.id);
                          setEditingName(v.name);
                        }}
                        title="Rename"
                      >
                        <Pencil size={12} />
                      </button>
                      <button type="button" className="text-slate-400 hover:text-rose-600 p-1" onClick={() => handleDelete(v.id)} title="Delete">
                        <Trash2 size={12} />
                      </button>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
