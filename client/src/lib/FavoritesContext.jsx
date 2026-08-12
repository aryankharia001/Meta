import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { fetchFavorites, addFavorite, removeFavorite, logActivity } from "./api";

// Phase 7 — Favorites, backed by the new Favorite collection (unlike
// most other Phase 7 state, this one lives on the backend rather than
// localStorage: favorited campaigns/orders/customers are business data
// worth keeping durable and consistent with Notes/Saved Views, the same
// call made for those). Fetched once on mount, kept in memory, and
// patched optimistically on toggle so the star button responds
// instantly instead of waiting on a round-trip.

const FavoritesContext = createContext(null);

export function FavoritesProvider({ children }) {
  const [favorites, setFavorites] = useState([]); // [{ entityType, entityId, label, meta }]
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetchFavorites()
      .then((res) => {
        if (res.success) setFavorites(res.favorites);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const key = (entityType, entityId) => `${entityType}:${entityId}`;

  const favoriteSet = useMemo(() => new Set(favorites.map((f) => key(f.entityType, f.entityId))), [favorites]);

  const isFavorite = useCallback((entityType, entityId) => favoriteSet.has(key(entityType, entityId)), [favoriteSet]);

  const toggleFavorite = useCallback(
    async (entityType, entityId, label, meta) => {
      const already = favoriteSet.has(key(entityType, entityId));
      if (already) {
        setFavorites((prev) => prev.filter((f) => !(f.entityType === entityType && f.entityId === entityId)));
        try {
          await removeFavorite(entityType, entityId);
          logActivity("favorite", `Removed ${entityType} "${label || entityId}" from favorites`, { entityType, entityId });
        } catch {
          // best-effort — if this fails the list will self-correct next reload
        }
      } else {
        setFavorites((prev) => [{ entityType, entityId, label: label || "", meta: meta || {}, createdAt: new Date().toISOString() }, ...prev]);
        try {
          const res = await addFavorite(entityType, entityId, label, meta);
          logActivity("favorite", `Added ${entityType} "${label || entityId}" to favorites`, { entityType, entityId });
          if (res.success) {
            setFavorites((prev) => prev.map((f) => (f.entityType === entityType && f.entityId === entityId ? { ...f, id: res.favorite.id } : f)));
          }
        } catch {
          // roll back optimistic add on failure
          setFavorites((prev) => prev.filter((f) => !(f.entityType === entityType && f.entityId === entityId)));
        }
      }
    },
    [favoriteSet]
  );

  return (
    <FavoritesContext.Provider value={{ favorites, loaded, isFavorite, toggleFavorite }}>{children}</FavoritesContext.Provider>
  );
}

export function useFavorites() {
  const ctx = useContext(FavoritesContext);
  if (!ctx) {
    throw new Error("useFavorites must be used within a FavoritesProvider");
  }
  return ctx;
}
