import { useMemo, useState } from "react";
import { Inbox, Download, ChevronRight } from "lucide-react";
import { currency, number } from "../../lib/format";
import { formatDayLabel } from "../../lib/dateIst";
import { downloadCsv } from "../../lib/csv";
import { RoasValue } from "../CampaignCells";
import CampaignLink from "../CampaignLink";
import AdSetLink from "../AdSetLink";
import AdLink from "../AdLink";
import ActivityStatusPill from "./ActivityStatusPill";
import { budgetText, bidCapTextForRow, hourRangeLabel, sortRows } from "./activityFormat";

// ─────────────────────────────────────────────────────────────────────
// Phase 44 — Campaign Activity History + Hourly ROAS. Presentational
// table components for the new Campaign Activity page. Deliberately its
// own small set of components (not a reuse/extension of DailyTable.jsx
// or CampaignExplorerPage's tables) — same "zero coupling between
// phases" convention this codebase has followed since Phase 8: nothing
// here can ever be broken by a change to those tables, and nothing here
// can ever break them. Row-level cells reuse the EXISTING CampaignLink/
// AdSetLink/AdLink/RoasValue components so clicking a name still opens
// the same drawers every other page already uses — only the table shell
// around them is new.
//
// Every table row is clickable to drill deeper (per spec §6/§7/§9/§11/
// §17); the entity name cell inside each row uses CampaignLink/AdSetLink/
// AdLink, whose own onClick already calls stopPropagation() (see those
// components), so clicking the name opens its drawer while clicking
// anywhere else on the row drills down — no extra wiring needed here.
// ─────────────────────────────────────────────────────────────────────

function EmptyState({ message }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center px-4">
      <span className="flex items-center justify-center w-10 h-10 rounded-2xl bg-slate-100 text-slate-400 mb-2.5">
        <Inbox size={18} />
      </span>
      <div className="text-sm text-slate-400">{message}</div>
    </div>
  );
}

function Th({ label, sortKey, sortConfig, onSort, align }) {
  const active = sortConfig?.key === sortKey;
  return (
    <th
      className={align === "right" ? "num" : ""}
      onClick={onSort ? () => onSort(sortKey) : undefined}
      style={onSort ? { cursor: "pointer", userSelect: "none" } : undefined}
      title={onSort ? "Sort" : undefined}
    >
      {label}
      {active ? (sortConfig.direction === "asc" ? " ↑" : " ↓") : ""}
    </th>
  );
}

function useSortConfig(initialKey, initialDirection = "desc") {
  const [sortConfig, setSortConfig] = useState({ key: initialKey, direction: initialDirection });
  const onSort = (key) => setSortConfig((p) => ({ key, direction: p.key === key && p.direction === "asc" ? "desc" : "asc" }));
  return [sortConfig, onSort];
}

// ── Spec §5 — one row per day ────────────────────────────────────────
export function DailyActivityTable({ days = [], onOpenDay }) {
  const [sortConfig, onSort] = useSortConfig("date", "desc");
  const sorted = useMemo(() => sortRows(days, sortConfig.key, sortConfig.direction), [days, sortConfig]);

  const handleExport = () => {
    const rows = [
      ["Date", "Active Campaigns", "Spend", "Orders", "Prepaid", "COD", "Revenue", "ROAS"],
      ...sorted.map((d) => [d.date, d.activeCampaigns, d.spend, d.orders, d.prepaidOrders, d.codOrders, d.revenue, d.roas ?? ""]),
    ];
    downloadCsv(`campaign-activity-daily.csv`, rows);
  };

  if (!days.length) return <EmptyState message="No activity recorded for this range." />;

  return (
    <div className="card p-0 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <div className="text-sm font-semibold text-slate-700">Daily Campaign Activity</div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={handleExport}>
          <Download size={13} /> Export CSV
        </button>
      </div>
      <div className="overflow-auto">
        <table className="table">
          <thead>
            <tr>
              <Th label="Date" sortKey="date" sortConfig={sortConfig} onSort={onSort} />
              <Th label="Active Campaigns" sortKey="activeCampaigns" sortConfig={sortConfig} onSort={onSort} align="right" />
              <Th label="Spend" sortKey="spend" sortConfig={sortConfig} onSort={onSort} align="right" />
              <Th label="Orders" sortKey="orders" sortConfig={sortConfig} onSort={onSort} align="right" />
              <Th label="Prepaid" sortKey="prepaidOrders" sortConfig={sortConfig} onSort={onSort} align="right" />
              <Th label="COD" sortKey="codOrders" sortConfig={sortConfig} onSort={onSort} align="right" />
              <Th label="Revenue" sortKey="revenue" sortConfig={sortConfig} onSort={onSort} align="right" />
              <Th label="ROAS" sortKey="roas" sortConfig={sortConfig} onSort={onSort} align="right" />
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((d) => (
              <tr key={d.date} className="row-clickable" onClick={() => onOpenDay(d.date)}>
                <td className="font-medium text-slate-700">{formatDayLabel(d.date)}</td>
                <td className="num">{number(d.activeCampaigns)}</td>
                <td className="num">{currency(d.spend)}</td>
                <td className="num">{number(d.orders)}</td>
                <td className="num">{number(d.prepaidOrders)}</td>
                <td className="num">{number(d.codOrders)}</td>
                <td className="num">{currency(d.revenue)}</td>
                <td className="num">
                  <RoasValue roas={d.roas} />
                </td>
                <td className="num text-slate-300">
                  <ChevronRight size={14} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Spec §6/§8/§9/§12/§13 — generic 24-hour breakdown. Works for the
// account-wide rollup (mode="account") and for a single campaign/ad
// set/ad's own drill (mode="campaign"|"adset"|"ad") — the only real
// differences are which extra column applies (Active Campaigns count
// vs a single Status pill) and which child list a row's "View X"
// action opens. ──────────────────────────────────────────────────────
const CHILD_LABEL = { campaign: "Ad Sets", adset: "Ads" };

export function HourlyActivityTable({ hours = [], mode = "account", onOpenChildren, onOpenOrders }) {
  const [sortConfig, onSort] = useSortConfig("hour", "asc");
  const sorted = useMemo(() => sortRows(hours, sortConfig.key, sortConfig.direction), [hours, sortConfig]);
  const childLabel = CHILD_LABEL[mode] || null;

  const handleExport = () => {
    const rows = [
      ["Hour", "Status", "Active Campaigns", "Budget", "Bid Cap", "Spend", "Orders", "Prepaid", "COD", "Revenue", "ROAS"],
      ...sorted.map((h) => [
        hourRangeLabel(h.hour),
        h.status ?? "",
        h.activeCampaigns ?? "",
        h.budget ?? "",
        bidCapTextForRow(h) === "—" ? "" : bidCapTextForRow(h),
        h.spend,
        h.orders,
        h.prepaidOrders,
        h.codOrders,
        h.revenue,
        h.roas ?? "",
      ]),
    ];
    downloadCsv(`campaign-activity-hourly.csv`, rows);
  };

  if (!hours.length) return <EmptyState message="No hourly activity for this day." />;

  return (
    <div className="card p-0 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <div className="text-sm font-semibold text-slate-700">24-Hour Breakdown</div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={handleExport}>
          <Download size={13} /> Export CSV
        </button>
      </div>
      <div className="overflow-auto max-h-[560px]">
        <table className="table">
          <thead className="sticky top-0 z-[1]">
            <tr>
              <Th label="Hour" sortKey="hour" sortConfig={sortConfig} onSort={onSort} />
              {mode === "account" ? (
                <Th label="Active Campaigns" sortKey="activeCampaigns" sortConfig={sortConfig} onSort={onSort} align="right" />
              ) : (
                <th>Status</th>
              )}
              <th className="num">Budget</th>
              <th className="num">Bid Cap</th>
              <Th label="Spend" sortKey="spend" sortConfig={sortConfig} onSort={onSort} align="right" />
              <Th label="Orders" sortKey="orders" sortConfig={sortConfig} onSort={onSort} align="right" />
              <Th label="Prepaid" sortKey="prepaidOrders" sortConfig={sortConfig} onSort={onSort} align="right" />
              <Th label="COD" sortKey="codOrders" sortConfig={sortConfig} onSort={onSort} align="right" />
              <Th label="Revenue" sortKey="revenue" sortConfig={sortConfig} onSort={onSort} align="right" />
              <Th label="ROAS" sortKey="roas" sortConfig={sortConfig} onSort={onSort} align="right" />
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((h) => (
              <tr key={h.hour}>
                <td className="font-medium text-slate-700 whitespace-nowrap">{hourRangeLabel(h.hour)}</td>
                {mode === "account" ? (
                  <td className="num">{number(h.activeCampaigns)}</td>
                ) : (
                  <td>
                    <ActivityStatusPill status={h.status} />
                  </td>
                )}
                <td className="num">{budgetText(h.budget, h.budgetType)}</td>
                <td className="num">{bidCapTextForRow(h)}</td>
                <td className="num">{currency(h.spend)}</td>
                <td className="num">{number(h.orders)}</td>
                <td className="num">{number(h.prepaidOrders)}</td>
                <td className="num">{number(h.codOrders)}</td>
                <td className="num">{currency(h.revenue)}</td>
                <td className="num">
                  <RoasValue roas={h.roas} />
                </td>
                <td className="whitespace-nowrap">
                  <div className="flex items-center gap-1.5">
                    {mode === "account" && (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => onOpenChildren?.(h.hour)}>
                        Campaigns
                      </button>
                    )}
                    {childLabel && (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => onOpenChildren?.(h.hour)}>
                        {childLabel}
                      </button>
                    )}
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => onOpenOrders?.(h.hour)}>
                      Orders
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Spec §7/§17 — a list of campaigns, either scoped to one hour
// (buildCampaignsForHour, activeField="isActive") or to the whole day
// (buildCampaignsForDay, activeField="isActiveToday", the Campaign-
// Based mode's Day → Campaign entry point). Same columns either way. ──
export function CampaignsTable({ campaigns = [], activeField = "isActive", tokenId, since, until, onOpenCampaign }) {
  const [sortConfig, onSort] = useSortConfig("spend", "desc");
  const sorted = useMemo(() => sortRows(campaigns, sortConfig.key, sortConfig.direction), [campaigns, sortConfig]);

  const handleExport = () => {
    const rows = [
      ["Campaign", "Status", "Budget", "Bid Cap", "Spend", "Orders", "Prepaid", "COD", "Revenue", "ROAS"],
      ...sorted.map((c) => [
        c.campaignName,
        c.status ?? "",
        c.budget ?? "",
        bidCapTextForRow(c) === "—" ? "" : bidCapTextForRow(c),
        c.spend,
        c.orders,
        c.prepaidOrders,
        c.codOrders,
        c.revenue,
        c.roas ?? "",
      ]),
    ];
    downloadCsv(`campaign-activity-campaigns.csv`, rows);
  };

  if (!campaigns.length) return <EmptyState message="No campaigns were active or spending in this window." />;

  return (
    <div className="card p-0 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <div className="text-sm font-semibold text-slate-700">Campaigns</div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={handleExport}>
          <Download size={13} /> Export CSV
        </button>
      </div>
      <div className="overflow-auto max-h-[560px]">
        <table className="table">
          <thead className="sticky top-0 z-[1]">
            <tr>
              <Th label="Campaign" sortKey="campaignName" sortConfig={sortConfig} onSort={onSort} />
              <th>Status</th>
              <th className="num">Budget</th>
              <th className="num">Bid Cap</th>
              <Th label="Spend" sortKey="spend" sortConfig={sortConfig} onSort={onSort} align="right" />
              <Th label="Orders" sortKey="orders" sortConfig={sortConfig} onSort={onSort} align="right" />
              <Th label="Prepaid" sortKey="prepaidOrders" sortConfig={sortConfig} onSort={onSort} align="right" />
              <Th label="COD" sortKey="codOrders" sortConfig={sortConfig} onSort={onSort} align="right" />
              <Th label="Revenue" sortKey="revenue" sortConfig={sortConfig} onSort={onSort} align="right" />
              <Th label="ROAS" sortKey="roas" sortConfig={sortConfig} onSort={onSort} align="right" />
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => (
              <tr key={c.campaignId} className="row-clickable" onClick={() => onOpenCampaign(c)}>
                <td onClick={(e) => e.stopPropagation()}>
                  <CampaignLink
                    tokenId={tokenId}
                    campaignId={c.campaignId}
                    campaignName={c.campaignName}
                    since={since}
                    until={until}
                    className="!text-sm"
                  />
                  {c[activeField] && <span className="live-dot ml-2" title="Active" />}
                </td>
                <td>
                  <ActivityStatusPill status={c.status} />
                </td>
                <td className="num">{budgetText(c.budget, c.budgetType)}</td>
                <td className="num">{bidCapTextForRow(c)}</td>
                <td className="num">{currency(c.spend)}</td>
                <td className="num">{number(c.orders)}</td>
                <td className="num">{number(c.prepaidOrders)}</td>
                <td className="num">{number(c.codOrders)}</td>
                <td className="num">{currency(c.revenue)}</td>
                <td className="num">
                  <RoasValue roas={c.roas} />
                </td>
                <td className="num text-slate-300">
                  <ChevronRight size={14} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Spec §11 — Ad Sets under a Campaign, or Ads under an Ad Set, for
// one hour. `childLevel` is "adset" | "ad". ─────────────────────────
export function ChildrenTable({ children = [], childLevel, tokenId, since, until, campaignId, campaignName, adsetId, adsetName, onOpenChild }) {
  const [sortConfig, onSort] = useSortConfig("spend", "desc");
  const sorted = useMemo(() => sortRows(children, sortConfig.key, sortConfig.direction), [children, sortConfig]);
  const idKey = childLevel === "adset" ? "adsetId" : "adId";
  const label = childLevel === "adset" ? "Ad Set" : "Ad";

  const handleExport = () => {
    const rows = [
      [label, "Status", "Budget", "Bid Cap", "Spend", "Orders", "Prepaid", "COD", "Revenue", "ROAS"],
      ...sorted.map((c) => [c.name, c.status ?? "", c.budget ?? "", c.bidCap ?? "", c.spend, c.orders, c.prepaidOrders, c.codOrders, c.revenue, c.roas ?? ""]),
    ];
    downloadCsv(`campaign-activity-${childLevel}s.csv`, rows);
  };

  if (!children.length) return <EmptyState message={`No ${label.toLowerCase()}s were active or spending in this hour.`} />;

  return (
    <div className="card p-0 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <div className="text-sm font-semibold text-slate-700">{label}s</div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={handleExport}>
          <Download size={13} /> Export CSV
        </button>
      </div>
      <div className="overflow-auto max-h-[560px]">
        <table className="table">
          <thead className="sticky top-0 z-[1]">
            <tr>
              <Th label={label} sortKey="name" sortConfig={sortConfig} onSort={onSort} />
              <th>Status</th>
              <th className="num">Budget</th>
              <th className="num">Bid Cap</th>
              <Th label="Spend" sortKey="spend" sortConfig={sortConfig} onSort={onSort} align="right" />
              <Th label="Orders" sortKey="orders" sortConfig={sortConfig} onSort={onSort} align="right" />
              <Th label="Prepaid" sortKey="prepaidOrders" sortConfig={sortConfig} onSort={onSort} align="right" />
              <Th label="COD" sortKey="codOrders" sortConfig={sortConfig} onSort={onSort} align="right" />
              <Th label="Revenue" sortKey="revenue" sortConfig={sortConfig} onSort={onSort} align="right" />
              <Th label="ROAS" sortKey="roas" sortConfig={sortConfig} onSort={onSort} align="right" />
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => (
              <tr key={c[idKey]} className="row-clickable" onClick={() => onOpenChild(c)}>
                <td onClick={(e) => e.stopPropagation()}>
                  {childLevel === "adset" ? (
                    <AdSetLink
                      tokenId={tokenId}
                      adsetId={c.adsetId}
                      adsetName={c.name}
                      campaignId={campaignId}
                      campaignName={campaignName}
                      since={since}
                      until={until}
                      className="!text-sm"
                    />
                  ) : (
                    <AdLink
                      tokenId={tokenId}
                      adId={c.adId}
                      adName={c.name}
                      adsetId={adsetId}
                      adsetName={adsetName}
                      campaignId={campaignId}
                      campaignName={campaignName}
                      since={since}
                      until={until}
                      className="!text-sm"
                    />
                  )}
                  {c.isActive && <span className="live-dot ml-2" title="Active" />}
                </td>
                <td>
                  <ActivityStatusPill status={c.status} />
                </td>
                <td className="num">{c.budget === null || c.budget === undefined ? "—" : currency(c.budget)}</td>
                <td className="num">{c.bidCap === null || c.bidCap === undefined ? "—" : currency(c.bidCap)}</td>
                <td className="num">{currency(c.spend)}</td>
                <td className="num">{number(c.orders)}</td>
                <td className="num">{number(c.prepaidOrders)}</td>
                <td className="num">{number(c.codOrders)}</td>
                <td className="num">{currency(c.revenue)}</td>
                <td className="num">
                  <RoasValue roas={c.roas} />
                </td>
                <td className="num text-slate-300">
                  <ChevronRight size={14} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
