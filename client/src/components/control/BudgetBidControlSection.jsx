import { useState } from "react";
import CurrentValuesCard from "./CurrentValuesCard";
import EditBudgetModal from "./EditBudgetModal";
import EditBidCapModal from "./EditBidCapModal";
import DateRangeFilterBar from "./DateRangeFilterBar";
import ActivityTimeline from "./ActivityTimeline";
import HourlyControlPanel from "./HourlyControlPanel";
import { shiftDays, todayIso } from "../../lib/dateIst";

// Phase 27 — the full "Budget & Bid Cap Control" section wired together:
// Current Values + Edit modals + date filter + Activity Timeline +
// Hourly Performance. One new file composing the other new Phase 27
// components, so CampaignDrawer.jsx/AdSetDrawer.jsx each only need to
// add a single <BudgetBidControlSection level=... /> block rather than
// wiring six components individually — same "one shared block used by
// both drawers" pattern HourlyPanel/EntityNotesPanel already establish.
//
// level: "campaign" | "adset". identifies which control endpoints/edit
// affordances to use (Bid Cap editing only applies at "adset").
export default function BudgetBidControlSection({ level, tokenId, entityId, tableIdSuffix }) {
  const [editBudgetFor, setEditBudgetFor] = useState(null);
  const [editBidCapFor, setEditBidCapFor] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [range, setRange] = useState({ since: shiftDays(todayIso(), -6), until: todayIso(), useExact: false, exactFrom: null, exactUntil: null });

  const historySince = range.useExact ? range.exactFrom : range.since;
  const historyUntil = range.useExact ? range.exactUntil : range.until;

  return (
    <div className="space-y-4">
      <CurrentValuesCard
        key={refreshKey}
        level={level}
        tokenId={tokenId}
        entityId={entityId}
        onEditBudget={(current) => setEditBudgetFor(current)}
        onEditBidCap={(current) => setEditBidCapFor(current)}
      />

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="text-sm font-semibold text-slate-700 mb-2">Activity Timeline</div>
        <DateRangeFilterBar value={range} onChange={setRange} />
        <div className="mt-3">
          <ActivityTimeline level={level} tokenId={tokenId} entityId={entityId} since={historySince} until={historyUntil} />
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <HourlyControlPanel level={level} tokenId={tokenId} entityId={entityId} tableIdSuffix={tableIdSuffix} />
      </div>

      {editBudgetFor && (
        <EditBudgetModal
          open
          level={level}
          tokenId={tokenId}
          entityId={entityId}
          currentBudget={editBudgetFor.budget}
          currentBudgetType={editBudgetFor.budgetType || "daily"}
          onClose={() => setEditBudgetFor(null)}
          onSuccess={() => setRefreshKey((k) => k + 1)}
        />
      )}

      {editBidCapFor && (
        <EditBidCapModal
          open
          tokenId={tokenId}
          entityId={entityId}
          currentBidAmount={editBidCapFor.bidAmount}
          onClose={() => setEditBidCapFor(null)}
          onSuccess={() => setRefreshKey((k) => k + 1)}
        />
      )}
    </div>
  );
}
