import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { Fragment } from "react";
import { fetchLiveAdAccounts } from "../lib/api";
import { useSelectedToken } from "../lib/useSelectedToken";
import CampaignLink from "../components/CampaignLink";
import { useOrderDrawer } from "../lib/OrderDrawerContext";
import { useLiveSync, rangeIncludesToday } from "../lib/LiveSyncContext";

export default function CampaignComparison() {
  const { tokenId: TOKEN_ID, setTokenId, tokens } = useSelectedToken();
  const { openOrder } = useOrderDrawer();
  const liveSync = useLiveSync();

  const today = new Date().toISOString().split("T")[0];

  const [since, setSince] = useState(today);
  const [until, setUntil] = useState(today);

  const [adAccounts, setAdAccounts] = useState([]);
  const [selectedAccounts, setSelectedAccounts] = useState([]);

  const [data, setData] = useState(null);

  const [loading, setLoading] = useState(false);

  const [expandedCampaign, setExpandedCampaign] =
    useState(null);

  const [sortConfig, setSortConfig] = useState({
    key: "spend",
    direction: "desc",
  });

  useEffect(() => {
    if (TOKEN_ID) fetchAdAccounts();
  }, [TOKEN_ID]);

  // Pulled live from the Meta Graph API (GET /api/adaccounts/adaccounts/:tokenId)
  // instead of the local Mongo AdAccount collection, which is only ever
  // populated by a manual sync — so it was showing up empty here.
  const fetchAdAccounts = async () => {
    try {
      const res = await fetchLiveAdAccounts(TOKEN_ID);
      if (!res.success) throw new Error(res.message || "Failed to fetch ad accounts");

      // Normalize to the { adAccountId, name } shape the rest of this page
      // already expects, so nothing else here has to change.
      const accounts = (res.adAccounts || []).map((a) => ({
        adAccountId: a.id,
        name: a.name,
      }));

      setAdAccounts(accounts);

      setSelectedAccounts(
        accounts.map((a) => a.adAccountId)
      );
    } catch (err) {
      console.error(err);
    }
  };

  const toggleAccount = (id) => {
    setSelectedAccounts((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : [...prev, id]
    );
  };

  const selectAll = () => {
    setSelectedAccounts(
      adAccounts.map((a) => a.adAccountId)
    );
  };

  const clearAll = () => {
    setSelectedAccounts([]);
  };

  const fetchComparison = async () => {
    if (!selectedAccounts.length) {
      alert("Select at least one account");
      return;
    }

    try {
      setLoading(true);

      const params = new URLSearchParams();

      params.append("since", since);
      params.append("until", until);

      selectedAccounts.forEach((id) => {
        params.append("adAccountId", id);
      });

      const res = await axios.get(
        `/api/campaigns/${TOKEN_ID}/compare?${params}`
      );

      setData(res.data);
    } catch (err) {
      console.error(err);
      alert("Failed to fetch comparison");
    } finally {
      setLoading(false);
    }
  };

  // Phase 5 — background live sync. Silently re-runs the comparison
  // fetch when the 10s poll finds new orders, but only if: a comparison
  // has already been run once (data !== null — otherwise there's
  // nothing to refresh and firing fetchComparison() here would trigger
  // its "Select at least one account" alert() out of nowhere, which
  // would be exactly the kind of workflow interruption this phase says
  // not to cause), and the selected [since, until] range includes today
  // (new orders are always dated today).
  const prevCcSyncVersionRef = useRef(liveSync.syncVersion);
  useEffect(() => {
    if (liveSync.syncVersion === prevCcSyncVersionRef.current) return;
    prevCcSyncVersionRef.current = liveSync.syncVersion;
    if (data && selectedAccounts.length > 0 && rangeIncludesToday(since, until, today)) {
      fetchComparison();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveSync.syncVersion]);

  const handleSort = (key) => {
    let direction = "asc";

    if (
      sortConfig.key === key &&
      sortConfig.direction === "asc"
    ) {
      direction = "desc";
    }

    setSortConfig({
      key,
      direction,
    });
  };

  const arrow = (key) => {
    if (sortConfig.key !== key) return "";
    return sortConfig.direction === "asc"
      ? " ↑"
      : " ↓";
  };

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

      if (x < y)
        return sortConfig.direction === "asc"
          ? -1
          : 1;

      if (x > y)
        return sortConfig.direction === "asc"
          ? 1
          : -1;

      return 0;
    });

    return list;
  }, [data, sortConfig]);

  const toggleCampaign = (id) => {
    setExpandedCampaign((prev) =>
      prev === id ? null : id
    );
  };

  return (
    <div className="max-w-[1600px] mx-auto p-6">
      <h2 className="text-xl font-semibold text-slate-800 mb-4">Campaign Comparison</h2>

      <div className="mb-4 flex items-center gap-2">
        <label className="text-sm text-slate-600">Token:</label>
        <select
          className="input w-auto"
          value={TOKEN_ID || ""}
          onChange={(e) => setTokenId(e.target.value)}
        >
          {tokens.length === 0 && <option value={TOKEN_ID}>{TOKEN_ID}</option>}
          {tokens.map((t) => (
            <option key={t._id} value={t._id}>
              {t.label || t._id}
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-3 mb-5 items-center flex-wrap">
        <input
          type="date"
          className="input w-auto"
          value={since}
          onChange={(e) =>
            setSince(e.target.value)
          }
        />

        <input
          type="date"
          className="input w-auto"
          value={until}
          onChange={(e) =>
            setUntil(e.target.value)
          }
        />

        <button className="btn btn-primary" onClick={fetchComparison} disabled={loading}>
          {loading ? "Loading..." : "Fetch"}
        </button>
      </div>

      <hr className="border-slate-200 mb-5" />

      <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">Ad Accounts</h3>

      <div className="flex gap-2 mb-3">
        <button className="btn btn-secondary btn-sm" onClick={selectAll}>
          Select All
        </button>

        <button
          className="btn btn-secondary btn-sm"
          onClick={clearAll}
        >
          Clear
        </button>
      </div>

      <div className="mt-3 mb-6 flex flex-wrap gap-2">
        {adAccounts.map((account) => (
          <label
            key={account.adAccountId}
            className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg border cursor-pointer transition-colors ${
              selectedAccounts.includes(account.adAccountId)
                ? "bg-blue-50 border-blue-200 text-blue-700"
                : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            <input
              type="checkbox"
              checked={selectedAccounts.includes(
                account.adAccountId
              )}
              onChange={() =>
                toggleAccount(
                  account.adAccountId
                )
              }
            />

            {account.name} ({account.adAccountId})
          </label>
        ))}
      </div>

      {data && (
        <>
          <div className="flex gap-5 mb-6 flex-wrap">
            <Card
              title="Spend"
              value={`₹${data.summary.totalSpend.toFixed(
                2
              )}`}
            />

            <Card
              title="Revenue"
              value={`₹${data.summary.totalRevenue.toFixed(
                2
              )}`}
            />

            <Card
              title="Orders"
              value={data.summary.totalOrders}
            />

            <Card
              title="Campaigns"
              value={data.summary.totalCampaigns}
            />
          </div>

          <div className="card p-0 overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th
                  className="cursor-pointer select-none"
                  onClick={() =>
                    handleSort("campaignName")
                  }
                >
                  Campaign{arrow("campaignName")}
                </th>

                <th
                  className="cursor-pointer select-none"
                  onClick={() =>
                    handleSort("spend")
                  }
                >
                  Spend{arrow("spend")}
                </th>

                <th
                  className="cursor-pointer select-none"
                  onClick={() =>
                    handleSort("orders")
                  }
                >
                  Orders{arrow("orders")}
                </th>

                <th
                  className="cursor-pointer select-none"
                  onClick={() =>
                    handleSort("revenue")
                  }
                >
                  Revenue{arrow("revenue")}
                </th>

                <th
                  className="cursor-pointer select-none"
                  onClick={() =>
                    handleSort(
                      "costPerOrder"
                    )
                  }
                >
                  Cost / Order
                  {arrow("costPerOrder")}
                </th>

                <th
                  className="cursor-pointer select-none"
                  onClick={() =>
                    handleSort("roas")
                  }
                >
                  ROAS{arrow("roas")}
                </th>

                <th
                  className="cursor-pointer select-none"
                  onClick={() =>
                    handleSort("clicks")
                  }
                >
                  Clicks{arrow("clicks")}
                </th>

                <th
                  className="cursor-pointer select-none"
                  onClick={() =>
                    handleSort("ctr")
                  }
                >
                  CTR{arrow("ctr")}
                </th>

                <th>
                  Account
                </th>
              </tr>
            </thead>

            <tbody>
                              {campaigns.map((campaign) => (
                <Fragment key={campaign.campaignId}>
                  <tr
                    onClick={() =>
                      toggleCampaign(campaign.campaignId)
                    }
                    className={`cursor-pointer ${
                      expandedCampaign === campaign.campaignId ? "bg-slate-50" : ""
                    }`}
                  >
                    <td>
                      <CampaignLink
                        tokenId={TOKEN_ID}
                        campaignId={campaign.campaignId}
                        campaignName={campaign.campaignName}
                        accountId={campaign.accountId}
                        accountName={adAccounts.find((a) => a.adAccountId === campaign.accountId)?.name}
                        since={since}
                        until={until}
                      />
                    </td>

                    <td>
                      ₹
                      {Number(
                        campaign.spend || 0
                      ).toFixed(2)}
                    </td>

                    <td>
                      {campaign.orders}
                    </td>

                    <td>
                      ₹
                      {Number(
                        campaign.revenue || 0
                      ).toFixed(2)}
                    </td>

                    <td>
                      ₹
                      {Number(
                        campaign.costPerOrder || 0
                      ).toFixed(2)}
                    </td>

                    <td
                      className={`font-bold ${
                        campaign.roas >= 3
                          ? "text-emerald-600"
                          : campaign.roas >= 2
                          ? "text-amber-600"
                          : "text-rose-600"
                      }`}
                    >
                      {Number(
                        campaign.roas || 0
                      ).toFixed(2)}
                    </td>

                    <td>
                      {campaign.clicks}
                    </td>

                    <td>
                      {campaign.ctr}
                    </td>

                    <td>
                      {campaign.accountId}
                    </td>
                  </tr>

                  {expandedCampaign ===
                    campaign.campaignId && (
                    <tr>
                      <td
                        colSpan={9}
                        style={{
                          background: "#fafafa",
                          padding: 20,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            gap: 20,
                            marginBottom: 20,
                            flexWrap: "wrap",
                          }}
                        >
                          <Card
                            title="Impressions"
                            value={
                              campaign.impressions
                            }
                          />

                          <Card
                            title="Clicks"
                            value={campaign.clicks}
                          />

                          <Card
                            title="CTR"
                            value={campaign.ctr}
                          />

                          <Card
                            title="CPC"
                            value={`₹${Number(
                              campaign.cpc || 0
                            ).toFixed(2)}`}
                          />

                          <Card
                            title="CPM"
                            value={`₹${Number(
                              campaign.cpm || 0
                            ).toFixed(2)}`}
                          />

                          <Card
                            title="Conversion %"
                            value={`${Number(
                              campaign.conversionRate || 0
                            ).toFixed(2)}%`}
                          />
                        </div>

                        <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">
                          Orders (
                          {campaign.orderList.length})
                        </h3>

                        <div className="card p-0 overflow-x-auto">
                        <table className="table">
                          <thead>
                            <tr>
                              <th>
                                Order ID
                              </th>

                              <th>
                                Amount
                              </th>

                              <th>
                                Payment
                              </th>

                              <th>
                                Status
                              </th>

                              <th>
                                Order Date
                              </th>

                              <th>
                                Created At
                              </th>
                            </tr>
                          </thead>

                          <tbody>
                            {campaign.orderList
                              .length === 0 && (
                              <tr>
                                <td
                                  colSpan={6}
                                  className="text-center py-5 text-slate-500"
                                >
                                  No Orders
                                </td>
                              </tr>
                            )}

                            {campaign.orderList.map(
                              (order) => (
                                <tr
                                  key={
                                    order.orderId
                                  }
                                  className="cursor-pointer"
                                  onClick={() => openOrder({ orderId: order.orderId, tokenId: TOKEN_ID })}
                                >
                                  <td>
                                    {
                                      order.orderId
                                    }
                                  </td>

                                  <td>
                                    ₹
                                    {Number(
                                      order.totalAmountPayable ||
                                        0
                                    ).toFixed(
                                      2
                                    )}
                                  </td>

                                  <td>
                                    <span className={`badge ${order.paymentType === "PREPAID" ? "badge-blue" : "badge-amber"}`}>
                                      {order.paymentType}
                                    </span>
                                  </td>

                                  <td>
                                    {
                                      order.paymentStatus
                                    }
                                  </td>

                                  <td>
                                    {
                                      order.orderDate
                                    }
                                  </td>

                                  <td>
                                    {new Date(
                                      order.orderCreatedAt
                                    ).toLocaleString()}
                                  </td>
                                </tr>
                              )
                            )}
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
        {/* ------------------------------------ */}
{/* Unmatched Orders                    */}
{/* ------------------------------------ */}

<div style={{ marginTop: 50 }}>
  <h2 className="text-lg font-semibold text-slate-800 mb-3">
    Unmatched Orders (
    {data.unmatchedOrders?.length || 0})
  </h2>

  {(!data.unmatchedOrders ||
    data.unmatchedOrders.length === 0) && (
    <div className="card text-slate-600">
      🎉 All orders matched with Facebook campaigns.
    </div>
  )}

  {data.unmatchedOrders &&
    data.unmatchedOrders.length > 0 && (
      <div className="card p-0 overflow-x-auto mt-3">
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

              <td>
                {order.campaignId || "-"}
              </td>

              <td>
                {order.orderId}
              </td>

              <td>
                ₹
                {Number(
                  order.totalAmountPayable || 0
                ).toFixed(2)}
              </td>

              <td>
                <span className={`badge ${order.paymentType === "PREPAID" ? "badge-blue" : "badge-amber"}`}>
                  {order.paymentType}
                </span>
              </td>

              <td>
                {order.paymentStatus}
              </td>

              <td>
                {order.orderDate}
              </td>

              <td>
                {new Date(
                  order.orderCreatedAt
                ).toLocaleString()}
              </td>
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

function Card({ title, value }) {
  return (
    <div className="card min-w-[170px]">
      <div className="text-slate-500 mb-2 text-sm">
        {title}
      </div>

      <div className="font-bold text-2xl text-slate-800">
        {value}
      </div>
    </div>
  );
}