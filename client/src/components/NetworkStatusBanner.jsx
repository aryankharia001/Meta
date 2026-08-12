import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

// Phase 7 — Error Handling: offline/network status. A thin banner, not
// a blocking modal, since most of the app (cached drawer data,
// Recently Viewed, Favorites list already in memory) still works fine
// without a live connection — it just warns that fresh data can't load.
export default function NetworkStatusBanner() {
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  if (online) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[95] flex items-center gap-2 bg-slate-900 text-white text-xs px-4 py-2.5 rounded-full shadow-2xl animate-[fadeIn_0.2s_ease-out]">
      <WifiOff size={13} className="text-rose-400" />
      You're offline — showing cached data until connection returns.
    </div>
  );
}
