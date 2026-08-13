"use client";

import { useEffect, useState } from "react";

// SSR-safe: starts false (matches the server-rendered branch), corrects itself post-mount —
// same "settle after mount" shape as the theme toggle's hydration guard, so no mismatch error.
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const listener = (event: MediaQueryListEvent) => setMatches(event.matches);
    mql.addEventListener("change", listener);
    return () => mql.removeEventListener("change", listener);
  }, [query]);

  return matches;
}
