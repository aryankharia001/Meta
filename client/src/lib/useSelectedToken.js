import { useEffect, useState } from "react";
import { fetchTokens } from "./api";

// Was hardcoded as `const TOKEN_ID = "6a7089b68e4360b5a8cf7ff2"` in both
// CampaignComparison.jsx and CampaignTesting.jsx. This hook replaces that
// with a token picked from the new Token CRUD (/api/tokens), persisted in
// localStorage so the choice survives reloads/navigation. Defaults to the
// previously-hardcoded id so existing behavior doesn't change until you
// actively pick a different token.
const STORAGE_KEY = "selectedTokenId";
const LEGACY_DEFAULT_TOKEN_ID = "6a7089b68e4360b5a8cf7ff2";

export function useSelectedToken() {
  const [tokens, setTokens] = useState([]);
  const [tokenId, setTokenIdState] = useState(
    () => localStorage.getItem(STORAGE_KEY) || LEGACY_DEFAULT_TOKEN_ID
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchTokens();
        if (cancelled) return;
        const list = res.data || [];
        setTokens(list);

        // If nothing valid is selected yet, default to the first token.
        const stored = localStorage.getItem(STORAGE_KEY);
        const storedIsValid = stored && list.some((t) => t._id === stored);
        if (!storedIsValid && list.length > 0) {
          setTokenIdState(list[0]._id);
          localStorage.setItem(STORAGE_KEY, list[0]._id);
        }
      } catch {
        // Leave the fallback/legacy tokenId in place if /api/tokens fails
        // (e.g. before any tokens have been added yet).
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setTokenId = (id) => {
    setTokenIdState(id);
    localStorage.setItem(STORAGE_KEY, id);
  };

  return { tokenId, setTokenId, tokens, loadingTokens: loading };
}
