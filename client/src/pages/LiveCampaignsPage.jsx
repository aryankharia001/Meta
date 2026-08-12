import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, RefreshCw } from "lucide-react";
import { fetchLiveAdAccounts, fetchLiveCampaigns } from "../lib/api";
import { useSelectedToken } from "../lib/useSelectedToken";
import CampaignLink from "../components/CampaignLink";
import { useOrderDrawer } from "../lib/OrderDrawerContext";
import { useLiveSync, rangeIncludesToday } from "../lib/LiveSyncContext";

// Live dashboard combining campaign spend (Meta) with matched Shiprocket
// orders — built entirely on top of the existing, already-working
// GET /campaigns/:tokenId/compare endpoint (same one CampaignComparison.jsx
// uses), just wrapped in quick date presets + auto-refresh. No changes to
// that endpoint or to how campaigns/orders get matched.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const todayIso = () => new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
const shiftDays = (dateStr, days) => {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const PRESETS = [
  { key: "today", label: "Today", range: () => ({ since: todayIso(), until: todayIso() }) },
  {
    key: "yesterday",
    label: "Yesterday",
    range: () => ({ since: shiftDays(todayIso(), -1), until: shiftDays(todayIso(), -1) }),
  },
  { key: "7d", label: "7 Days", range: () => ({ since: shiftDays(todayIso(), -6), until: todayIso() }) },
  { key: "30d", label: "30 Days", range: () => ({ since: shiftDays(todayIso(), -29), until: todayIso() }) },
];

const AUTO_REFRESH_MS = 30 * 60 * 1000; // matches the Shiprocket auto-sync cadence

export default function LiveCampaignsPage() {
  const { tokenId: TOKEN_ID, setTokenId, tokens } = useSelectedToken();
  const { openOrder } = useOrderDrawer();
  const liveSync = useLiveSync();

  const [adAccounts, setAdAccounts] = useState([]);
  const [selectedAccounts, setSelectedAccounts] = useState([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);

  const [preset, setPreset] = useState("today");
  const { since, until } = useMemo(() => PRESETS.find((p) => p.key === preset).range(), [preset]);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastFetchedAt, setLastFetchedAt] = useState(null);

  const [expandedCampaign, setExpandedCampaign] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: "spend", direction: "desc" });

  const timerRef = useRef(null);

  useEffect(() => {
    if (!TOKEN_ID) return;
    (async () => {
      setLoadingAccounts(true);
      try {
        const res = await fetchLiveAdAccounts(TOKEN_ID);
        const list = res.success ? res.adAccounts || [] : [];
        setAdAccounts(list);
        setSelectedAccounts(list.map((a) => a.id));
      } catch {
        setAdAccounts([]);
      } finally {
        setLoadingAccounts(false);
      }
    })();
  }, [TOKEN_ID]);

  const load = useCallback(async () => {
    if (!TOKEN_ID || selectedAccounts.length === 0) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetchLiveCampaigns(TOKEN_ID, { accountIds: selectedAccounts, since, until });
      setData(res);
      setLastFetchedAt(new Date());
    } catch (err) {
      setError(err.message || "Failed to load live campaign data");
    } finally {
      setLoading(false);
    }
  }, [TOKEN_ID, selectedAccounts, since, until]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    timerRef.current = setInterval(load, AUTO_REFRESH_MS);
    return () => clearInterval(timerRef.current);
  }, [load]);

  // Phase 5 — background live sync. This page already auto-refreshes
  // every 30 minutes on its own timer above; this adds a much faster
  // path specifically for genuinely new orders — silently re-runs the
  // existing load() (same /compare call, so no new fetch/matching logic)
  // whenever the 10s poll finds new orders AND the selected preset's
  // range includes today.
  const prevLcpSyncVersionRef = useRef(liveSync.syncVersion);
  useEffect(() => {
    if (liveSync.syncVersion === prevLcpSyncVersionRef.current) return;
    prevLcpSyncVersionRef.current = liveSync.syncVersion;
    if (rangeIncludesToday(since, until, todayIso())) {
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveSync.syncVersion, since, until, load]);

  const toggleAccount = (id) => {
    setSelectedAccounts((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  const selectAllAccounts = () => setSelectedAccounts(adAccounts.map((a) => a.id));
  const clearAccounts = () => setSelectedAccounts([]);

  // ── Orders + payment-type split, aggregated across matched campaign
  // order lists AND unmatched orders, so "every stat" includes orders that
  // didn't line up with a campaign too. Purely a client-side reduction over
  // data already returned by /compare — no extra requests.
  const allOrders = useMemo(() => {
    if (!data) return [];
    const fromCampaigns = data.campaigns.flatMap((c) => c.orderList || []);
    return [...fromCampaigns, ...(data.unmatchedOrders || [])];
  }, [data]);

  const paymentSplit = useMemo(() => {
    const split = { cod: { count: 0, revenue: 0 }, prepaid: { count: 0, revenue: 0 } };
    allOrders.forEach((o) => {
      const bucket = o.paymentType === "CASH_ON_DELIVERY" ? split.cod : o.paymentType === "PREPAID" ? split.prepaid : null;
      if (!bucket) return;
      bucket.count += 1;
      bucket.revenue += Number(o.totalAmountPayable || 0);
    });
    return split;
  }, [allOrders]);

  const handleSort = (key) => {
    setSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc",
    }));
  };
  const arrow = (key) => (sortConfig.key !== key ? "" : sortConfig.direction === "asc" ? " ↑" : " ↓");

  const campaigns = useMemo(() => {
    if (!data) return [];
    const list = [...data.campaigns];
    list.sort((a, b) => {
      let x = a[sortConfig.key];
      let y = b[sortConfig.key];
      if (typeof x === "string") {
        x = x.toLowerCase();
        y = y.toLowerCase();
      } else {
        x = Number(x || 0);
        y = Number(y || 0);
      }
      if (x < y) return sortConfig.direction === "asc" ? -1 : 1;
      if (x > y) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });
    return list;
  }, [data, sortConfig]);

  const toggleCampaign = (id) => setExpandedCampaign((prev) => (prev === id ? null : id));

  return (
    <div className="max-w-[1400px] mx-auto p-6">
      <div className="flex items-center gap-2.5 mb-1">
        <Activity size={20} className="text-blue-600" />
        <h1 className="text-xl font-semibold text-slate-800">Live Dashboard</h1>
      </div>
      <p className="text-sm text-slate-500 mb-5 max-w-[620px]">
        Meta campaign spend matched against Shiprocket orders, live. Auto-refreshes every 30 minutes.
      </p>

      <div className="flex items-center gap-2.5 mb-4 flex-wrap">
        <label className="text-sm text-slate-600">Token:</label>
        <select className="input w-auto" value={TOKEN_ID || ""} onChange={(e) => setTokenId(e.target.value)}>
          {tokens.length === 0 && <option value={TOKEN_ID}>{TOKEN_ID}</option>}
          {tokens.map((t) => (
            <option key={t._id} value={t._id}>
              {t.label || t._id}
            </option>
          ))}
        </select>

        <button className="btn btn-primary" onClick={load} disabled={loading || selectedAccounts.length === 0}>
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="flex gap-1.5 mb-5 bg-slate-100 rounded-lg p-1 w-fit">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPreset(p.key)}
            className={`px-3.5 py-1.5 rounded-md text-sm font-medium transition-colors ${
              preset === p.key ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {loadingAccounts ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm mb-4">
          <span className="spinner" /> Loading ad accounts…
        </div>
      ) : (
        adAccounts.length > 0 && (
          <div className="mb-5">
            <div className="flex gap-2 mb-2">
              <button className="btn btn-secondary btn-sm" onClick={selectAllAccounts}>
                Select All
              </button>
              <button className="btn btn-secondary btn-sm" onClick={clearAccounts}>
                Clear
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {adAccounts.map((a) => (
                <label
                  key={a.id}
                  className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                    selectedAccounts.includes(a.id)
                      ? "bg-blue-50 border-blue-200 text-blue-700"
                      : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <input type="checkbox" checked={selectedAccounts.includes(a.id)} onChange={() => toggleAccount(a.id)} />
                  {a.name || a.id}
                </label>
              ))}
            </div>
          </div>
        )
      )}

      {error && (
        <div className="mb-4 text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>
      )}

      {lastFetchedAt && (
        <div className="mb-4 text-xs text-slate-400">
          Last updated {lastFetchedAt.toLocaleTimeString()} — auto-refreshes every 30 min · {since}
          {until !== since ? ` → ${until}` : ""}
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 mb-4">
            <StatCard label="Spend" value={`₹${data.summary.totalSpend.toFixed(2)}`} />
            <StatCard label="Revenue" value={`₹${data.summary.totalRevenue.toFixed(2)}`} highlight />
            <StatCard label="Orders" value={data.summary.totalOrders} />
            <StatCard label="Avg ROAS" value={data.summary.averageROAS.toFixed(2)} />
            <StatCard label="Campaigns" value={data.summary.totalCampaigns} />
            <StatCard label="Clicks" value={data.summary.totalClicks} />
            <StatCard label="Impressions" value={data.summary.totalImpressions} />
            <StatCard label="Unmatched Orders" value={data.unmatchedOrders?.length || 0} />
          </div>

          <div className="grid grid-cols-2 gap-3.5 mb-6">
            <div className="card">
              <div className="text-xs text-slate-500 mb-1.5">COD</div>
              <div className="text-xl font-bold text-slate-800">{paymentSplit.cod.count} orders</div>
              <div className="text-xs text-slate-500 mt-1">₹{paymentSplit.cod.revenue.toFixed(2)} revenue</div>
            </div>
            <div className="card">
              <div className="text-xs text-slate-500 mb-1.5">Prepaid</div>
              <div className="text-xl font-bold text-slate-800">{paymentSplit.prepaid.count} orders</div>
              <div className="text-xs text-slate-500 mt-1">₹{paymentSplit.prepaid.revenue.toFixed(2)} revenue</div>
            </div>
          </div>

          <div className="card p-0 overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th className="cursor-pointer select-none" onClick={() => handleSort("campaignName")}>
                    Campaign{arrow("campaignName")}
                  </th>
                  <th className="cursor-pointer select-none" onClick={() => handleSort("spend")}>
                    Spend{arrow("spend")}
                  </th>
                  <th className="cursor-pointer select-none" onClick={() => handleSort("orders")}>
                    Orders{arrow("orders")}
                  </th>
                  <th className="cursor-pointer select-none" onClick={() => handleSort("revenue")}>
                    Revenue{arrow("revenue")}
                  </th>
                  <th className="cursor-pointer select-none" onClick={() => handleSort("costPerOrder")}>
                    Cost/Order{arrow("costPerOrder")}
                  </th>
                  <th className="cursor-pointer select-none" onClick={() => handleSort("roas")}>
                    ROAS{arrow("roas")}
                  </th>
                  <th className="cursor-pointer select-none" onClick={() => handleSort("clicks")}>
                    Clicks{arrow("clicks")}
                  </th>
                  <th className="cursor-pointer select-none" onClick={() => handleSort("impressions")}>
                    Impressions{arrow("impressions")}
                  </th>
                  <th className="cursor-pointer select-none" onClick={() => handleSort("ctr")}>
                    CTR{arrow("ctr")}
                  </th>
                  <th className="cursor-pointer select-none" onClick={() => handleSort("cpc")}>
                    CPC{arrow("cpc")}
                  </th>
                  <th className="cursor-pointer select-none" onClick={() => handleSort("cpm")}>
                    CPM{arrow("cpm")}
                  </th>
                  <th className="cursor-pointer select-none" onClick={() => handleSort("conversionRate")}>
                    Conv %{arrow("conversionRate")}
                  </th>
                  <th>Account</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.length === 0 && (
                  <tr>
                    <td colSpan={13} className="text-center py-6 text-slate-500">
                      No campaign activity in this range.
                    </td>
                  </tr>
                )}
                {campaigns.map((c) => (
                  <Fragment key={c.campaignId}>
                    <tr
                      onClick={() => toggleCampaign(c.campaignId)}
                      className={`cursor-pointer ${expandedCampaign === c.campaignId ? "bg-slate-50" : ""}`}
                    >
                      <td>
                        <CampaignLink
                          tokenId={TOKEN_ID}
                          campaignId={c.campaignId}
                          campaignName={c.campaignName}
                          accountId={c.accountId}
                          accountName={adAccounts.find((a) => a.id === c.accountId)?.name}
                          since={since}
                          until={until}
                        />
                      </td>
                      <td>₹{Number(c.spend || 0).toFixed(2)}</td>
                      <td>{c.orders}</td>
                      <td>₹{Number(c.revenue || 0).toFixed(2)}</td>
                      <td>₹{Number(c.costPerOrder || 0).toFixed(2)}</td>
                      <td
                        className={`font-bold ${
                          c.roas >= 3 ? "text-emerald-600" : c.roas >= 2 ? "text-amber-600" : "text-rose-600"
                        }`}
                      >
                        {Number(c.roas || 0).toFixed(2)}
                      </td>
                      <td>{c.clicks}</td>
                      <td>{c.impressions}</td>
                      <td>{c.ctr}</td>
                      <td>₹{Number(c.cpc || 0).toFixed(2)}</td>
                      <td>₹{Number(c.cpm || 0).toFixed(2)}</td>
                      <td>{c.conversionRate}%</td>
                      <td>{c.accountId}</td>
                    </tr>

                    {expandedCampaign === c.campaignId && (
                      <tr>
                        <td colSpan={13} className="bg-slate-50 p-5">
                          <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">
                            Orders ({c.orderList.length})
                          </h3>
                          <div className="card p-0 overflow-x-auto">
                            <table className="table">
                              <thead>
                                <tr>
                                  <th>Order ID</th>
                                  <th>Amount</th>
                                  <th>Payment</th>
                                  <th>Status</th>
                                  <th>Order Date</th>
                                  <th>Created At</th>
                                </tr>
                              </thead>
                              <tbody>
                                {c.orderList.length === 0 && (
                                  <tr>
                                    <td colSpan={6} className="text-center py-5 text-slate-500">
                                      No Orders
                                    </td>
                                  </tr>
                                )}
                                {c.orderList.map((order) => (
                                  <tr
                                    key={order.orderId}
                                    className="cursor-pointer"
                                    onClick={() => openOrder({ orderId: order.orderId, tokenId: TOKEN_ID })}
                                  >
                                    <td>{order.orderId}</td>
                                    <td>₹{Number(order.totalAmountPayable || 0).toFixed(2)}</td>
                                    <td>
                                      <span
                                        className={`badge ${order.paymentType === "PREPAID" ? "badge-blue" : "badge-amber"}`}
                                      >
                                        {order.paymentType}
                                      </span>
                                    </td>
                                    <td>{order.paymentStatus}</td>
                                    <td>{order.orderDate}</td>
                                    <td>{new Date(order.orderCreatedAt).toLocaleString()}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-8">
            <h2 className="text-lg font-semibold text-slate-800 mb-3">
              Unmatched Orders ({data.unmatchedOrders?.length || 0})
            </h2>

            {(!data.unmatchedOrders || data.unmatchedOrders.length === 0) && (
              <div className="card text-slate-600">🎉 All orders matched with Facebook campaigns.</div>
            )}

            {data.unmatchedOrders && data.unmatchedOrders.length > 0 && (
              <div className="card p-0 overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Campaign Name</th>
                      <th>Campaign ID</th>
                      <th>Order ID</th>
                      <th>Amount</th>
                      <th>Payment</th>
                      <th>Status</th>
                      <th>Order Date</th>
                      <th>Created At</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.unmatchedOrders.map((order) => (
                      <tr
                        key={order.orderId}
                        className="cursor-pointer"
                        onClick={() => openOrder({ orderId: order.orderId, tokenId: TOKEN_ID })}
                      >
                        <td onClick={(e) => e.stopPropagation()}>
                          <CampaignLink
                            tokenId={TOKEN_ID}
                            campaignId={order.campaignId}
                            campaignName={order.campaignName}
                            since={since}
                            until={until}
                          />
                        </td>
                        <td>{order.campaignId || "-"}</td>
                        <td>{order.orderId}</td>
                        <td>₹{Number(order.totalAmountPayable || 0).toFixed(2)}</td>
                        <td>
                          <span className={`badge ${order.paymentType === "PREPAID" ? "badge-blue" : "badge-amber"}`}>
                            {order.paymentType}
                          </span>
                        </td>
                        <td>{order.paymentStatus}</td>
                        <td>{order.orderDate}</td>
                        <td>{new Date(order.orderCreatedAt).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, highlight }) {
  return (
    <div className={`card ${highlight ? "bg-blue-50 border-blue-200" : ""}`}>
      <div className="text-xs text-slate-500 mb-1.5">{label}</div>
      <div className="text-2xl font-bold text-slate-800">{value}</div>
    </div>
  );
}
