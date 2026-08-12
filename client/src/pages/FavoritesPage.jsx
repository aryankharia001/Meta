import { useMemo } from "react";
import { Star, Megaphone, ShoppingCart, User } from "lucide-react";
import { useFavorites } from "../lib/FavoritesContext";
import { useCampaignDrawer } from "../lib/CampaignDrawerContext";
import { useOrderDrawer } from "../lib/OrderDrawerContext";
import { useCustomerDrawer } from "../lib/CustomerDrawerContext";
import { formatDateTime } from "../lib/format";
import FavoriteButton from "../components/FavoriteButton";
import DataTable from "../components/DataTable";

// ────────────────────────────────────────────────────────────────
// Phase 7 — Favorites page: the "Favorites section" the spec calls for,
// listing everything starred across campaigns/orders/customers. Reads
// from the same FavoritesContext the star buttons in each drawer write
// to, grouped by entity type. Opening a favorited campaign has no
// saved date range to reuse (favoriting is an identity, not a
// snapshot), so it defaults to a broad last-365-days window — same
// fallback idea as a bookmark taking you to an item's default view.
// ────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

function defaultRange() {
  const until = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - 365 * DAY_MS).toISOString().slice(0, 10);
  return { since, until };
}

export default function FavoritesPage() {
  const { favorites, loaded } = useFavorites();
  const { openCampaign } = useCampaignDrawer();
  const { openOrder } = useOrderDrawer();
  const { openCustomer } = useCustomerDrawer();

  const grouped = useMemo(() => {
    const g = { campaign: [], order: [], customer: [] };
    favorites.forEach((f) => {
      if (g[f.entityType]) g[f.entityType].push(f);
    });
    return g;
  }, [favorites]);

  const openFavorite = (f) => {
    if (f.entityType === "campaign") {
      const { since, until } = defaultRange();
      openCampaign({
        tokenId: f.meta?.tokenId,
        campaignId: f.entityId,
        campaignName: f.label,
        accountId: f.meta?.accountId,
        since,
        until,
      });
    } else if (f.entityType === "order") {
      openOrder({ orderId: f.entityId, tokenId: f.meta?.tokenId });
    } else if (f.entityType === "customer") {
      openCustomer({ phone: f.entityId, tokenId: f.meta?.tokenId });
    }
  };

  const total = favorites.length;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-2.5 mb-1">
        <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 text-white shadow-md shadow-amber-500/30">
          <Star size={18} fill="currentColor" />
        </span>
        <div>
          <h1 className="text-lg font-display font-bold text-slate-800 leading-tight">Favorites</h1>
          <p className="text-xs text-slate-400">
            {loaded ? `${total} favorited item${total === 1 ? "" : "s"}` : "Loading…"}
          </p>
        </div>
      </div>

      {loaded && total === 0 && (
        <div className="card flex flex-col items-center justify-center py-16 text-center">
          <span className="flex items-center justify-center w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 mb-3">
            <Star size={22} />
          </span>
          <div className="text-sm text-slate-500 mb-1">No favorites yet</div>
          <p className="text-xs text-slate-400 max-w-sm">
            Star a campaign, order, or customer from its drawer to pin it here for quick access.
          </p>
        </div>
      )}

      {loaded && total > 0 && (
        <>
          <FavoriteGroup title="Campaigns" icon={Megaphone} items={grouped.campaign} onOpen={openFavorite} tableId="favorites-campaigns" />
          <FavoriteGroup title="Orders" icon={ShoppingCart} items={grouped.order} onOpen={openFavorite} tableId="favorites-orders" />
          <FavoriteGroup title="Customers" icon={User} items={grouped.customer} onOpen={openFavorite} tableId="favorites-customers" />
        </>
      )}
    </div>
  );
}

// Phase 7 — each group renders through the new reusable DataTable
// (search/sort/pagination/CSV export/remembered column prefs), one of
// this component's first real usages alongside ActivityLogPage.
function FavoriteGroup({ title, icon: Icon, items, onOpen, tableId }) {
  if (items.length === 0) return null;

  const columns = [
    {
      key: "label",
      label: title.slice(0, -1) || "Item",
      render: (f) => <span className="font-medium text-slate-700">{f.label || f.entityId}</span>,
    },
    {
      key: "createdAt",
      label: "Favorited",
      render: (f) => (f.createdAt ? formatDateTime(f.createdAt) : "—"),
      sortValue: (f) => (f.createdAt ? new Date(f.createdAt).getTime() : 0),
    },
    {
      key: "actions",
      label: "",
      sortable: false,
      defaultWidth: 60,
      render: (f) => (
        <div onClick={(e) => e.stopPropagation()}>
          <FavoriteButton entityType={f.entityType} entityId={f.entityId} label={f.label} meta={f.meta} size={16} />
        </div>
      ),
    },
  ];

  return (
    <section>
      <h2 className="flex items-center gap-2 font-display font-semibold text-sm text-slate-700 mb-3">
        <Icon size={15} className="text-slate-400" />
        {title} <span className="text-slate-400 font-normal">({items.length})</span>
      </h2>
      <DataTable
        tableId={tableId}
        columns={columns}
        data={items}
        searchKeys={["label", "entityId"]}
        rowKey={(f) => `${f.entityType}:${f.entityId}`}
        onRowClick={onOpen}
        exportFilename={`${tableId}.csv`}
        emptyMessage="Nothing here yet."
      />
    </section>
  );
}
