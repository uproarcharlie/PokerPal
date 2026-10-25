/**
 * Every URL the client serves, in one place. `paths` are the patterns the router matches; `routes`
 * build links, so a link can never drift from the route it points at: `routes.tournamentAdmin(id)`,
 * never `/admin/tournaments/${id}`. The URLs are the ones live QR codes, bookmarks and shared links
 * already use: change none of them.
 */
const seg = (value: string) => encodeURIComponent(value);

export const paths = {
  // Sign-in
  login: "/login",
  register: "/register",
  staffInvite: "/staff-invite",

  // Public (players, visitors)
  landing: "/",
  home: "/home",
  privacy: "/privacy",
  publicRegister: "/register/:tournamentId",
  publicTournament: "/tournament/:id",
  publicClub: "/club/:slug",
  tournamentQr: "/qr/:tournamentId",
  playerActions: "/tournaments/:tournamentId/actions",
  /** Phase 4: the TV clock (full screen; the club's staff control it from the keyboard). */
  clockDisplay: "/clock/:tournamentId",
  /** Phase 4: "find your seat". */
  publicSeats: "/tournament/:id/seats",
  /** Phase 4: a season's leaderboard, where the TV clock's QR code leads. */
  publicSeason: "/season/:seasonId",

  // Staff (signed in)
  dashboard: "/dashboard",
  clubs: "/clubs",
  clubSettings: "/clubs/:id/settings",
  clubDetails: "/clubs/:id",
  tournaments: "/tournaments",
  tournamentAdmin: "/admin/tournaments/:id",
  adminRegistrations: "/admin/registrations/:tournamentId",
  adminActions: "/admin/actions/:tournamentId",
  seasons: "/seasons",
  seasonSettings: "/seasons/:id/settings",
  leaderboards: "/leaderboards",
  players: "/players",
  users: "/users",
  settings: "/settings",
} as const;

function withQuery(path: string, name: string, value: string | undefined): string {
  return value ? `${path}?${name}=${encodeURIComponent(value)}` : path;
}

/**
 * Where staff are "home": signing in or up, impersonating, the logo, the 404 and error pages' way out,
 * and the list pages' Back. Defined once so those can never disagree again (P3REV5-CQ-13).
 */
export const STAFF_HOME = { href: paths.dashboard, label: "Dashboard" } as const;

/** A sign-in or sign-up page that returns to `next` (a path on this site) afterwards. */
const withNext = (path: string, next?: string) => withQuery(path, "next", next);

/** The TV clock's `?screen=` parameter, and its value for the venue's own screen (a TV, or a tablet at the bar). */
export const SCREEN_PARAM = "screen";
export const VENUE_SCREEN = "tv";

export const routes = {
  login: (next?: string) => withNext(paths.login, next),
  register: (next?: string) => withNext(paths.register, next),
  staffInvite: () => paths.staffInvite,

  landing: () => paths.landing,
  home: () => paths.home,
  privacy: () => paths.privacy,
  publicRegister: (tournamentId: string) => `/register/${seg(tournamentId)}`,
  publicTournament: (id: string) => `/tournament/${seg(id)}`,
  publicClub: (slug: string) => `/club/${seg(slug)}`,
  tournamentQr: (tournamentId: string) => `/qr/${seg(tournamentId)}`,
  playerActions: (tournamentId: string) => `/tournaments/${seg(tournamentId)}/actions`,
  /**
   * The TV clock. The staff's links (`screen` "tv") open it as the venue's screen, polled every few
   * seconds even on a tablet; a player's link leaves the screen to judge (TDN2-TABLET-AS-PHONE).
   */
  clockDisplay: (tournamentId: string, screen?: typeof VENUE_SCREEN) => withQuery(`/clock/${seg(tournamentId)}`, SCREEN_PARAM, screen),
  publicSeats: (id: string) => `/tournament/${seg(id)}/seats`,
  publicSeason: (seasonId: string) => `/season/${seg(seasonId)}`,

  dashboard: () => paths.dashboard,
  staffHome: () => STAFF_HOME.href,
  clubs: () => paths.clubs,
  clubSettings: (id: string) => `/clubs/${seg(id)}/settings`,
  clubDetails: (id: string) => `/clubs/${seg(id)}`,
  /** The tournaments list; given a club the viewer runs, it opens Create Tournament with that club chosen. */
  tournaments: (createForClubId?: string) => withQuery(paths.tournaments, "create", createForClubId),
  /** The TD's tournament page, on the desk tab `tab` (read from `?tab=`; none for the first). */
  tournamentAdmin: (id: string, tab?: string) => withQuery(`/admin/tournaments/${seg(id)}`, "tab", tab),
  adminRegistrations: (tournamentId: string) => `/admin/registrations/${seg(tournamentId)}`,
  adminActions: (tournamentId: string) => `/admin/actions/${seg(tournamentId)}`,
  /** The seasons list; given a club the viewer runs, it opens Create New Season with that club chosen. */
  seasons: (createForClubId?: string) => withQuery(paths.seasons, "create", createForClubId),
  seasonSettings: (id: string) => `/seasons/${seg(id)}/settings`,
  /** The leaderboards page, showing `seasonId` when given (read from `?season=`). */
  leaderboards: (seasonId?: string) => withQuery(paths.leaderboards, "season", seasonId),
  players: () => paths.players,
  users: () => paths.users,
  settings: () => paths.settings,
} as const;

/** An absolute link for sharing or a QR code: the page's own origin, so it works on any deployment. */
export function absoluteUrl(path: string): string {
  return new URL(path, window.location.origin).toString();
}
