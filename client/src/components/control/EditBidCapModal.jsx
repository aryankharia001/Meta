import { useState } from "react";
import { X, Gauge } from "lucide-react";
import { useOverlayEscape } from "../../lib/overlayStack";
import { updateAdSetBidCap } from "../../lib/api";

// Phase 27 §4/§12 — Edit Bid Cap modal. Ad Set level only — Meta's
// Graph API has no editable campaign-level bid cap (see
// routes/campaignControl.js's header comment), so this is only ever
// rendered from AdSetDrawer.
export default function EditBidCapModal({ open, tokenId, entityId, currentBidAmount, onClose, onSuccess }) {
  useOverlayEscape(open, onClose);
  const [bidAmount, setBidAmount] = useState(currentBidAmount ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  if (!open) return null;

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await updateAdSetBidCap(tokenId, entityId, { bidAmount: Number(bidAmount) });
      onSuccess?.(res);
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Failed to update bid cap");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600">
              <Gauge size={20} />
            </span>
            <div className="font-display font-semibold text-slate-800">Edit Bid Cap</div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="text-xs text-slate-500">Bid Cap (₹)</span>
            <input
              type="number"
              min="1"
              step="0.01"
              className="input w-full mt-1"
              value={bidAmount}
              onChange={(e) => setBidAmount(e.target.value)}
              autoFocus
            />
          </label>

          {error && <div className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg p-2">{error}</div>}
        </div>

        <div className="flex gap-2 mt-5">
          <button type="button" className="btn btn-secondary flex-1 justify-center" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary flex-1 justify-center"
            onClick={handleSave}
            disabled={saving || !bidAmount || Number(bidAmount) <= 0}
          >
            {saving ? "Saving…" : error ? "Retry" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
