import { useMemo } from "react";
import { Download } from "lucide-react";
import { SectionHeading, Leaderboard } from "./chartKit";
import { currency, number, multiplier, percent } from "../../lib/format";
import { downloadCsv } from "../../lib/csv";
import CampaignLink from "../CampaignLink";
import { LiveIndicator, RoasValue, BudgetCell } from "../CampaignCells";

// ────────────────────────────────────────────────────────────────
// Campaign Performance — leaderboards sourced from the existing,
// untouched /campaigns/:tokenId/compare response (same data Dashboard
// and Campaign Comparison already fetch and render) rather than the
// Shiprocket-only analytics order list, since spend/ROAS/CTR only
// exist on the Meta side. Every row opens the Phase 2 Campaign Drawer.
// ────────────────────────────────────────────────────────────────

function useLeaderboards(campaignData) {
  return useMemo(() => {
    const rows = (campaignData?.campaigns || []).map((c) => ({
      ...c,
      profit: Number(c.revenue || 0) - Number(c.spend || 0),
      aov: c.orders ? Number(c.revenue || 0) / c.orders : 0,
    }));

    const top = (key, dir = "desc", filter) => {
      let list = filter ? rows.filter(filter) : rows;
      list = [...list].sort((a, b) => (dir === "desc" ? b[key] - a[key] : a[key] - b[key]));
      return list.slice(0, 8);
    };

    return {
      byRevenue: top("revenue"),
      byRoasHigh: top("roas", "desc", (c) => c.orders > 0),
      byRoasLow: top("roas", "asc", (c) => c.orders > 0),
      bySpend: top("spend"),
      lowestPerforming: top("profit", "asc", (c) => c.spend > 0),
      byOrders: top("orders"),
      byAov: top("aov", "desc", (c) => c.orders > 0),
      byConversion: top("conversionRate", "desc", (c) => c.conversionRate != null && c.conversionRate > 0),
    };
  }, [campaignData]);
}

export default function CampaignSection({ campaignData, tokenId, since, until }) {
  const boards = useLeaderboards(campaignData);

  const exportAll = () => {
    const rows = [["Board", "Campaign", "Spend", "Revenue", "ROAS", "Orders", "AOV", "Conversion %"]];
    Object.entries({
      "Highest Revenue": boards.byRevenue,
      "Highest ROAS": boards.byRoasHigh,
      "Lowest ROAS": boards.byRoasLow,
      "Highest Spend": boards.bySpend,
      "Lowest Performing (Profit)": boards.lowestPerforming,
      "Most Orders": boards.byOrders,
      "Highest AOV": boards.byAov,
      "Best Conversion": boards.byConversion,
    }).forEach(([board, list]) => {
      list.forEach((c) => rows.push([board, c.campaignName, c.spend, c.revenue, c.roas, c.orders, c.aov.toFixed(2), c.conversionRate ?? "N/A"]));
    });
    downloadCsv("campaign-leaderboards.csv", rows);
  };

  if (!campaignData) {
    return (
      <div className="card flex items-center justify-center text-center py-16 text-sm text-slate-400">
        Select at least one ad account on the Dashboard/Live Dashboard for campaign spend data to appear here.
      </div>
    );
  }

  const row = (metricKey, formatMetric) => (c) => (
    <tr key={c.campaignId}>
      <td>
        <div className="flex items-center gap-2 min-w-0">
          <CampaignLink tokenId={tokenId} campaignId={c.campaignId} campaignName={c.campaignName} accountId={c.accountId} since={since} until={until} className="campaign-name truncate max-w-[170px]" />
          <LiveIndicator status={c.effectiveStatus || c.status} />
        </div>
      </td>
      <td className="num">
        <BudgetCell budget={c.budget} budgetType={c.budgetType} />
      </td>
      <td className="num metric-primary">{currency(c.spend)}</td>
      <td className="num metric-primary">{currency(c.revenue)}</td>
      <td className="num">
        <RoasValue roas={c.roas} />
      </td>
      <td className="num">{number(c.orders)}</td>
      <td className="num font-semibold text-slate-700">{formatMetric ? formatMetric(c[metricKey]) : c[metricKey]}</td>
    </tr>
  );

  const columns = (metricLabel) => ["Campaign", "Budget", "Spend", "Revenue", "ROAS", "Orders", metricLabel];

  return (
    <div className="space-y-5 mb-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <SectionHeading title="Campaign Performance" subtitle="Leaderboards sourced from the same Meta spend/ROAS data as the Dashboard" />
        <button className="btn btn-secondary btn-sm" onClick={exportAll}>
          <Download size={13} /> Export All Leaderboards
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Leaderboard title="Highest Revenue Campaigns" columns={columns("Revenue")} rows={boards.byRevenue} renderRow={row("revenue", currency)} />
        <Leaderboard title="Highest ROAS Campaigns" columns={columns("ROAS")} rows={boards.byRoasHigh} renderRow={row("roas", multiplier)} />
        <Leaderboard title="Lowest ROAS Campaigns" tip="Campaigns with at least one order, sorted worst-ROAS first." columns={columns("ROAS")} rows={boards.byRoasLow} renderRow={row("roas", multiplier)} />
        <Leaderboard title="Highest Spend Campaigns" columns={columns("Spend")} rows={boards.bySpend} renderRow={row("spend", currency)} />
        <Leaderboard
          title="Lowest Performing Campaigns"
          tip="Sorted by profit (revenue − spend), worst first — the campaigns actually losing money, not just low ROAS."
          columns={columns("Profit")}
          rows={boards.lowestPerforming}
          renderRow={row("profit", currency)}
        />
        <Leaderboard title="Most Orders" columns={columns("Orders")} rows={boards.byOrders} renderRow={row("orders", number)} />
        <Leaderboard title="Highest Average Order Value" columns={columns("AOV")} rows={boards.byAov} renderRow={row("aov", currency)} />
        <Leaderboard
          title="Best Conversion Campaigns"
          tip="Meta-reported conversion rate. Only shown where Meta insights include it."
          columns={columns("Conversion %")}
          rows={boards.byConversion}
          renderRow={row("conversionRate", percent)}
          emptyMessage="Conversion rate isn't available from Meta insights for these campaigns."
        />
      </div>
    </div>
  );
}
