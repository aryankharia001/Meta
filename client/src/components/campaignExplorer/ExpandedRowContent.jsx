import { useEffect, useState } from "react";
import { AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Legend } from "recharts";
import { fetchCampaignBreakdown } from "../../lib/api";
import { getCachedCampaignBreakdown, setCachedCampaignBreakdown } from "../../lib/campaignExplorerCache";
import { ChartCard, StyledTooltip, Leaderboard, CHART_COLORS } from "../analytics/chartKit";
import { currency, number, formatDate } from "../../lib/format";
import { DELIVERY_LABELS } from "../../lib/analyticsUtils";

// ────────────────────────────────────────────────────────────────
// Phase 8 — expandable-row content. Lazily fetches
// GET /api/campaign-explorer/:tokenId/:campaignId/breakdown the first
// time a row is expanded (not on table load, not on every re-render),
// caches the result in campaignExplorerCache.js so collapsing and
// re-expanding the same row is instant. Reuses Phase 6's chartKit
// components (ChartCard/StyledTooltip/Leaderboard/CHART_COLORS) so
// these charts look identical to the Analytics page's.
// ────────────────────────────────────────────────────────────────

export default function ExpandedRowContent({ campaign, tokenId, since, until }) {
  const [data, setData] = useState(() => getCachedCampaignBreakdown(tokenId, campaign.campaignId, since, until));
  const [loading, setLoading] = useState(!data);
  const [error, setError] = useState("");

  useEffect(() => {
    const cached = getCachedCampaignBreakdown(tokenId, campaign.campaignId, since, until);
    if (cached) {
      setData(cached);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    fetchCampaignBreakdown(tokenId, campaign.campaignId, {
      campaignName: campaign.campaignName,
      accountId: campaign.accountId,
      since,
      until,
    })
      .then((res) => {
        setData(res);
        setCachedCampaignBreakdown(tokenId, campaign.campaignId, since, until, res);
      })
      .catch((err) => setError(err.message || "Failed to load campaign breakdown"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenId, campaign.campaignId, since, until]);

  if (loading) {
    return (
      <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="card h-56 animate-pulse bg-slate-100" />
        ))}
      </div>
    );
  }

  if (error) {
    return <div className="p-5 text-sm text-rose-600">{error}</div>;
  }

  if (!data) return null;

  const trend = (data.trend || []).map((t) => ({ ...t, name: formatDate(t.date) }));
  const paymentSplit = [
    { name: "Prepaid", value: data.paymentSplit?.prepaid || 0 },
    { name: "COD", value: data.paymentSplit?.cod || 0 },
  ].filter((r) => r.value > 0);
  const deliveryRows = Object.entries(data.deliveryDistribution || {})
    .filter(([, v]) => v > 0)
    .map(([key, value]) => ({ key, label: DELIVERY_LABELS[key] || key, value }));

  return (
    <div className="p-5 space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Revenue &amp; Spend Trend" height={220} empty={trend.length === 0}>
          <AreaChart data={trend}>
            <defs>
              <linearGradient id={`rev-${campaign.campaignId}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={CHART_COLORS[0]} stopOpacity={0.35} />
                <stop offset="95%" stopColor={CHART_COLORS[0]} stopOpacity={0} />
              </linearGradient>
              <linearGradient id={`spend-${campaign.campaignId}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={CHART_COLORS[3]} stopOpacity={0.35} />
                <stop offset="95%" stopColor={CHART_COLORS[3]} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#94a3b8" }} />
            <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} tickFormatter={(v) => number(v)} />
            <StyledTooltip formatter={(v) => currency(v)} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Area type="monotone" dataKey="revenue" name="Revenue" stroke={CHART_COLORS[0]} fill={`url(#rev-${campaign.campaignId})`} strokeWidth={2} animationDuration={400} />
            <Area type="monotone" dataKey="spend" name="Spend" stroke={CHART_COLORS[3]} fill={`url(#spend-${campaign.campaignId})`} strokeWidth={2} animationDuration={400} />
          </AreaChart>
        </ChartCard>

        <ChartCard title="Orders Trend" height={220} empty={trend.length === 0}>
          <BarChart data={trend}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#94a3b8" }} />
            <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} tickFormatter={(v) => number(v)} allowDecimals={false} />
            <StyledTooltip />
            <Bar dataKey="orders" name="Orders" fill={CHART_COLORS[2]} radius={[4, 4, 0, 0]} animationDuration={400} />
          </BarChart>
        </ChartCard>

        <ChartCard title="Payment Split" height={200} empty={paymentSplit.length === 0}>
          <PieChart>
            <Pie data={paymentSplit} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={80} paddingAngle={2} animationDuration={400}>
              {paymentSplit.map((_, i) => (
                <Cell key={i} fill={[CHART_COLORS[3], CHART_COLORS[1]][i % 2]} />
              ))}
            </Pie>
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <StyledTooltip />
          </PieChart>
        </ChartCard>

        <ChartCard title="Delivery Status Distribution" height={200} empty={deliveryRows.length === 0}>
          <BarChart data={deliveryRows} layout="vertical" margin={{ left: 16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10, fill: "#94a3b8" }} allowDecimals={false} />
            <YAxis type="category" dataKey="label" width={90} tick={{ fontSize: 10, fill: "#64748b" }} />
            <StyledTooltip />
            <Bar dataKey="value" name="Orders" fill={CHART_COLORS[5]} radius={[0, 4, 4, 0]} animationDuration={400} />
          </BarChart>
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Leaderboard
          title="Top Products"
          columns={["Product", "Orders"]}
          rows={data.topProducts || []}
          emptyMessage="No product data for this range."
          renderRow={(p, i) => (
            <tr key={i}>
              <td className="truncate max-w-[160px]">{p.name}</td>
              <td>{p.count}</td>
            </tr>
          )}
        />
        <Leaderboard
          title="Top Cities"
          columns={["City", "Orders"]}
          rows={data.topCities || []}
          emptyMessage="No city data for this range."
          renderRow={(c, i) => (
            <tr key={i}>
              <td>{c.name}</td>
              <td>{c.count}</td>
            </tr>
          )}
        />
        <Leaderboard
          title="Top States"
          columns={["State", "Orders"]}
          rows={data.topStates || []}
          emptyMessage="No state data for this range."
          renderRow={(s, i) => (
            <tr key={i}>
              <td>{s.name}</td>
              <td>{s.count}</td>
            </tr>
          )}
        />
      </div>
    </div>
  );
}
