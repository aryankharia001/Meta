import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, FileText } from "lucide-react";
import { fetchEntityNotes, addEntityNote, updateEntityNote, deleteEntityNote, logActivity } from "../lib/api";
import { usePreferences } from "../lib/PreferencesContext";
import { formatDateTime } from "../lib/format";

// ────────────────────────────────────────────────────────────────
// Phase 7 — reusable notes panel for campaigns and customers (orders
// keep their own inline notes UI in OrderDrawer.jsx from Phase 4,
// untouched). Same Author/Timestamp/Last-Edited/CRUD shape as that
// original implementation, just generalized so it isn't copy-pasted a
// third time. Talks only to the new /api/entity-notes routes.
// ────────────────────────────────────────────────────────────────

export default function EntityNotesPanel({ entityType, entityId }) {
  const { prefs } = usePreferences();
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingText, setEditingText] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!entityId) return;
    setLoading(true);
    fetchEntityNotes(entityType, entityId)
      .then((res) => setNotes(res.notes || []))
      .catch((err) => setError(err.message || "Failed to load notes"))
      .finally(() => setLoading(false));
  }, [entityType, entityId]);

  const handleAdd = async () => {
    if (!text.trim()) return;
    setSaving(true);
    setError("");
    try {
      const res = await addEntityNote(entityType, entityId, text.trim(), prefs.authorName || null);
      setNotes((prev) => [res.note, ...prev]);
      logActivity("note", `Note added to ${entityType} ${entityId}`, { entityType, entityId });
      setText("");
    } catch (err) {
      setError(err.message || "Failed to add note");
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (n) => {
    setEditingId(n.id);
    setEditingText(n.text);
  };

  const handleUpdate = async (noteId) => {
    if (!editingText.trim()) return;
    try {
      const res = await updateEntityNote(noteId, editingText.trim(), prefs.authorName || null);
      setNotes((prev) => prev.map((n) => (n.id === noteId ? res.note : n)));
      logActivity("note", `Note edited on ${entityType} ${entityId}`, { entityType, entityId });
      setEditingId(null);
    } catch (err) {
      setError(err.message || "Failed to update note");
    }
  };

  const handleDelete = async (noteId) => {
    try {
      await deleteEntityNote(noteId);
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
    } catch (err) {
      setError(err.message || "Failed to delete note");
    }
  };

  return (
    <div>
      <div className="flex gap-2 mb-4">
        <input
          className="input !text-sm"
          placeholder={`Add a note about this ${entityType}…`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
        />
        <button type="button" className="btn btn-primary btn-sm shrink-0" onClick={handleAdd} disabled={saving || !text.trim()}>
          <Plus size={14} /> Add
        </button>
      </div>

      {error && <div className="text-xs text-rose-600 mb-3">{error}</div>}

      {loading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="card !p-3.5 h-16 animate-pulse bg-slate-100" />
          ))}
        </div>
      ) : notes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center px-4">
          <span className="flex items-center justify-center w-10 h-10 rounded-2xl bg-slate-100 text-slate-400 mb-2.5">
            <FileText size={18} />
          </span>
          <div className="text-sm text-slate-400">No notes yet. Add one above.</div>
        </div>
      ) : (
        <div className="space-y-2.5">
          {notes.map((n) => (
            <div key={n.id} className="card !p-3.5">
              {editingId === n.id ? (
                <div className="flex gap-2">
                  <input
                    className="input !text-sm !py-1.5"
                    value={editingText}
                    onChange={(e) => setEditingText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleUpdate(n.id)}
                    autoFocus
                  />
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => handleUpdate(n.id)}>
                    Save
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditingId(null)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-slate-700 whitespace-pre-wrap break-words">{n.text}</p>
                    <p className="text-[11px] text-slate-400 mt-1">
                      {n.author && <span className="font-medium text-slate-500">{n.author}</span>}
                      {n.author && " · "}
                      {formatDateTime(n.createdAt)}
                      {n.updatedAt && n.updatedAt !== n.createdAt ? ` (edited ${formatDateTime(n.updatedAt)})` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button type="button" className="text-slate-400 hover:text-slate-600 p-1" onClick={() => startEdit(n)} title="Edit">
                      <Pencil size={13} />
                    </button>
                    <button type="button" className="text-slate-400 hover:text-rose-600 p-1" onClick={() => handleDelete(n.id)} title="Delete">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
