import { useState } from "react";
import { RefreshCw, Building2 } from "lucide-react";
import { fetchLiveAdAccounts } from "../lib/api";
import { useSelectedToken } from "../lib/useSelectedToken";

// Pulls ad accounts straight from the Meta Graph API for the selected
// token (GET /api/adaccounts/adaccounts/:tokenId) — this is always
// current, unlike the locally-synced AdAccount collection the other pages
// read from. Read-only view; doesn't touch sync/matching logic anywhere.

const STATUS_LABELS = {
  1: { label: "Active", tone: "badge-green" },
  2: { label: "Disabled", tone: "badge-rose" },
  3: { label: "Unsettled", tone: "badge-amber" },
  7: { label: "Pending review", tone: "badge-amber" },
  8: { label: "In grace period", tone: "badge-amber" },
  9: { label: "In grace period", tone: "badge-amber" },
  100: { label: "Pending closure", tone: "badge-rose" },
  101: { label: "Closed", tone: "badge-slate" },
};

export default function AdAccountsPage() {
  const { tokenId: TOKEN_ID, setTokenId, tokens } = useSelectedToken();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fetched, setFetched] = useState(false);

  const handleFetch = async () => {
    if (!TOKEN_ID) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetchLiveAdAccounts(TOKEN_ID);
      if (!res.success) throw new Error(res.message || "Failed to fetch ad accounts");
      setAccounts(res.adAccounts || []);
      setFetched(true);
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message || "Failed to fetch ad accounts");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-[1000px] mx-auto p-6">
      <div className="flex items-center gap-2.5 mb-1">
        <Building2 size={20} className="text-blue-600" />
        <h1 className="text-xl font-semibold text-slate-800">Ad Accounts</h1>
      </div>
      <p className="text-sm text-slate-500 mb-6 max-w-[560px]">
        Fetched live from the Meta Graph API for the selected token — always current, no sync step needed.
      </p>

      <div className="flex items-center gap-2.5 mb-5 flex-wrap">
        <label className="text-sm text-slate-600">Token:</label>
        <select className="input w-auto" value={TOKEN_ID || ""} onChange={(e) => setTokenId(e.target.value)}>
          {tokens.length === 0 && <option value={TOKEN_ID}>{TOKEN_ID}</option>}
          {tokens.map((t) => (
            <option key={t._id} value={t._id}>
              {t.label || t._id}
            </option>
          ))}
        </select>

        <button className="btn btn-primary" onClick={handleFetch} disabled={loading || !TOKEN_ID}>
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          {loading ? "Fetching…" : "Fetch Ad Accounts"}
        </button>
      </div>

      {error && (
        <div className="mb-4 text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>
      )}

      {fetched && !error && accounts.length === 0 && (
        <div className="text-center text-slate-500 border border-dashed border-slate-300 rounded-xl py-10">
          No ad accounts found for this token.
        </div>
      )}

      {accounts.length > 0 && (
        <div className="card p-0 overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Account ID</th>
                <th>Status</th>
                <th>Currency</th>
                <th>Timezone</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => {
                const status = STATUS_LABELS[a.account_status] || { label: a.account_status, tone: "badge-slate" };
                return (
                  <tr key={a.id}>
                    <td>{a.name || <span className="text-slate-400">—</span>}</td>
                    <td className="font-mono text-xs">{a.id}</td>
                    <td>
                      <span className={`badge ${status.tone}`}>{status.label}</span>
                    </td>
                    <td>{a.currency}</td>
                    <td>{a.timezone_name}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
