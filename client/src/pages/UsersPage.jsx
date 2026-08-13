import { useEffect, useState } from "react";
import { UserCog, Plus, Loader2, ShieldCheck, Ban, CheckCircle2, KeyRound, Trash2, AlertTriangle, X } from "lucide-react";
import { fetchUsers, createUser, updateUser, resetUserPassword, deleteUser } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { useAuth } from "../lib/AuthContext";

// ────────────────────────────────────────────────────────────────
// Phase 14 §2 — simple admin-only user management page. Talks only to
// the new /api/users routes (server/routes/users.js), which are
// entirely additive and gated by requireAdmin server-side — this page
// itself is reachable only for admins (see RequireAdmin in App.jsx).
// Deliberately flat/simple per the spec: just "admin" vs "user", no
// custom permission builder.
// ────────────────────────────────────────────────────────────────

function AddUserForm({ onAdded }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("user");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setError("");
    setSubmitting(true);
    try {
      const res = await createUser({ email: email.trim(), password, role });
      onAdded(res.user);
      setEmail("");
      setPassword("");
      setRole("user");
    } catch (err) {
      setError(err.message || "Failed to add user");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="card flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-xs text-slate-500 flex-1 min-w-[180px]">
        Email
        <input
          type="email"
          className="input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@company.com"
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-500 flex-1 min-w-[160px]">
        Password
        <input
          type="text"
          className="input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Min. 8 characters"
          required
          minLength={8}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-500">
        Role
        <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="user">User</option>
          <option value="admin">Admin</option>
        </select>
      </label>
      <button type="submit" className="btn btn-primary btn-sm" disabled={submitting}>
        {submitting ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
        Add User
      </button>
      {error && (
        <div className="w-full flex items-center gap-1.5 text-xs text-rose-600">
          <AlertTriangle size={12} /> {error}
        </div>
      )}
    </form>
  );
}

function ResetPasswordModal({ user, onClose, onDone }) {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setError("");
    setSubmitting(true);
    try {
      await resetUserPassword(user.id, password);
      onDone();
    } catch (err) {
      setError(err.message || "Failed to reset password");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="font-display font-semibold text-sm text-slate-800">Reset password</div>
          <button type="button" className="text-slate-400 hover:text-slate-600" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <p className="text-xs text-slate-400">{user.email}</p>
        <input
          type="text"
          className="input w-full"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="New password (min. 8 characters)"
          minLength={8}
          required
          autoFocus
        />
        {error && <div className="text-xs text-rose-600">{error}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={submitting}>
            {submitting ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />}
            Reset
          </button>
        </div>
      </form>
    </div>
  );
}

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [resetTarget, setResetTarget] = useState(null);

  const load = () => {
    setLoading(true);
    setError("");
    fetchUsers()
      .then((res) => setUsers(res.users || []))
      .catch((err) => setError(err.message || "Failed to load users"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handleToggleDisabled = async (u) => {
    setBusyId(u.id);
    try {
      const res = await updateUser(u.id, { disabled: !u.disabled });
      setUsers((prev) => prev.map((x) => (x.id === u.id ? res.user : x)));
    } catch (err) {
      setError(err.message || "Failed to update user");
    } finally {
      setBusyId(null);
    }
  };

  const handleRoleChange = async (u, role) => {
    setBusyId(u.id);
    try {
      const res = await updateUser(u.id, { role });
      setUsers((prev) => prev.map((x) => (x.id === u.id ? res.user : x)));
    } catch (err) {
      setError(err.message || "Failed to update role");
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (u) => {
    if (!window.confirm(`Remove access for ${u.email}? This can't be undone.`)) return;
    setBusyId(u.id);
    try {
      await deleteUser(u.id);
      setUsers((prev) => prev.filter((x) => x.id !== u.id));
    } catch (err) {
      setError(err.message || "Failed to delete user");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-2.5">
        <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-slate-700 to-slate-900 text-white shadow-md">
          <UserCog size={18} />
        </span>
        <div>
          <h1 className="text-lg font-display font-bold text-slate-800 leading-tight">Users</h1>
          <p className="text-xs text-slate-400">Manage who can sign in to this application</p>
        </div>
      </div>

      <AddUserForm onAdded={(u) => setUsers((prev) => [u, ...prev])} />

      {error && (
        <div className="flex items-center gap-1.5 text-xs text-rose-600">
          <AlertTriangle size={12} /> {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card h-14 animate-pulse bg-slate-100" />
          ))}
        </div>
      ) : (
        <div className="card overflow-hidden !p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Email</th>
                <th className="px-4 py-2.5 font-medium">Role</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Last Login</th>
                <th className="px-4 py-2.5 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => {
                const isSelf = u.id === currentUser?.id;
                const isBusy = busyId === u.id;
                return (
                  <tr key={u.id} className={u.disabled ? "opacity-50" : ""}>
                    <td className="px-4 py-2.5 text-slate-700">
                      {u.email}
                      {isSelf && <span className="badge badge-blue text-[10px] ml-1.5">You</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <select
                        className="input !py-1 !text-xs w-auto"
                        value={u.role}
                        disabled={isBusy}
                        onChange={(e) => handleRoleChange(u, e.target.value)}
                      >
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td className="px-4 py-2.5">
                      {u.disabled ? (
                        <span className="badge badge-slate text-[10px]">Disabled</span>
                      ) : (
                        <span className="badge badge-green text-[10px]">Active</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-400">{formatDateTime(u.lastLoginAt)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          className="text-slate-400 hover:text-indigo-600 disabled:opacity-40"
                          title="Reset password"
                          disabled={isBusy}
                          onClick={() => setResetTarget(u)}
                        >
                          <KeyRound size={14} />
                        </button>
                        <button
                          type="button"
                          className={`disabled:opacity-40 ${u.disabled ? "text-slate-400 hover:text-emerald-600" : "text-slate-400 hover:text-amber-600"}`}
                          title={u.disabled ? "Enable user" : "Disable user"}
                          disabled={isBusy || isSelf}
                          onClick={() => handleToggleDisabled(u)}
                        >
                          {u.disabled ? <CheckCircle2 size={14} /> : <Ban size={14} />}
                        </button>
                        <button
                          type="button"
                          className="text-slate-400 hover:text-rose-600 disabled:opacity-40"
                          title="Delete user"
                          disabled={isBusy || isSelf}
                          onClick={() => handleDelete(u)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {users.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-400">
                    No users yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
        <ShieldCheck size={12} /> Admins can manage users; everyone else can only use the application.
      </p>

      {resetTarget && (
        <ResetPasswordModal
          user={resetTarget}
          onClose={() => setResetTarget(null)}
          onDone={() => setResetTarget(null)}
        />
      )}
    </div>
  );
}
