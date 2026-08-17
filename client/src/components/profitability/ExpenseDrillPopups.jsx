import { useEffect, useState } from "react";
import { X, AlertTriangle, RefreshCw, Inbox } from "lucide-react";
import { fetchProfitExpenseOrders, fetchProfitCampaigns } from "../../lib/api";
import { currency, number as fmtNumber, percent, multiplier } from "../../lib/format";
import OrdersListPopup from "../OrdersListPopup";
import DataTable from "../DataTable";
import { useCampaignDrawer } from "../../lib/CampaignDrawerContext";
import { useOverlayEscape } from "../../lib/overlayStack";

// ─────────────────────────────────────────────────────────────
// Phase 18 §3 — "what's behind this Expenses number" drill-downs for the
// Profitability Overview tab. Every popup here is read-only: it either
// hits the new GET /profitability/:tokenId/expense-orders endpoint (Part
// 1's fix means ctx.orders already carries per-order productCost/
// packagingCost/shippingCost/otherCost, so that endpoint just filters/
// sorts/caps what buildRangeContext already computed — no new cost math
// lives here), or reuses the existing GET /profitability/:tokenId/
// campaigns endpoint, or the already-fetched operatingExpenseBreakdown
// array from the /summary response (no extra call needed for that one).
//
// Loading/empty/error states follow the same visual language
// CampaignDrawer.jsx's DrawerSkeleton/DrawerError already established
// (skeleton pulse blocks, AlertTriangle-in-rose-circle error card) so
// these new popups don't introduce a third visual style.
// ─────────────────────────────────────────────────────────────

function DrillFrame({ title, subtitle, onClose, children }) {
  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 shrink-0">
          <div className="min-w-0">
            <div className="font-display font-semibold text-sm text-slate-800 truncate">{title}</div>
            {subtitle && <div className="text-xs text-slate-400 truncate">{subtitle}</div>}
          </div>
          <button type="button" className="text-slate-400 hover:text-slate-600 shrink-0" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="overflow-auto p-4">{children}</div>
      </div>
    </div>
  );
}

function DrillSkeleton() {
  return (
    <div className="space-y-1.5">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-9 bg-slate-100 rounded animate-pulse" />
      ))}
    </div>
  );
}

function DrillError({ message, onRetry }) {
  return (
    <div className="flex flex-col items-center text-center py-8 px-4">
      <span className="flex items-center justify-center w-11 h-11 rounded-2xl bg-rose-100 text-rose-600 mb-2.5">
        <AlertTriangle size={20} />
      </span>
      <p className="text-sm text-rose-600 mb-3">{message}</p>
      {onRetry && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
          <RefreshCw size={13} /> Try again
        </button>
      )}
    </div>
  );
}

function DrillEmpty({ message }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center px-4">
      <span className="flex items-center justify-center w-10 h-10 rounded-2xl bg-slate-100 text-slate-400 mb-2.5">
        <Inbox size={18} />
      </span>
      <div className="text-sm text-slate-400">{message}</div>
    </div>
  );
}

const COST_TYPE_LABELS = {
  productCost: "Product Cost",
  packagingCost: "Packaging Cost",
  shippingCost: "Shipping Cost",
  otherCost: "Other Per-Order Cost",
  totalCost: "Total Product-Related Cost",
  unmapped: "Orders with Unmapped Product Cost",
};

const COST_ORDER_COLUMNS = [
  { key: "orderId", label: "Order ID", render: (o) => o.orderId },
  { key: "campaignName", label: "Campaign" },
  { key: "totalAmountPayable", label: "Order Amount", render: (o) => currency(o.totalAmountPayable) },
  { key: "productCost", label: "Product Cost", render: (o) => currency(o.productCost) },
  { key: "packagingCost", label: "Packaging", render: (o) => currency(o.packagingCost) },
  { key: "shippingCost", label: "Shipping", render: (o) => currency(o.shippingCost) },
  { key: "otherCost", label: "Other", render: (o) => currency(o.otherCost) },
  { key: "paymentType", label: "Payment" },
  { key: "orderCreatedAt", label: "Order Date", render: (o) => o.orderDate || "N/A" },
];

// ── Product / Packaging / Shipping / Other / Unmapped cost drill-down ──
export function ExpenseOrdersPopup({ open, tokenId, accountIds, since, until, type, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = () => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchProfitExpenseOrders(tokenId, { accountIds, since, until, type })
      .then((res) => !cancelled && setData(res))
      .catch((err) => !cancelled && setError(err.message || "Failed to load orders"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  };

  useEffect(() => {
    setData(null);
    return load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tokenId, JSON.stringify(accountIds), since, until, type]);

  useOverlayEscape(open, onClose);

  if (!open) return null;

  const title = COST_TYPE_LABELS[type] || "Orders";
  const subtitle = since === until ? since : `${since} → ${until}`;

  if (loading && !data) {
    return (
      <DrillFrame title={title} subtitle={subtitle} onClose={onClose}>
        <DrillSkeleton />
      </DrillFrame>
    );
  }
  if (error) {
    return (
      <DrillFrame title={title} subtitle={subtitle} onClose={onClose}>
        <DrillError message={error} onRetry={load} />
      </DrillFrame>
    );
  }

  const orders = data?.orders || [];
  return (
    <OrdersListPopup
      open
      title={title}
      subtitle={data?.cappedAt ? `${subtitle} — showing top ${data.cappedAt} of ${fmtNumber(data.count)} orders` : subtitle}
      orders={orders}
      tokenId={tokenId}
      since={since}
      until={until}
      onClose={onClose}
      exportFilename={`profitability-${type}-orders.csv`}
      emptyMessage={
        type === "unmapped"
          ? "No orders with unmapped product cost in this range — every line item matched a configured Product."
          : "No orders contributing to this cost bucket in this range."
      }
      extraCards={[{ label: "Orders", value: fmtNumber(orders.length) }]}
      columns={COST_ORDER_COLUMNS}
      defaultHidden={[]}
      storageKey="profitExpenseOrdersPopup"
    />
  );
}

// ── Meta Ads (Advertising Expense) drill-down — per-campaign spend ─────
export function CampaignSpendPopup({ open, tokenId, accountIds, since, until, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { openCampaign } = useCampaignDrawer();

  const load = () => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchProfitCampaigns(tokenId, { accountIds, since, until })
      .then((res) => !cancelled && setData(res))
      .catch((err) => !cancelled && setError(err.message || "Failed to load campaign spend"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  };

  useEffect(() => {
    setData(null);
    return load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tokenId, JSON.stringify(accountIds), since, until]);

  useOverlayEscape(open, onClose);

  if (!open) return null;
  const subtitle = since === until ? since : `${since} → ${until}`;

  const columns = [
    { key: "campaignName", label: "Campaign", render: (c) => <span className="font-medium text-slate-700">{c.campaignName}</span> },
    { key: "spend", label: "Spend", render: (c) => currency(c.spend) },
    { key: "orders", label: "Orders", render: (c) => fmtNumber(c.orders) },
    { key: "netProfit", label: "Net Profit", render: (c) => <span className={c.netProfit >= 0 ? "text-emerald-600 font-semibold" : "text-rose-600 font-semibold"}>{currency(c.netProfit)}</span> },
    { key: "profitMargin", label: "Margin", render: (c) => percent(c.profitMargin) },
    { key: "roas", label: "ROAS", render: (c) => multiplier(c.roas) },
  ];

  const campaigns = (data?.campaigns || []).slice().sort((a, b) => b.spend - a.spend);

  return (
    <DrillFrame title="Advertising Expense — Spend by Campaign" subtitle={subtitle} onClose={onClose}>
      {loading && !data && <DrillSkeleton />}
      {error && <DrillError message={error} onRetry={load} />}
      {data && !error && (
        <>
          {campaigns.length === 0 ? (
            <DrillEmpty message="No campaign spend in this range." />
          ) : (
            <DataTable
              tableId="profit-overview-campaign-spend"
              columns={columns}
              data={campaigns}
              searchKeys={["campaignName"]}
              rowKey={(c) => c.campaignId || `unmatched:${c.campaignName}`}
              onRowClick={(c) => c.campaignId && openCampaign({ tokenId, campaignId: c.campaignId, campaignName: c.campaignName, accountId: c.accountId, accountName: c.accountName, since, until })}
              exportFilename="advertising-expense-by-campaign.csv"
              emptyMessage="No campaign spend in this range."
            />
          )}
        </>
      )}
    </DrillFrame>
  );
}

// ── Operating Expenses drill-down — per-expense config + allocation ────
// Purely synchronous, no fetch: the breakdown array is already part of
// the /summary response's expenses.operatingExpenseBreakdown (Part 2),
// which already carries name/category/frequency/startDate/endDate/notes
// alongside this range's allocated amount — exactly the "configuration
// and allocation" the spec's §6 drill-down example asks for.
export function OperatingExpenseBreakdownPopup({ open, breakdown, since, until, onClose }) {
  useOverlayEscape(open, onClose);
  if (!open) return null;
  const subtitle = since === until ? since : `${since} → ${until}`;
  const rows = breakdown || [];

  const columns = [
    { key: "name", label: "Expense", render: (e) => <span className="font-medium text-slate-700">{e.name}</span> },
    { key: "category", label: "Category", render: (e) => <span className="badge badge-slate text-[10px]">{e.category}</span> },
    { key: "configuredAmount", label: "Configured Amount", render: (e) => currency(e.configuredAmount) },
    { key: "frequency", label: "Frequency", render: (e) => e.frequency },
    { key: "startDate", label: "Start Date", render: (e) => e.startDate || "N/A" },
    { key: "endDate", label: "End Date", render: (e) => e.endDate || <span className="text-slate-300">—</span> },
    { key: "notes", label: "Notes", render: (e) => e.notes || <span className="text-slate-300">—</span> },
    { key: "amount", label: "Allocated (this range)", render: (e) => <span className="font-semibold text-slate-800">{currency(e.amount)}</span> },
  ];

  return (
    <DrillFrame title="Operating Expenses — by Category" subtitle={subtitle} onClose={onClose}>
      {rows.length === 0 ? (
        <DrillEmpty message="No active operating expenses contributed to this range." />
      ) : (
        <DataTable
          tableId="profit-overview-operating-breakdown"
          columns={columns}
          data={rows}
          searchKeys={["name", "category", "notes"]}
          rowKey={(e) => e.expenseId}
          exportFilename="operating-expense-breakdown.csv"
          emptyMessage="No active operating expenses contributed to this range."
        />
      )}
    </DrillFrame>
  );
}
