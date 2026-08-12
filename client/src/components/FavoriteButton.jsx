import { Star } from "lucide-react";
import { useFavorites } from "../lib/FavoritesContext";

// Phase 7 — reusable star toggle used by Campaign/Order/Customer
// drawers. Purely a UI trigger around FavoritesContext; doesn't know or
// care which drawer it's rendered in.
export default function FavoriteButton({ entityType, entityId, label, meta, size = 14, className = "" }) {
  const { isFavorite, toggleFavorite } = useFavorites();
  const active = isFavorite(entityType, entityId);

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        toggleFavorite(entityType, entityId, label, meta);
      }}
      className={`inline-flex items-center justify-center rounded-lg transition-colors ${
        active ? "text-amber-500 hover:text-amber-600" : "text-slate-300 hover:text-amber-400"
      } ${className}`}
      title={active ? "Remove from favorites" : "Add to favorites"}
    >
      <Star size={size} fill={active ? "currentColor" : "none"} />
    </button>
  );
}
