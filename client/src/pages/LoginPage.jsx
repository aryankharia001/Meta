import { useState } from "react";
import { Eye, EyeOff, Loader2, BarChart3, AlertCircle } from "lucide-react";
import { useAuth } from "../lib/AuthContext";

// ─────────────────────────────────────────────────────────────
// Phase 14 §1 — Login page. Rendered by App.jsx in place of the whole
// app shell whenever AuthContext's status is "unauthenticated" — no
// sidebar, no routes, no other providers mounted underneath it, so
// nothing here can accidentally call a protected endpoint before
// login. There is no signup link/route anywhere in the app: accounts
// are only ever created by an admin via the Users page.
// ─────────────────────────────────────────────────────────────

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    setError("");
    setLoading(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err.message || "Invalid email or password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-900 to-slate-950 p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-2.5 mb-6">
          <span className="flex items-center justify-center w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-500/30">
            <BarChart3 size={20} />
          </span>
          <div className="text-center">
            <div className="font-display font-bold text-lg text-white leading-tight">Meta Analyzer</div>
            <div className="text-xs text-slate-500">Sign in to continue</div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="card bg-white rounded-2xl p-6 space-y-4 shadow-2xl" noValidate>
          {error && (
            <div className="flex items-start gap-2 text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2.5">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            Email
            <input
              type="email"
              autoComplete="username"
              className="input w-full"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              required
              autoFocus
            />
          </label>

          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            Password
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                className="input w-full pr-9"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                tabIndex={-1}
                title={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </label>

          <button type="submit" className="btn btn-primary w-full justify-center" disabled={loading || !email || !password}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : null}
            {loading ? "Signing in…" : "Log In"}
          </button>
        </form>

        <p className="text-center text-[11px] text-slate-600 mt-4">Only pre-authorized accounts can access this application.</p>
      </div>
    </div>
  );
}
