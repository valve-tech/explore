import { useSyncExternalStore } from "react";

/**
 * Subscribe to a CSS media query. `useSyncExternalStore` gives us a tear-free
 * read with no `setState`-in-effect chain — the store IS `matchMedia`.
 * SSR/`matchMedia`-less environments fall back to `false`.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof matchMedia !== "function") return () => {};
      const mql = matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => (typeof matchMedia === "function" ? matchMedia(query).matches : false),
    () => false,
  );
}

/** True below Tailwind's `sm` breakpoint (640px) — i.e. phone width. */
export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 639px)");
}
