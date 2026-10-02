import { dark } from "@clerk/themes";

/**
 * Clerk's own dark theme, used verbatim.
 *
 * The auth pages are the one place where the app deliberately hands control to
 * Clerk's design system rather than extending ours: their components ship the
 * accessibility, focus management and focus-trap behaviour that a hand-rolled
 * imitation would have to re-earn. Restyling them from the outside meant
 * `!important` overrides fighting an injected stylesheet, which broke silently
 * whenever Clerk's cascade shifted.
 *
 * Our own monochrome system lives in the app chrome around them, not in them.
 */
export const clerkAppearance = {
  theme: dark,
} as const;
