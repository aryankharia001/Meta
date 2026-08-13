import { useState } from "react";
import { ImageOff, X } from "lucide-react";
import AdLink from "./AdLink";
import { LiveIndicator } from "./CampaignCells";
import { isLiveStatus } from "../lib/campaignDisplay";

// Phase 13 §5 — small thumbnail (keeps table rows compact) that opens a
// larger preview on click, per spec: "clearly visible but not make the
// table unnecessarily large... clicking opens a larger preview."
export function AdThumbnail({ url, alt, size = 36 }) {
  const [open, setOpen] = useState(false);

  if (!url) {
    return (
      <div
        className="flex items-center justify-center rounded-md bg-slate-100 text-slate-300 shrink-0"
        style={{ width: size, height: size }}
        title="No thumbnail available"
      >
        <ImageOff size={14} />
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className="shrink-0 rounded-md overflow-hidden border border-slate-200 hover:ring-2 hover:ring-blue-300 transition-shadow"
        style={{ width: size, height: size }}
        title="Click to preview"
      >
        <img src={url} alt={alt || "Ad thumbnail"} className="w-full h-full object-cover" loading="lazy" />
      </button>
      {open && (
        <div
          className="fixed inset-0 z-[100] bg-slate-900/70 flex items-center justify-center p-6"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(false);
          }}
        >
          <div className="relative max-w-xl max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
            <img src={url} alt={alt || "Ad creative preview"} className="max-w-full max-h-[80vh] rounded-lg shadow-2xl" />
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute -top-3 -right-3 bg-white rounded-full p-1.5 shadow-lg text-slate-600 hover:text-slate-900"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export function AdNameCell({ tokenId, adId, adName, adsetId, adsetName, campaignId, campaignName, since, until, status, thumbnailUrl, showId = true }) {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <AdThumbnail url={thumbnailUrl} alt={adName} />
      <div className="min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          {isLiveStatus(status) && <LiveIndicator status={status} />}
          <AdLink
            tokenId={tokenId}
            adId={adId}
            adName={adName}
            adsetId={adsetId}
            adsetName={adsetName}
            campaignId={campaignId}
            campaignName={campaignName}
            since={since}
            until={until}
            className="!text-slate-800 truncate max-w-[220px]"
          />
        </div>
        {showId && adId && <div className="campaign-id mt-0.5 truncate">{adId}</div>}
      </div>
    </div>
  );
}
