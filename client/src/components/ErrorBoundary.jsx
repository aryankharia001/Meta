import { Component } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

// ────────────────────────────────────────────────────────────────
// Phase 7 — Error Handling / Code Quality. A single reusable boundary
// wrapped around the routed page content in App.jsx, so a render error
// in any one page shows a friendly recovery screen instead of a blank
// white app. Purely a safety net — it doesn't change what any page
// does when things go right.
// ────────────────────────────────────────────────────────────────

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error("ErrorBoundary caught:", error, info);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
        <span className="flex items-center justify-center w-14 h-14 rounded-2xl bg-rose-100 text-rose-600 mb-4">
          <AlertTriangle size={26} />
        </span>
        <h2 className="font-display font-semibold text-slate-700 mb-1">Something went wrong</h2>
        <p className="text-sm text-slate-400 max-w-sm mb-5">
          {this.state.error?.message || "This page hit an unexpected error. Your data is safe — try again."}
        </p>
        <div className="flex gap-2">
          <button type="button" className="btn btn-primary btn-sm" onClick={this.handleReset}>
            <RefreshCw size={14} /> Try again
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => window.location.assign("/")}>
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }
}
