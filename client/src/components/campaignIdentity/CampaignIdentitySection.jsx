import { useEffect, useState } from "react";
import { Copy, Check, Plus, Pencil, Trash2, AlertTriangle } from "lucide-react";
import {
  fetchCampaignIdentity,
  addCampaignHistoricalName,
  updateCampaignHistoricalName,
  deleteCampaignHistoricalName,
} from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { invalidateOrderMatchingCaches } from "../../lib/invalidateOrderMatchingCaches";

// ────────────────────────────────────────────────────────────────
// Campaign History Phase — "Campaign Identity" / "Historical Names"
// section for the Campaign Drill drawer. Own state/effect, same
// "can't block or break the rest of the drawer" isolation every other
// drawer section (Ad Sets, Profit, Campaign Activity History) already
// uses — an independent fetch against the new
// GET /campaign-identity/:tokenId/:campaignId, never touching the
// drawer's main details fetch or cache.
//
// Shows: the Campaign ID (the one PERMANENT identity — never
// re-derived from name — copyable, same pattern as the header's own
// copy-id button), the current name, automatically detected historical
// names (read-only, timestamped, written only by the sync layer
// whenever Meta reports a rename — never editable here), and manually
// added historical names (Add/Edit/Delete, stored permanently in
// MongoDB via the new CampaignNameMapping collection — never
// localStorage, per spec). Deleting a manual mapping only ever removes
// that one mapping row; it can never delete campaign history or orders
// (enforced server-side — this UI never offers a "delete everything"
// action). A naming collision (this name already belongs to a
// different campaign) comes back from the server as a warning with the
// conflicting campaign named — "Add Anyway" resubmits with force:true
// to intentionally reassign it, the confirmed "warn, allow override"
// behavior.
// ────────────────────────────────────────────────────────────────

function ConflictWarning({ conflict, onForce }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
      <AlertTriangle size={13} className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        <div>{conflict.message || "This name conflicts with another campaign."}</div>
        <button type="button" className="btn btn-secondary btn-sm mt-1.5" onClick={onForce}>
          Add Anyway
        </button>
      </div>
    </div>
  );
}

export default function CampaignIdentitySection({ tokenId, campaignId }) {
  const [identity, setIdentity] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const [newName, setNewName] = useState("");
  const [newNote, setNewNote] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [addConflict, setAddConflict] = useState(null);

  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState("");
  const [editingNote, setEditingNote] = useState("");
  const [editError, setEditError] = useState("");
  const [editConflict, setEditConflict] = useState(null);

  useEffect(() => {
    if (!tokenId || !campaignId) return undefined;
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchCampaignIdentity(tokenId, campaignId)
      .then((res) => !cancelled && setIdentity(res))
      .catch((err) => !cancelled && setError(err.message || "Failed to load campaign identity"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [tokenId, campaignId]);

  const handleCopyId = async () => {
    try {
      await navigator.clipboard.writeText(campaignId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard permissions denied — silently ignore, button just won't confirm
    }
  };

  const handleAdd = async (force = false) => {
    if (!newName.trim()) return;
    setAdding(true);
    setAddError("");
    try {
      const res = await addCampaignHistoricalName(tokenId, campaignId, {
        historicalName: newName.trim(),
        note: newNote.trim() || undefined,
        force,
      });
      setIdentity((prev) => (prev ? { ...prev, manualMappings: [res.mapping, ...prev.manualMappings] } : prev));
      // Campaign History Phase — a manual mapping just changed order→campaign
      // resolution server-side; clear every page's stale in-memory cache so
      // affected orders stop showing as unmatched until a hard reload.
      invalidateOrderMatchingCaches();
      setNewName("");
      setNewNote("");
      setAddConflict(null);
    } catch (err) {
      if (err.conflict) {
        setAddConflict(err);
      } else {
        setAddError(err.message || "Failed to add historical name");
      }
    } finally {
      setAdding(false);
    }
  };

  const startEdit = (m) => {
    setEditingId(m.id);
    setEditingName(m.historicalName);
    setEditingNote(m.note || "");
    setEditError("");
    setEditConflict(null);
  };

  const handleUpdate = async (mappingId, force = false) => {
    if (!editingName.trim()) return;
    setEditError("");
    try {
      const res = await updateCampaignHistoricalName(tokenId, campaignId, mappingId, {
        historicalName: editingName.trim(),
        note: editingNote.trim(),
        force,
      });
      setIdentity((prev) =>
        prev ? { ...prev, manualMappings: prev.manualMappings.map((m) => (m.id === mappingId ? res.mapping : m)) } : prev
      );
      // Campaign History Phase — same reasoning as handleAdd above.
      invalidateOrderMatchingCaches();
      setEditingId(null);
      setEditConflict(null);
    } catch (err) {
      if (err.conflict) {
        setEditConflict(err);
      } else {
        setEditError(err.message || "Failed to update historical name");
      }
    }
  };

  const handleDelete = async (mappingId) => {
    try {
      await deleteCampaignHistoricalName(tokenId, campaignId, mappingId);
      setIdentity((prev) => (prev ? { ...prev, manualMappings: prev.manualMappings.filter((m) => m.id !== mappingId) } : prev));
      // Campaign History Phase — same reasoning as handleAdd above.
      invalidateOrderMatchingCaches();
    } catch (err) {
      setError(err.message || "Failed to delete historical name");
    }
  };

  if (loading && !identity) {
    return <div className="text-sm text-slate-400">Loading campaign identity…</div>;
  }
  if (error && !identity) {
    return <div className="text-sm text-rose-600">{error}</div>;
  }
  if (!identity) return null;

  return (
    <div className="space-y-4">
      {identity.isDeleted && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold">No Longer Returned By Meta</div>
            <div className="mt-0.5 text-amber-700">
              Meta stopped returning this campaign{identity.noLongerReturnedAt ? ` as of ${formatDateTime(identity.noLongerReturnedAt)}` : ""} —
              its identity, history, and orders are preserved permanently and will never be deleted.
            </div>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
        <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Campaign ID (Permanent Identity)</div>
        <button
          type="button"
          onClick={handleCopyId}
          className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 font-mono mt-1"
          title="Copy campaign ID"
        >
          {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
          {campaignId}
        </button>
        <div className="text-sm font-display font-semibold text-slate-800 mt-2">{identity.currentName || "Untitled Campaign"}</div>
      </div>

      <div>
        <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400 mb-2">Historical Names</div>

        {identity.autoHistoricalNames.length === 0 && identity.manualMappings.length === 0 ? (
          <div className="text-xs text-slate-400">No other names recorded for this campaign yet.</div>
        ) : (
          <div className="space-y-2">
            {identity.autoHistoricalNames.map((n) => (
              <div key={`auto:${n.name}`} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm text-slate-700 truncate">{n.name}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">Last seen {formatDateTime(n.lastSeenAt)}</div>
                </div>
                <span className="badge badge-slate shrink-0">Auto-detected</span>
              </div>
            ))}

            {identity.manualMappings.map((m) => (
              <div key={m.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                {editingId === m.id ? (
                  <div className="space-y-2">
                    <input className="input !text-sm !py-1.5" value={editingName} onChange={(e) => setEditingName(e.target.value)} autoFocus />
                    <input
                      className="input !text-sm !py-1.5"
                      placeholder="Note (optional)"
                      value={editingNote}
                      onChange={(e) => setEditingNote(e.target.value)}
                    />
                    {editError && <div className="text-xs text-rose-600">{editError}</div>}
                    {editConflict && <ConflictWarning conflict={editConflict} onForce={() => handleUpdate(m.id, true)} />}
                    <div className="flex gap-2">
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => handleUpdate(m.id)}>
                        Save
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                          setEditingId(null);
                          setEditConflict(null);
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm text-slate-700 truncate">{m.historicalName}</div>
                      {m.note && <div className="text-xs text-slate-500 mt-0.5">{m.note}</div>}
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        Added {formatDateTime(m.createdAt)}
                        {m.createdBy ? ` by ${m.createdBy}` : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="badge badge-slate">Manual</span>
                      <button type="button" className="text-slate-400 hover:text-slate-600 p-1" onClick={() => startEdit(m)} title="Edit">
                        <Pencil size={13} />
                      </button>
                      <button type="button" className="text-slate-400 hover:text-rose-600 p-1" onClick={() => handleDelete(m.id)} title="Delete">
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

      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-3 space-y-2">
        <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">+ Add Historical Name</div>
        <div className="flex gap-2">
          <input
            className="input !text-sm"
            placeholder="An old / alternate name this campaign used to have…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
          <button type="button" className="btn btn-primary btn-sm shrink-0" onClick={() => handleAdd()} disabled={adding || !newName.trim()}>
            <Plus size={14} /> Add
          </button>
        </div>
        <input
          className="input !text-sm"
          placeholder="Note (optional) — e.g. why this name was used"
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
        />
        {addError && <div className="text-xs text-rose-600">{addError}</div>}
        {addConflict && <ConflictWarning conflict={addConflict} onForce={() => handleAdd(true)} />}
      </div>
    </div>
  );
}
