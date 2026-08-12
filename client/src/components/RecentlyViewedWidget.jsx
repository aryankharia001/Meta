import { useEffect, useState } from "react";
import { History, Megaphone, ShoppingCart, User, X } from "lucide-react";
import { getRecentlyViewed, subscribeRecentlyViewed, clearRecentlyViewed } from "../lib/recentlyViewed";
import { useCampaignDrawer } from "../lib/CampaignDrawerContext";
import { useOrderDrawer } from "../lib/OrderDrawerContext";
import { useCustomerDrawer } from "../lib/CustomerDrawerContext";

// Phase 7 — Recently Viewed widget, shown on the Dashboard. Reads
// straight from localStorage via recentlyViewed.js and re-renders
// live off its CustomEvent whenever any drawer records a new view, so
// this never needs its own polling or a Context provider.

const TYPE_META = {
  campaign: { icon: Megaphone, accent: "bg-indigo-50 text-indigo-600" },
  order: { icon: ShoppingCart, accent: "bg-sky-50 text-sky-600" },
  customer: { icon: User, accent: "bg-emerald-50 text-emerald-600" },
};

const DAY_MS = 24 * 60 * 60 * 1000;
function defaultCampaignRange() {
  const until = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - 365 * DAY_MS).toISOString().slice(0, 10);
  return { since, until };
}

export default function RecentlyViewedWidget() {
  const [items, setItems] = useState(() => getRecentlyViewed().slice(0, 8));
  const { openCampaign } = useCampaignDrawer();
  const { openOrder } = useOrderDrawer();
  const { openCustomer } = useCustomerDrawer();

  useEffect(() => {
    const refresh = () => setItems(getRecentlyViewed().slice(0, 8));
    refresh();
    return subscribeRecentlyViewed(refresh);
  }, []);

  if (items.length === 0) return null;

  const openItem = (item) => {
    if (item.type === "campaign") {
      const { since, until } = defaultCampaignRange();
      openCampaign({
        tokenId: item.meta?.tokenId,
        campaignId: item.id,
        campaignName: item.label,
        accountId: item.meta?.accountId,
        since,
        until,
      });
    } else if (item.type === "order") {
      openOrder({ orderId: item.id, tokenId: item.meta?.tokenId });
    } else if (item.type === "customer") {
      openCustomer({ phone: item.id, tokenId: item.meta?.tokenId });
    }
  };

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="flex items-center gap-2 font-display font-semibold text-slate-700 text-sm">
          <History size={15} className="text-slate-400" /> Recently Viewed
        </h2>
        <button type="button" className="text-xs text-slate-400 hover:text-rose-600" onClick={() => clearRecentlyViewed()}>
          Clear
        </button>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {items.map((item) => {
          const meta = TYPE_META[item.type] || TYPE_META.campaign;
          const Icon = meta.icon;
          return (
            <button
              key={`${item.type}:${item.id}`}
              type="button"
              onClick={() => openItem(item)}
              className="card !p-3 flex items-center gap-2.5 shrink-0 min-w-[190px] max-w-[220px] text-left hover:-translate-y-0.5 hover:border-slate-300"
            >
              <span className={`flex items-center justify-center w-8 h-8 rounded-lg shrink-0 ${meta.accent}`}>
                <Icon size={14} />
              </span>
              <div className="min-w-0">
                <div className="text-xs font-medium text-slate-700 truncate">{item.label || item.id}</div>
                <div className="text-[10px] text-slate-400 capitalize">{item.type}</div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
