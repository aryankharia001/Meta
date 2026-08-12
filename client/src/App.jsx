import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Routes, Route, NavLink, useLocation, useNavigate } from "react-router-dom";
import { usePreferences } from "./lib/PreferencesContext";
import {
  RefreshCw,
  ShoppingCart,
  Megaphone,
  GitCompareArrows,
  Radio,
  Activity,
  Building2,
  KeyRound,
  BarChart3,
  LayoutDashboard,
  TrendingUp,
  Settings as SettingsIcon,
  Star,
  History,
  Download,
  Compass,
  CalendarDays,
} from "lucide-react";
// Phase 7 — Performance: Dashboard is the default landing page, so it
// stays a normal eager import (no loading flash on the most common
// first paint). Every other page is code-split via React.lazy() —
// pure build-time/loading behavior, none of these components change.
import Dashboard from "./pages/Dashboard";
const DailyPage = lazy(() => import("./pages/DailyPage"));
const CampaignExplorerPage = lazy(() => import("./pages/CampaignExplorerPage"));
const AnalyticsPage = lazy(() => import("./pages/AnalyticsPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const FavoritesPage = lazy(() => import("./pages/FavoritesPage"));
const ActivityLogPage = lazy(() => import("./pages/ActivityLogPage"));
const ExportCenterPage = lazy(() => import("./pages/ExportCenterPage"));
const ShiprocketSyncPage = lazy(() => import("./pages/ShiprocketSyncPage"));
const OrdersTesting = lazy(() => import("./pages/OrdersTesting"));
const CampaignTesting = lazy(() => import("./pages/CampaignTesting"));
const CampaignComparison = lazy(() => import("./pages/CampaignComparison"));
const TokensPage = lazy(() => import("./pages/TokensPage"));
const LiveTrackingPage = lazy(() => import("./pages/LiveTrackingPage"));
const AdAccountsPage = lazy(() => import("./pages/AdAccountsPage"));
const LiveCampaignsPage = lazy(() => import("./pages/LiveCampaignsPage"));
import { ShiprocketSyncProvider, useShiprocketSync } from "./lib/ShiprocketSyncContext";
import { CampaignDrawerProvider } from "./lib/CampaignDrawerContext";
import CampaignDrawer from "./components/CampaignDrawer";
import { OrderDrawerProvider } from "./lib/OrderDrawerContext";
import OrderDrawer from "./components/OrderDrawer";
import { CustomerDrawerProvider } from "./lib/CustomerDrawerContext";
import CustomerDrawer from "./components/CustomerDrawer";
import { LiveSyncProvider } from "./lib/LiveSyncContext";
import { PreferencesProvider } from "./lib/PreferencesContext";
import { FavoritesProvider } from "./lib/FavoritesContext";
import { NotificationsProvider } from "./lib/NotificationsContext";
import NotificationBell from "./components/NotificationBell";
import KeyboardShortcuts from "./components/KeyboardShortcuts";
import ErrorBoundary from "./components/ErrorBoundary";
import NetworkStatusBanner from "./components/NetworkStatusBanner";

const navGroups = [
  {
    label: "Orders",
    links: [
      { to: "/sync", label: "Shiprocket Sync", icon: RefreshCw },
      { to: "/order-testing", label: "Orders", icon: ShoppingCart },
      { to: "/live-tracking", label: "Live Orders", icon: Radio },
    ],
  },
  {
    label: "Campaigns",
    links: [
      { to: "/campaign-testing", label: "Campaigns", icon: Megaphone },
      { to: "/adorder-comparison", label: "Comparison", icon: GitCompareArrows },
      { to: "/live-campaigns", label: "Live Dashboard", icon: Activity },
    ],
  },
  {
    label: "Setup",
    links: [
      { to: "/ad-accounts", label: "Ad Accounts", icon: Building2 },
      { to: "/tokens", label: "Tokens", icon: KeyRound },
      { to: "/activity-log", label: "Activity Log", icon: History },
      { to: "/export-center", label: "Export Center", icon: Download },
      { to: "/settings", label: "Settings", icon: SettingsIcon },
    ],
  },
];

// Small site-wide indicator so an in-progress Shiprocket fetch is visible
// no matter which page you're on, not just when you happen to be looking
// at the Sync page. Reads from the same ShiprocketSyncContext the Sync
// page itself uses, so it always reflects the real, live state.
function SyncStatusBadge() {
  const { starting, progress } = useShiprocketSync();
  if (!starting) return null;

  const backfill = progress?.backfill;
  const pct = backfill && backfill.daysTotal > 0 ? Math.round((backfill.daysDone / backfill.daysTotal) * 100) : 0;

  return (
    <NavLink
      to="/sync"
      className="mx-3 mb-3 flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-white/5 border border-white/10 no-underline hover:bg-white/10 transition-colors"
    >
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
      </span>
      <div className="min-w-0">
        <div className="text-xs font-medium text-white truncate">
          Syncing orders… {backfill ? `${backfill.daysDone}/${backfill.daysTotal}` : ""}
        </div>
        <div className="text-[11px] text-slate-500 truncate">
          {backfill?.currentDay ? `On ${backfill.currentDay} · ${pct}%` : "Starting…"}
        </div>
      </div>
    </NavLink>
  );
}

function Sidebar() {
  return (
    <aside className="hidden md:flex md:w-64 shrink-0 h-screen sticky top-0 flex-col bg-gradient-to-b from-slate-900 to-slate-950 text-slate-300 overflow-y-auto">
      <div className="flex items-center gap-2.5 px-5 pt-6 pb-5">
        <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-500/30">
          <BarChart3 size={18} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-display font-bold text-[15px] text-white leading-tight">Meta Analyzer</div>
          <div className="text-[11px] text-slate-500">Ads &amp; Orders</div>
        </div>
        <NotificationBell />
      </div>

      <SyncStatusBadge />

      <div className="px-3 mb-2 flex flex-col gap-0.5">
        <NavLink to="/" end className={({ isActive }) => `sidebar-link${isActive ? " active" : ""}`}>
          <LayoutDashboard size={15} />
          Dashboard
        </NavLink>
        <NavLink to="/daily" className={({ isActive }) => `sidebar-link${isActive ? " active" : ""}`}>
          <CalendarDays size={15} />
          Daily
        </NavLink>
        <NavLink to="/campaign-explorer" className={({ isActive }) => `sidebar-link${isActive ? " active" : ""}`}>
          <Compass size={15} />
          Campaign Explorer
        </NavLink>
        <NavLink to="/analytics" className={({ isActive }) => `sidebar-link${isActive ? " active" : ""}`}>
          <TrendingUp size={15} />
          Analytics
        </NavLink>
        <NavLink to="/favorites" className={({ isActive }) => `sidebar-link${isActive ? " active" : ""}`}>
          <Star size={15} />
          Favorites
        </NavLink>
      </div>

      <nav className="flex-1 px-3 pb-6 flex flex-col gap-5">
        {navGroups.map((group) => (
          <div key={group.label}>
            <div className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
              {group.label}
            </div>
            <div className="flex flex-col gap-0.5">
              {group.links.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) => `sidebar-link${isActive ? " active" : ""}`}
                >
                  <Icon size={15} />
                  {label}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}

// Small centered spinner shown by <Suspense> while a lazy-loaded page
// chunk is still downloading — only visible on a slow connection or a
// page's very first visit this session, since the browser caches the
// chunk after that.
function RouteLoadingFallback() {
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="w-6 h-6 border-2 border-slate-200 border-t-indigo-500 rounded-full animate-spin" />
    </div>
  );
}

// Phase 7 — ErrorBoundary keyed by pathname: if a page throws during
// render, the fallback shows; navigating to a different route remounts
// the boundary (fresh key) so the next page gets a clean slate instead
// of staying stuck on the old error until the user clicks "Try again".
// Phase 7 — Settings' "Default landing page" preference. Only redirects
// on the app's very first mount (empty-deps effect), and only away from
// "/" — clicking the Dashboard sidebar link afterwards still goes to
// "/" normally, this just decides where a fresh app load opens to.
function DefaultLandingRedirect() {
  const { prefs } = usePreferences();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (location.pathname === "/" && prefs.defaultLandingPage && prefs.defaultLandingPage !== "/") {
      navigate(prefs.defaultLandingPage, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

function RoutedContent() {
  const location = useLocation();
  return (
    <ErrorBoundary key={location.pathname}>
      <Suspense fallback={<RouteLoadingFallback />}>
      <Routes>
        <Route>
          <Route path="/" element={<Dashboard />} />
          <Route path="/daily" element={<DailyPage />} />
          <Route path="/campaign-explorer" element={<CampaignExplorerPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/favorites" element={<FavoritesPage />} />
          <Route path="/activity-log" element={<ActivityLogPage />} />
          <Route path="/export-center" element={<ExportCenterPage />} />
          <Route path="/sync" element={<ShiprocketSyncPage />} />
          <Route path="/order-testing" element={<OrdersTesting />} />
          <Route path="/campaign-testing" element={<CampaignTesting />} />
          <Route path="/adorder-comparison" element={<CampaignComparison />} />
          <Route path="/live-tracking" element={<LiveTrackingPage />} />
          <Route path="/live-campaigns" element={<LiveCampaignsPage />} />
          <Route path="/ad-accounts" element={<AdAccountsPage />} />
          <Route path="/tokens" element={<TokensPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      {/* Phase 7 — outermost, since it's the most foundational and
          independent piece of state (theme/defaults, localStorage-backed):
          nothing else needs to be mounted before it, and several things
          below it (Settings page, future note-authoring) read from it. */}
      <PreferencesProvider>
      {/* Phase 7 — Favorites are backend-backed shared data (unlike most
          other Phase 7 state), fetched once here and read by FavoriteButton
          instances inside Campaign/Order/Customer drawers plus the future
          Favorites page, so it needs to wrap all of those. */}
      <FavoritesProvider>
      {/* Phase 7 — Notification Center storage. Needs to wrap NotificationBell
          (mounted once in the Sidebar) and everything that can trigger a
          notification (LiveSyncProvider's sync events, the future Export
          Center), so it sits right alongside FavoritesProvider at this level. */}
      <NotificationsProvider>
      {/* Mounted above Routes (not inside a Route) so their state survives
          navigating away and back — only the matched route's element tree
          unmounts, these providers don't. ShiprocketSyncProvider in
          particular is what keeps an in-progress fetch (and its polling)
          alive while you're on a different page. */}
      <ShiprocketSyncProvider>
        {/* Phase 5 — also mounted above <Routes> so the 10-second live-sync
            poll keeps running in the background no matter which page the
            user is on (Dashboard, Campaign Comparison, a drawer, ...) —
            "Background Sync" requirement. Wraps everything below it since
            CampaignDrawer subscribes to it too (to refresh itself if a new
            order lands for the campaign currently open). */}
        <LiveSyncProvider>
          {/* Also mounted above <Routes>, same reasoning as ShiprocketSyncProvider:
              the campaign drawer is a single global overlay any page can open
              (Dashboard, Campaign Comparison, Live Dashboard, ...) via
              useCampaignDrawer(), so it needs to survive page navigation and
              live outside any one route's element tree. */}
          <CampaignDrawerProvider>
            {/* Deepest level of the drill-down chain (Dashboard -> Popup ->
                Campaign -> Campaign Drawer -> Order -> Order Drawer), so it
                also lives above <Routes> and renders above everything else
                (see the z-index on OrderDrawer.jsx). */}
            <OrderDrawerProvider>
              {/* Phase 7 — Customer Drawer is the newest, most-nested overlay
                  (Order Drawer's Customer Information section can open it,
                  and it can itself open the Order Drawer for a row), so it
                  lives innermost, right alongside the other two drawers. */}
              <CustomerDrawerProvider>
              <div className="flex min-h-screen">
                <Sidebar />
                <main className="flex-1 min-w-0">
                  <DefaultLandingRedirect />
                  <RoutedContent />
                </main>
              </div>
              <CampaignDrawer />
              <OrderDrawer />
              <CustomerDrawer />
              <KeyboardShortcuts />
              <NetworkStatusBanner />
              </CustomerDrawerProvider>
            </OrderDrawerProvider>
          </CampaignDrawerProvider>
        </LiveSyncProvider>
      </ShiprocketSyncProvider>
      </NotificationsProvider>
      </FavoritesProvider>
      </PreferencesProvider>
    </BrowserRouter>
  );
}
