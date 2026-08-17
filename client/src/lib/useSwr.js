// Phase 18 (part 2) — shared, reusable stale-while-revalidate primitive.
//
// The problem this fixes: every page in this app that fetches data used
// the same shape — `useState(null)` + `useEffect` + `setLoading(true)` +
// fetch + `setLoading(false)` — which means every time you navigate away
// and back, the page blanks out to a loading skeleton and re-fetches
// everything from scratch, even if you were just here 10 seconds ago.
// A few pages (Campaign Explorer, Campaign Drawer, Analytics) already had
// a `getCached*/setCached*` Map-based cache (see campaignExplorerCache.js
// etc.) that shows stale data instantly on return — but none of them ever
// silently refetch in the background, so once cached, the data is frozen
// until a manual Refresh or a live-sync tick happens to touch it. That's
// half of SWR, not all of it.
//
// This hook is the other half, wired on top of the SAME storage
// convention this codebase already uses (a plain module-level `Map`,
// owned by a small per-domain `*Cache.js` file with `getCached*` /
// `setCached*` functions) rather than inventing a second, parallel cache
// system. You pass it:
//   - `cacheKey`   — a plain STRING (not an array/object — see note below)
//                    uniquely identifying "what" is being fetched, e.g.
//                    `${tokenId}|${sortedAccountIds}|${since}|${until}`,
//                    same format the existing cache files already build
//                    internally. Pass `null`/`undefined` to disable the
//                    hook (e.g. "no token selected yet") — mirrors every
//                    page's existing `if (!TOKEN_ID) return;` guard.
//   - `fetchFn`    — a zero-arg `() => Promise<data>` that performs the
//                    real network call (bypassing nothing — every call
//                    hits the network; staleness is decided by this hook,
//                    not by fetchFn).
//   - `options.getCached` / `options.setCached` — zero-arg
//                    getter / one-arg setter closures wrapping an
//                    existing (or newly-created) `getCached*/setCached*`
//                    pair from a `*Cache.js` file, e.g.
//                    `getCached: () => getCachedExplorerList(tokenId, accountIds, since, until)`.
//                    Optional — if omitted, the hook falls back to its
//                    own internal Map (see DEFAULT_STORE below), so it's
//                    still a fully self-contained primitive for a page
//                    that doesn't want a dedicated cache file.
//   - `options.staleTimeMs` — how long a cached entry is considered
//                    "fresh enough to skip the network call entirely" on
//                    mount/key-change (§26 "avoid unnecessary API
//                    requests"). Pick per-page based on how fast that
//                    page's data actually moves — see the call sites for
//                    the specific values chosen and why.
//
// Cache-key note: on purpose this takes a STRING, not the raw
// tokenId/accountIds/since/until pieces — arrays and objects get a new
// identity on every render even when their contents haven't changed
// (the classic React footgun this task's spec calls out), which would
// make every effect below think the key "changed" every render and
// re-fetch forever. Strings compare by value, so building the key with
// the same `[...ids].sort().join(",")` convention the existing cache
// files already use and handing the hook a plain string sidesteps that
// entirely — no memoization required at the call site.
//
// What you get back:
//   - `data`            — cached-then-fresh. Never nulled out again once
//                          populated, even if a background refetch fails.
//   - `loading`          — true ONLY when there is no data at all yet
//                          (first-ever load for this key with an empty
//                          cache). Never true again once something has
//                          been shown, even during a background
//                          revalidation.
//   - `isValidating`     — true while ANY fetch (background or manual
//                          refresh) is in flight. Drive a small spinner
//                          with this, not `loading`.
//   - `error`            — set only when a fetch fails AND there's no
//                          data to fall back on (the classic "first load
//                          failed" case) — render a real error state.
//   - `backgroundError`  — set only when a fetch fails WHILE data is
//                          already on screen — `data` is left untouched.
//                          Render this as a small "Unable to refresh —
//                          showing last available data" note, not a
//                          blocking error.
//   - `lastUpdatedAt`    — ms epoch timestamp of the last successful
//                          fetch for this key, or null.
//   - `refresh()`        — forces a real, bypass-staleness fetch (for a
//                          manual "Refresh" button, or a live-sync tick —
//                          see rangeIncludesToday() call sites). Updates
//                          the cache + `lastUpdatedAt` on success, same
//                          as any other successful fetch.
//   - `mutate(next)`     — optional local write-through: pass a new
//                          value (or an updater `(prev) => next`) to
//                          update `data` AND the underlying cache
//                          immediately, without a network round-trip —
//                          for pages that mutate data via their own
//                          create/update/delete calls (Products,
//                          Expenses) and want the list to stay correct
//                          if the user navigates away and back before the
//                          next background refetch would naturally occur.

import { useCallback, useEffect, useRef, useState } from "react";

// Fallback storage for callers that don't pass their own getCached/
// setCached pair — same Map-per-key convention as every *Cache.js file,
// just generic/keyed directly by the cacheKey string instead of a
// hand-built compound key. Session-lifetime, same as everything else.
const DEFAULT_STORE = new Map();

// Last-successful-fetch timestamps, keyed by cacheKey string. Lives here
// (not inside the individual *Cache.js files) so wiring SWR onto an
// existing cache file never requires changing that file's stored value
// shape — every existing direct consumer of getCached*/setCached* (e.g.
// other components reading campaignExplorerCache.js) keeps working
// completely untouched.
const fetchedAtStore = new Map();

export function sortedKey(ids) {
  return [...(ids || [])].sort().join(",");
}

export function useSwrFetch(cacheKey, fetchFn, options = {}) {
  const { staleTimeMs = 30000, getCached, setCached, enabled = true } = options;

  const active = enabled && !!cacheKey;

  const fetchFnRef = useRef(fetchFn);
  fetchFnRef.current = fetchFn;
  const getCachedRef = useRef(getCached);
  getCachedRef.current = getCached;
  const setCachedRef = useRef(setCached);
  setCachedRef.current = setCached;

  const readCache = useCallback(() => {
    if (!active) return null;
    try {
      if (getCachedRef.current) return getCachedRef.current() ?? null;
      return DEFAULT_STORE.get(cacheKey) ?? null;
    } catch {
      return null;
    }
  }, [active, cacheKey]);

  const writeCache = useCallback(
    (value) => {
      if (!cacheKey) return;
      try {
        if (setCachedRef.current) setCachedRef.current(value);
        else DEFAULT_STORE.set(cacheKey, value);
      } catch {
        // Storage is best-effort — a write failure shouldn't crash the UI.
      }
    },
    [cacheKey]
  );

  const [data, setData] = useState(readCache);
  const [loading, setLoading] = useState(() => active && readCache() == null);
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState(null);
  const [backgroundError, setBackgroundError] = useState(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(() => (cacheKey ? fetchedAtStore.get(cacheKey) ?? null : null));

  // Guards against a fetch started for key A clobbering state after the
  // key has already moved on to B (fast filter changes / rapid nav).
  const keyRef = useRef(cacheKey);
  keyRef.current = cacheKey;

  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    []
  );

  const runFetch = useCallback(
    (mode) => {
      // mode: "blocking" (no data yet — failure is a real error) |
      // "background" (data already present — failure is non-fatal)
      if (!active) return Promise.resolve(undefined);
      const requestKey = cacheKey;
      setIsValidating(true);
      return fetchFnRef
        .current()
        .then((res) => {
          if (!mountedRef.current || keyRef.current !== requestKey) return res;
          writeCache(res);
          fetchedAtStore.set(requestKey, Date.now());
          setData(res);
          setLastUpdatedAt(Date.now());
          setError(null);
          setBackgroundError(null);
          return res;
        })
        .catch((err) => {
          if (!mountedRef.current || keyRef.current !== requestKey) throw err;
          const message = err?.message || "Failed to load data";
          if (mode === "blocking") setError(message);
          else setBackgroundError(message);
          throw err;
        })
        .finally(() => {
          if (mountedRef.current && keyRef.current === requestKey) {
            setIsValidating(false);
            setLoading(false);
          }
        });
    },
    [active, cacheKey, writeCache]
  );

  // Mount / key-change: synchronously show whatever's cached (no loading
  // flash), then ALWAYS kick off a fetch unless the cached entry is still
  // within staleTimeMs — the core "don't fetch the same data repeatedly"
  // guarantee (§26).
  useEffect(() => {
    if (!active) {
      setData(null);
      setLoading(false);
      setIsValidating(false);
      setError(null);
      setBackgroundError(null);
      setLastUpdatedAt(null);
      return;
    }

    const cached = readCache();
    const fetchedAt = cacheKey ? fetchedAtStore.get(cacheKey) ?? null : null;
    setData(cached ?? null);
    setLastUpdatedAt(fetchedAt);
    setError(null);
    setBackgroundError(null);

    if (cached == null) {
      setLoading(true);
      runFetch("blocking").catch(() => {});
    } else {
      setLoading(false);
      const isFresh = fetchedAt && Date.now() - fetchedAt < staleTimeMs;
      if (!isFresh) runFetch("background").catch(() => {});
    }
    // Intentionally keyed only on cacheKey/active — same convention every
    // existing load()-on-mount effect in this app already uses (only the
    // primitives that define "what to fetch" are deps, not the fetch
    // function's own identity).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, active]);

  // Forces a real network fetch, bypassing the staleness check — for a
  // manual "Refresh" button and for live-sync-triggered refetches. Never
  // blocked by staleTimeMs.
  const refresh = useCallback(() => {
    if (!active) return Promise.resolve(undefined);
    return runFetch(data == null ? "blocking" : "background").catch(() => {});
  }, [active, runFetch, data]);

  // Optional local write-through for pages that mutate their own list via
  // create/update/delete calls (Products, Expenses) — keeps `data` AND
  // the cache correct without waiting on the next background refetch.
  const mutate = useCallback(
    (updaterOrValue) => {
      setData((prev) => {
        const next = typeof updaterOrValue === "function" ? updaterOrValue(prev) : updaterOrValue;
        if (cacheKey) {
          writeCache(next);
          fetchedAtStore.set(cacheKey, Date.now());
          setLastUpdatedAt(Date.now());
        }
        return next;
      });
    },
    [cacheKey, writeCache]
  );

  return { data, loading, isValidating, isRevalidating: isValidating, error, backgroundError, lastUpdatedAt, refresh, mutate };
}
