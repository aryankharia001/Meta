import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Megaphone, ShoppingCart, User, CornerDownLeft } from "lucide-react";
import { globalSearch } from "../lib/api";
import { useSelectedToken } from "../lib/useSelectedToken";
import { useCampaignDrawer } from "../lib/CampaignDrawerContext";
import { useOrderDrawer } from "../lib/OrderDrawerContext";
import { useCustomerDrawer } from "../lib/CustomerDrawerContext";
import { currency, formatDate } from "../lib/format";

// ────────────────────────────────────────────────────────────────
// Phase 7 — Global Command Palette (Ctrl/Cmd+K). Talks only to the new,
// read-only GET /api/search route. Opening a result reuses whichever
// drawer already exists for that entity type — this component never
// renders its own campaign/order/customer detail, only navigates to
// it. Search results don't carry a tokenId (orders/campaigns aren't
// scoped to a Meta token in Mongo), so opening a campaign/order here
// uses the currently-selected token from useSelectedToken() — the same
// "current token" every other page already operates against.
// ────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;
function defaultCampaignRange() {
  const until = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - 365 * DAY_MS).toISOString().slice(0, 10);
  return { since, until };
}

export default function CommandPalette({ open, onClose }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState({ orders: [], campaigns: [], customers: [] });
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  const { tokenId } = useSelectedToken();
  const { openCampaign } = useCampaignDrawer();
  const { openOrder } = useOrderDrawer();
  const { openCustomer } = useCustomerDrawer();

  useEffect(() => {
    if (open) {
      setQuery("");
      setResults({ orders: [], campaigns: [], customers: [] });
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setResults({ orders: [], campaigns: [], customers: [] });
      return;
    }
    debounceRef.current = setTimeout(() => {
      setLoading(true);
      globalSearch(query.trim())
        .then((res) => setResults({ orders: res.orders || [], campaigns: res.campaigns || [], customers: res.customers || [] }))
        .catch(() => setResults({ orders: [], campaigns: [], customers: [] }))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  const flatItems = useMemo(() => {
    const campaignItems = results.campaigns.map((c) => ({ kind: "campaign", ...c }));
    const orderItems = results.orders.map((o) => ({ kind: "order", ...o }));
    const customerItems = results.customers.map((c) => ({ kind: "customer", ...c }));
    return [...campaignItems, ...orderItems, ...customerItems];
  }, [results]);

  useEffect(() => setActiveIndex(0), [flatItems.length]);

  const openItem = (item) => {
    if (!item) return;
    if (item.kind === "campaign") {
      const { since, until } = defaultCampaignRange();
      openCampaign({ tokenId, campaignId: item.campaignId, campaignName: item.campaignName, since, until });
    } else if (item.kind === "order") {
      openOrder({ orderId: item.orderId, tokenId });
    } else if (item.kind === "customer") {
      openCustomer({ phone: item.phone, tokenId });
    }
    onClose();
  };

  const handleKeyDown = (e) => {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, flatItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      openItem(flatItems[activeIndex]);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] px-4 bg-slate-900/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden animate-[fadeIn_0.15s_ease-out]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-100">
          <Search size={16} className="text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            className="flex-1 outline-none text-sm text-slate-700 placeholder:text-slate-400"
            placeholder="Search campaigns, orders, customers…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <kbd className="text-[10px] text-slate-400 border border-slate-200 rounded px-1.5 py-0.5">Esc</kbd>
        </div>

        <div className="max-h-[50vh] overflow-y-auto">
          {loading && <div className="px-4 py-6 text-center text-xs text-slate-400">Searching…</div>}

          {!loading && query.trim().length >= 2 && flatItems.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-slate-400">No matches for "{query}".</div>
          )}

          {!loading && query.trim().length < 2 && (
            <div className="px-4 py-6 text-center text-xs text-slate-400">Type at least 2 characters to search.</div>
          )}

          {!loading && flatItems.length > 0 && (
            <ResultGroup
              label="Campaigns"
              icon={Megaphone}
              items={results.campaigns}
              flatItems={flatItems}
              activeIndex={activeIndex}
              onSelect={openItem}
              renderRow={(c) => (
                <>
                  <div className="text-sm text-slate-700 truncate">{c.campaignName}</div>
                  <div className="text-[11px] text-slate-400">{c.orders} order{c.orders === 1 ? "" : "s"}</div>
                </>
              )}
            />
          )}
          {!loading && results.orders.length > 0 && (
            <ResultGroup
              label="Orders"
              icon={ShoppingCart}
              items={results.orders}
              flatItems={flatItems}
              activeIndex={activeIndex}
              onSelect={openItem}
              renderRow={(o) => (
                <>
                  <div className="text-sm text-slate-700 truncate">
                    {o.orderId} {o.customerName ? `— ${o.customerName}` : ""}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {currency(o.totalAmountPayable)} · {formatDate(o.orderCreatedAt)}
                  </div>
                </>
              )}
            />
          )}
          {!loading && results.customers.length > 0 && (
            <ResultGroup
              label="Customers"
              icon={User}
              items={results.customers}
              flatItems={flatItems}
              activeIndex={activeIndex}
              onSelect={openItem}
              renderRow={(c) => (
                <>
                  <div className="text-sm text-slate-700 truncate">{c.name || c.phone}</div>
                  <div className="text-[11px] text-slate-400">
                    {c.phone} · {c.orders} order{c.orders === 1 ? "" : "s"}
                  </div>
                </>
              )}
            />
          )}
        </div>

        <div className="flex items-center gap-3 px-4 py-2 border-t border-slate-100 text-[10px] text-slate-400">
          <span className="inline-flex items-center gap-1">
            <kbd className="border border-slate-200 rounded px-1">↑↓</kbd> navigate
          </span>
          <span className="inline-flex items-center gap-1">
            <CornerDownLeft size={10} /> open
          </span>
        </div>
      </div>
    </div>
  );
}

function ResultGroup({ label, icon: Icon, items, flatItems, activeIndex, onSelect, renderRow }) {
  if (items.length === 0) return null;
  return (
    <div className="py-1.5">
      <div className="px-4 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</div>
      {items.map((item) => {
        const kind = label === "Campaigns" ? "campaign" : label === "Orders" ? "order" : "customer";
        const idx = flatItems.findIndex((f) => f.kind === kind && (f.campaignId ?? f.orderId ?? f.phone) === (item.campaignId ?? item.orderId ?? item.phone));
        const active = idx === activeIndex;
        return (
          <button
            key={`${kind}-${item.campaignId ?? item.orderId ?? item.phone}`}
            type="button"
            onClick={() => onSelect({ kind, ...item })}
            className={`w-full flex items-center gap-2.5 px-4 py-2 text-left ${active ? "bg-indigo-50" : "hover:bg-slate-50"}`}
          >
            <Icon size={14} className="text-slate-400 shrink-0" />
            <div className="min-w-0 flex-1">{renderRow(item)}</div>
          </button>
        );
      })}
    </div>
  );
}
