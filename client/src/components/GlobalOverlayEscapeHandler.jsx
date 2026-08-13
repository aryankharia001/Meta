import { useEffect } from "react";
import { triggerTopOverlayEscape } from "../lib/overlayStack";

// The ONE real `document.addEventListener("keydown", ...)` for Escape
// in the whole app. Mounted once, above every drawer, in
// AuthenticatedApp(). Delegates to the overlayStack module so only the
// topmost open drawer/popup/modal closes on a single Escape press —
// see lib/overlayStack.js for the stack itself and why this exists.
export default function GlobalOverlayEscapeHandler() {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") triggerTopOverlayEscape();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return null;
}
