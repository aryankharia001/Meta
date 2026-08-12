import { useEffect, useState } from "react";
import { fetchTokens, createToken, updateToken, deleteToken } from "../lib/api";

// CRUD page for Facebook access tokens (the `Token` model). Nothing here
// touches Shiprocket sync or order/campaign matching — this only replaces
// "hardcode a token id in the client / insert into Mongo by hand" with a
// normal manage-tokens screen. Ad accounts (and campaign data pulled with
// a token) cascade-delete on the backend when a token is deleted.

function maskToken(token) {
  if (!token) return "";
  if (token.length <= 10) return "•".repeat(token.length);
  return `${token.slice(0, 6)}${"•".repeat(10)}${token.slice(-4)}`;
}

const emptyForm = { accessToken: "", label: "", note: "" };

export default function TokensPage() {
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [revealId, setRevealId] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetchTokens();
      setTokens(res.data || []);
    } catch (err) {
      setError(err.message || "Failed to load tokens");
    } finally {
      setLoading(false);
    }
  };

  const openAdd = () => {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
    setMessage("");
    setError("");
  };

  const openEdit = (token) => {
    setEditingId(token._id);
    setForm({ accessToken: token.accessToken, label: token.label || "", note: token.note || "" });
    setShowForm(true);
    setMessage("");
    setError("");
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.accessToken.trim()) {
      setError("Access token is required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (editingId) {
        await updateToken(editingId, form);
        setMessage("Token updated.");
      } else {
        await createToken(form);
        setMessage("Token added.");
      }
      closeForm();
      await load();
    } catch (err) {
      setError(err.message || "Failed to save token");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (token) => {
    const label = token.label || maskToken(token.accessToken);
    if (!window.confirm(`Delete token "${label}"? Any linked ad accounts will be removed too.`)) return;
    try {
      await deleteToken(token._id);
      setMessage("Token deleted.");
      await load();
    } catch (err) {
      setError(err.message || "Failed to delete token");
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard?.writeText(text).then(
      () => setMessage("Copied to clipboard."),
      () => {}
    );
  };

  return (
    <div className="max-w-[900px] mx-auto p-6">
      <div className="flex justify-between items-start gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-slate-800 mb-1">Facebook Tokens</h1>
          <p className="text-sm text-slate-500 max-w-[540px]">
            Manage the access tokens used across Campaigns, Comparison, and Ad Accounts. Deleting a token also
            removes its linked ad accounts.
          </p>
        </div>
        <button className="btn btn-primary" onClick={openAdd}>
          + Add Token
        </button>
      </div>

      {error && <div className="mb-4 text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>}
      {message && !error && (
        <div className="mb-4 text-sm text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{message}</div>
      )}

      {showForm && (
        <form onSubmit={handleSave} className="card flex flex-col gap-3 mb-6 max-w-[480px]">
          <div className="text-sm font-semibold text-slate-800">{editingId ? "Edit token" : "New token"}</div>

          <label className="flex flex-col text-sm text-slate-600 gap-1.5">
            Label
            <input
              className="input"
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="e.g. Main Ad Account"
            />
          </label>

          <label className="flex flex-col text-sm text-slate-600 gap-1.5">
            Access token
            <textarea
              className="input min-h-[70px] resize-y font-mono text-xs"
              value={form.accessToken}
              onChange={(e) => setForm({ ...form, accessToken: e.target.value })}
              placeholder="Paste the Facebook access token"
              required
            />
          </label>

          <label className="flex flex-col text-sm text-slate-600 gap-1.5">
            Note
            <input
              className="input"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              placeholder="Optional notes (expiry, which app, etc.)"
            />
          </label>

          <div className="flex gap-2.5 mt-1">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Saving…" : editingId ? "Save changes" : "Add token"}
            </button>
            <button type="button" className="btn btn-secondary" onClick={closeForm}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm"><span className="spinner" /> Loading tokens…</div>
      ) : tokens.length === 0 ? (
        <div className="text-center text-slate-500 border border-dashed border-slate-300 rounded-xl py-10">
          No tokens yet. Click "Add Token" to create one.
        </div>
      ) : (
        <div className="card p-0 overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Label</th>
              <th>Access token</th>
              <th>Note</th>
              <th>Added</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((t) => (
              <tr key={t._id}>
                <td>{t.label || <span className="text-slate-400">—</span>}</td>
                <td>
                  <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">
                    {revealId === t._id ? t.accessToken : maskToken(t.accessToken)}
                  </code>
                  <button
                    className="ml-2.5 text-blue-600 text-xs hover:underline"
                    onClick={() => setRevealId(revealId === t._id ? null : t._id)}
                  >
                    {revealId === t._id ? "Hide" : "Show"}
                  </button>
                  <button className="ml-2.5 text-blue-600 text-xs hover:underline" onClick={() => copyToClipboard(t.accessToken)}>
                    Copy
                  </button>
                </td>
                <td>{t.note || <span className="text-slate-400">—</span>}</td>
                <td>
                  {t.createdAt ? new Date(t.createdAt).toLocaleDateString() : <span className="text-slate-400">—</span>}
                </td>
                <td className="whitespace-nowrap">
                  <button className="text-blue-600 text-xs hover:underline" onClick={() => openEdit(t)}>
                    Edit
                  </button>
                  <button className="ml-2.5 text-rose-600 text-xs hover:underline" onClick={() => handleDelete(t)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}
