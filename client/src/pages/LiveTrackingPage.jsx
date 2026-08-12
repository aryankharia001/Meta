import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchLiveTracking } from "../lib/api";

// Live order-VOLUME tracking (orders placed 1h/2h/3h ago + an hourly
// breakdown) — sourced purely from Mongo (the orders your existing 30-min
// Shiprocket auto-sync already pulled in). This never calls Shiprocket
// directly, so it can't 429 and doesn't touch the sync/matching code at all.
//
// True courier/shipment tracking would need a separate Shiprocket
// email+password login (different from the checkout-API key/secret this
// app already uses) — not wired up since those credentials aren't
// available yet.
//
// Each order is bucketed into an hour using ITS OWN orderCreatedAt
// timestamp (falling back to the record's sync time only if that's
// missing) — not the day-level orderDate field — so hours genuinely
// differ from one another instead of all showing the same totals. For
// multi-day ranges (7/30 days) the hourly chart becomes "which hour of
// the day do orders tend to land in, across every day in the range."

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

const AUTO_REFRESH_MS = 60 * 60 * 1000; // hourly, per the request

function formatHour(hour) {
  const period = hour < 12 ? "AM" : "PM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}${period}`;
}

export default function LiveTrackingPage() {
  const [preset, setPreset] = useState("today");
  const { since, until } = useMemo(() => PRESETS.find((p) => p.key === preset).range(), [preset]);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastFetchedAt, setLastFetchedAt] = useState(null);

  const timerRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetchLiveTracking({ since, until });
      setData(res);
      setLastFetchedAt(new Date());
    } catch (err) {
      setError(err.message || "Failed to load live tracking");
    } finally {
      setLoading(false);
    }
  }, [since, until]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    timerRef.current = setInterval(load, AUTO_REFRESH_MS);
    return () => clearInterval(timerRef.current);
  }, [load]);

  const recent = data?.recent;
  const hourly = data?.hourly || [];
  const maxCount = Math.max(1, ...hourly.map((h) => h.orderCount));

  return (
    <div className="max-w-[1000px] mx-auto p-6">
      <div className="flex justify-between items-start gap-4 mb-2 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-slate-800 mb-1">Live Order Tracking</h1>
          <p className="text-sm text-slate-500 max-w-[520px]">
            Order volume over time, built from orders already synced into Mongo. Auto-refreshes hourly.
          </p>
        </div>
        <button className="btn btn-primary" onClick={load} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="flex gap-1.5 my-4 bg-slate-100 rounded-lg p-1 w-fit">
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

      {error && (
        <div className="mt-3 text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>
      )}

      {lastFetchedAt && (
        <div className="mt-2.5 mb-1.5 text-xs text-slate-400">
          Last updated {lastFetchedAt.toLocaleTimeString()} — auto-refreshes every hour · {since}
          {until !== since ? ` → ${until}` : ""}
          {data?.missingTimestampCount > 0 && (
            <span className="text-amber-600">
              {" "}· {data.missingTimestampCount} order(s) missing a Shiprocket timestamp (bucketed by sync time instead)
            </span>
          )}
        </div>
      )}

      {recent && (
        <div className="flex gap-3.5 flex-wrap mt-4 mb-6">
          <StatCard label="Last 1 hour" orders={recent.last1h.orderCount} revenue={recent.last1h.revenue} />
          <StatCard label="Last 2 hours" orders={recent.last2h.orderCount} revenue={recent.last2h.revenue} />
          <StatCard label="Last 3 hours" orders={recent.last3h.orderCount} revenue={recent.last3h.revenue} />
          <StatCard label="Last 6 hours" orders={recent.last6h.orderCount} revenue={recent.last6h.revenue} />
          <StatCard
            label={until !== since ? `${since} → ${until}` : `${since} total`}
            orders={data.totalOrders}
            revenue={data.totalRevenue}
            highlight
          />
        </div>
      )}

      <div className="card">
        <div className="text-sm font-semibold text-slate-700 mb-4">
          Orders by hour (IST){until !== since ? " — summed across the whole range" : ""}
        </div>
        <div className="flex items-end gap-1 h-40">
          {hourly.map((h) => (
            <div key={h.hour} className="flex-1 flex flex-col items-center justify-end h-full group relative">
              <div
                className="absolute -top-6 text-[11px] text-slate-600 font-medium opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap"
              >
                {h.orderCount} · ₹{h.revenue}
              </div>
              <div
                className={`w-full rounded-t-[3px] transition-all ${
                  until === since && h.hour === data?.currentHourIst ? "bg-blue-600" : "bg-blue-200"
                }`}
                style={{ height: `${Math.max((h.orderCount / maxCount) * 100, h.orderCount > 0 ? 4 : 1)}%` }}
              />
              <div className="text-[10px] text-slate-400 mt-1">{formatHour(h.hour)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, orders, revenue, highlight }) {
  return (
    <div className={`card flex-1 min-w-[150px] ${highlight ? "bg-blue-50 border-blue-200" : ""}`}>
      <div className="text-xs text-slate-500 mb-1.5">{label}</div>
      <div className="text-2xl font-bold text-slate-800">{orders}</div>
      <div className="text-xs text-slate-500 mt-1">orders · ₹{revenue?.toLocaleString?.() ?? revenue}</div>
    </div>
  );
}
