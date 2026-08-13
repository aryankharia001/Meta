import { Component } from "react";
import { AlertTriangle } from "lucide-react";

// ────────────────────────────────────────────────────────────────
// Fixes the "blank page" bug: App.jsx's single <ErrorBoundary> only
// wraps the routed page content (<RoutedContent/>), not the five
// global overlay drawers (Campaign/Order/Customer/AdSet/Ad), which
// render as siblings of it. If any drawer throws during render
// (including mid-close/unmount), that error was previously uncaught —
// it escaped to the React root and unmounted the ENTIRE app, blanking
// out whatever page/table/filters the user had underneath.
//
// This is the same class-based getDerivedStateFromError/componentDidCatch
// pattern as ErrorBoundary.jsx, but scoped for a single overlay: on
// error it shows a small centered card (never a full blank page, never
// touches window.location) with a Close button that both resets this
// boundary's own error state AND calls the drawer's real close
// function (onClose), so the drawer's context state (activeCampaign/
// activeOrder/etc) clears too — otherwise the drawer would stay "open"
// per its context while rendering nothing.
//
// Wrapped around each of the five drawers INDIVIDUALLY in App.jsx
// (not one shared boundary for all five) so an error in one drawer can
// never blank out or break any other drawer or the page underneath.
// ────────────────────────────────────────────────────────────────

export default class DrawerErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error("DrawerErrorBoundary caught:", error, info);
  }

  handleClose = () => {
    this.setState({ hasError: false, error: null });
    this.props.onClose?.();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
          <span className="flex items-center justify-center w-12 h-12 rounded-2xl bg-rose-100 text-rose-600 mx-auto mb-3">
            <AlertTriangle size={22} />
          </span>
          <h3 className="font-display font-semibold text-slate-700 mb-1">Something went wrong opening this panel</h3>
          <p className="text-sm text-slate-400 mb-4">
            {this.state.error?.message || "This panel hit an unexpected error. The rest of the app is unaffected."}
          </p>
          <button type="button" className="btn btn-secondary w-full justify-center" onClick={this.handleClose}>
            Close
          </button>
        </div>
      </div>
    );
  }
}
