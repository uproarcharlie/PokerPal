/**
 * A club's own colours (round 5, item 13) on every screen of the club: its public pages, the QR
 * sign-up, the seat finder, the season leaderboard, the TV clock and the club's tournament pages for
 * staff. Public-safe: no zod, no staff code (the public pages and the TV load it).
 */
import { useMemo, type ReactNode } from "react";
import type { ClubTheme } from "@shared/domain/theme";
import { readTheme, themeVariables } from "@shared/domain/theme";
import { ThemeScope, type ColorScheme, type ThemeLayer } from "@/app/theme";
import { useClub } from "@/features/clubs/hooks";

export interface ClubThemeScopeProps {
  /**
   * The club's theme when the page already has it (`LiveDisplayDto.club.theme`, `PublicSeatingDto.club.theme`,
   * `ClubDto.theme`); null for a club without one. Left out (undefined), the club is read by `clubId`.
   */
  theme?: ClubTheme | null;
  /** The club to read the theme of when `theme` is left out (`useClub`, the cache the club pages share). */
  clubId?: string | null;
  /**
   * The scheme the colours are worked out for: "light" (public pages), "dark" (the TV), "preference"
   * (staff screens: the person's choice). Left out: the enclosing layout's.
   */
  scheme?: ColorScheme | "preference";
  children: ReactNode;
}

/**
 * Dresses everything inside it in the club's colours, as CSS variables on <html> (so dialogs and
 * toasts wear them too), worked out for the scheme on screen so every text pair stays readable
 * (`themeVariables`: WCAG AA for any colours). A club without a theme, or one whose stored theme does
 * not read, keeps the LovePoker look. The children are never remounted when the theme arrives.
 */
export function ClubThemeScope({ theme, clubId, scheme, children }: ClubThemeScopeProps) {
  const club = useClub(theme === undefined ? clubId : null);
  const source = theme === undefined ? club.data?.theme : theme;
  const colours = useMemo(() => readTheme(source), [source]);
  const layer = useMemo<ThemeLayer>(
    () => ({ colorScheme: scheme, variables: colours ? (onScreen: ColorScheme) => themeVariables(colours, onScreen) : undefined }),
    [scheme, colours],
  );
  return <ThemeScope layer={layer}>{children}</ThemeScope>;
}
