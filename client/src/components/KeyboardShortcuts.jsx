import { useEffect, useState } from "react";
import { X, Keyboard } from "lucide-react";
import { useCampaignDrawer } from "../lib/CampaignDrawerContext";
import { useOrderDrawer } from "../lib/OrderDrawerContext";
import { useCustomerDrawer } from "../lib/CustomerDrawerContext";
import { useLiveSync } from "../lib/LiveSyncContext";
import { getRecentlyViewed } from "../lib/recentlyViewed";
import CommandPalette from "./CommandPalette";

// ────────────────────────────────────────────────────────────────
// Phase 7 — Keyboard Shortcuts + Command Palette host. Mounted once at
// app root (below all three drawer providers + LiveSyncProvider, so it
// can see/control everything). Next/Previous Order and Next/Previous
// Campaign navigate within that entity type's Recently Viewed list
// (recentlyViewed.js) — the one ordering that's always available
// regardless of which page or drawer a given item was originally
// opened from, rather than requiring every table in the app to publish
// its own "current list" just for this.
// ────────────────────────────────────────────────────────────────

const SHORTCUTS = [
  { keys: "Ctrl/Cmd + K", desc: "Open Search (Command Palette)" },
  { keys: "R", desc: "Refresh Dashboard (background sync)" },
  { keys: "Esc", desc: "Close Drawer / Palette / this help" },
  { keys: "[", desc: "Previous Order / Campaign (in open drawer)" },
  { keys: "]", desc: "Next Order / Campaign (in open drawer)" },
  { keys: "Shift + ?", desc: "Show this shortcuts list" },
];

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export default function KeyboardShortcuts() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const { activeCampaign, openCampaign, closeCampaign } = useCampaignDrawer();
  const { activeOrder, openOrder, closeOrder } = useOrderDrawer();
  const { activeCustomer, closeCustomer } = useCustomerDrawer();
  const liveSync = useLiveSync();

  useEffect(() => {
    const onKeyDown = (e) => {
      const mod = e.ctrlKey || e.metaKey;

      // Cmd/Ctrl+K always works, even while typing elsewhere — same
      // convention as Slack/Linear/Spotlight.
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }

      if (paletteOpen) return; // CommandPalette handles its own keys while open

      if (e.key === "Escape") {
        if (helpOpen) setHelpOpen(false);
        else if (activeCustomer) closeCustomer();
        else if (activeOrder) closeOrder();
        else if (activeCampaign) closeCampaign();
        return;
      }

      if (isTypingTarget(document.activeElement)) return; // don't hijack single-key shortcuts while typing

      if (e.key === "?" && e.shiftKey) {
        setHelpOpen((o) => !o);
        return;
      }

      if (e.key.toLowerCase() === "r" && !mod) {
        e.preventDefault();
        liveSync.manualRefresh();
        return;
      }

      if ((e.key === "[" || e.key === "]") ) {
        const dir = e.key === "]" ? 1 : -1;
        if (activeOrder) {
          const list = getRecentlyViewed("order");
          const idx = list.findIndex((i) => i.id === activeOrder.orderId);
          const next = list[idx - dir]; // recently viewed is newest-first, so "]"/next moves toward older (idx+1)
          if (next) openOrder({ orderId: next.id, tokenId: next.meta?.tokenId || activeOrder.tokenId });
        } else if (activeCampaign) {
          const list = getRecentlyViewed("campaign");
          const idx = list.findIndex((i) => i.id === activeCampaign.campaignId);
          const next = list[idx - dir];
          if (next) {
            openCampaign({
              tokenId: next.meta?.tokenId || activeCampaign.tokenId,
              campaignId: next.id,
              campaignName: next.label,
              accountId: next.meta?.accountId || activeCampaign.accountId,
              since: activeCampaign.since,
              until: activeCampaign.until,
            });
          }
        }
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [paletteOpen, helpOpen, activeCampaign, activeOrder, activeCustomer, openCampaign, openOrder, closeCampaign, closeOrder, closeCustomer, liveSync]);

  return (
    <>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />

      {helpOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 bg-slate-900/50 backdrop-blur-sm" onClick={() => setHelpOpen(false)}>
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Keyboard size={16} className="text-slate-400" />
                <h3 className="font-display font-semibold text-sm text-slate-800">Keyboard Shortcuts</h3>
              </div>
              <button type="button" className="text-slate-400 hover:text-slate-600" onClick={() => setHelpOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="space-y-2">
              {SHORTCUTS.map((s) => (
                <div key={s.keys} className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-slate-500">{s.desc}</span>
                  <kbd className="shrink-0 text-[10px] text-slate-600 bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5">{s.keys}</kbd>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
