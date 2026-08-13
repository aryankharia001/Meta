import { useEffect } from "react";

// ────────────────────────────────────────────────────────────────
// Fixes the "Escape closes every open drawer at once" bug: every
// drawer/popup that supports Escape-to-close used to register its own
// unconditional `document.addEventListener("keydown", ...)`. When
// drawers are nested (Campaign Drawer -> stat popup -> Order Drawer),
// a single Escape press fired ALL of those listeners simultaneously.
//
// This is a tiny module-level (not React-state) stack of "currently
// open overlays, topmost last". Only ONE global keydown listener
// (see GlobalOverlayEscapeHandler.jsx) ever calls document — every
// individual drawer just pushes/pops itself onto this stack via the
// useOverlayEscape() hook below, and only the top of the stack closes
// on Escape.
// ────────────────────────────────────────────────────────────────

let stack = [];

export function pushOverlay(closeFn) {
  const entry = { closeFn };
  stack.push(entry);
  return () => {
    stack = stack.filter((e) => e !== entry);
  };
}

export function triggerTopOverlayEscape() {
  if (stack.length) stack[stack.length - 1].closeFn();
}

// Call with (open, onClose) from any drawer/popup/modal that wants
// Escape-to-close. Pushes itself onto the stack while open (most
// recently opened = topmost = the only one that responds to Escape),
// and pops itself on close/unmount — so a drawer opened on top of
// another one always "wins" Escape until it itself closes, at which
// point the one beneath it becomes topmost again.
export function useOverlayEscape(open, onClose) {
  useEffect(() => {
    if (!open) return;
    return pushOverlay(onClose);
  }, [open, onClose]);
}
