/**
 * Every page, by URL. Pages load on demand (one script per page), and so does the staff layout (the
 * sidebar, its menus and the sign-in check), so a player who scans a QR code downloads the sign-up
 * page, not the staff screens. Pages come only from `features/<domain>/pages/*`; layouts add the
 * sign-in check, sidebar, theme, error boundary and loading state around them.
 *
 * Routes are written out one by one (not mapped from a list) on purpose: wouter's Switch then keeps
 * the same layout instance while people move between pages of the same group, so the sidebar stays
 * put and only the page changes.
 */
import { Suspense, type ComponentType } from "react";
import { Route, Switch, useLocation } from "wouter";
import { PageSpinner } from "@/components/shared/page-spinner";
import { useAuth } from "@/contexts/auth-context";
import { RouteErrorBoundary } from "./error-boundary";
import { AuthLayout } from "./layouts/auth-layout";
import { DisplayLayout } from "./layouts/display-layout";
import { PublicLayout } from "./layouts/public-layout";
import { lazyPage, type Preloadable } from "./lazy-page";
import { paths, routes } from "./routes";

const AdminLayout = lazyPage(() => import("./layouts/admin-layout").then((module) => ({ default: module.AdminLayout })));
const NotFound = lazyPage(() => import("./not-found").then((module) => ({ default: module.NotFound })));

// Sign-in
const Login = lazyPage(() => import("@/features/account/pages/login"));
const Register = lazyPage(() => import("@/features/account/pages/register"));
const StaffInvite = lazyPage(() => import("@/features/staff-invite/pages/staff-invite"));

// Public
const Landing = lazyPage(() => import("@/features/landing/pages/landing"));
const PublicHome = lazyPage(() => import("@/features/clubs/pages/public-home"));
const PublicClub = lazyPage(() => import("@/features/clubs/pages/public-club"));
const Privacy = lazyPage(() => import("@/features/legal/pages/privacy"));
const PublicTournament = lazyPage(() => import("@/features/public-tournament/pages/public-tournament"));
const PublicRegister = lazyPage(() => import("@/features/public-tournament/pages/public-register"));
const TournamentQr = lazyPage(() => import("@/features/public-tournament/pages/tournament-qr"));
const PlayerActions = lazyPage(() => import("@/features/public-tournament/pages/player-actions"));
const PublicSeats = lazyPage(() => import("@/features/seating/pages/public-seats"));
const PublicSeason = lazyPage(() => import("@/features/public-season/pages/public-season"));

// The venue's TV
const ClockDisplay = lazyPage(() => import("@/features/clock/pages/clock-display"));

// Staff
const Dashboard = lazyPage(() => import("@/features/dashboard/pages/dashboard"));
const Clubs = lazyPage(() => import("@/features/clubs/pages/clubs"));
const ClubDetails = lazyPage(() => import("@/features/clubs/pages/club-details"));
const ClubSettings = lazyPage(() => import("@/features/clubs/pages/club-settings"));
const TournamentsList = lazyPage(() => import("@/features/tournaments/pages/tournaments-list"));
const TournamentDetails = lazyPage(() => import("@/features/tournaments/pages/tournament-details"));
const AdminRegistrations = lazyPage(() => import("@/features/tournaments/pages/admin-registrations"));
const AdminActions = lazyPage(() => import("@/features/tournaments/pages/admin-actions"));
const Seasons = lazyPage(() => import("@/features/seasons/pages/seasons"));
const SeasonSettings = lazyPage(() => import("@/features/seasons/pages/season-settings"));
const Leaderboards = lazyPage(() => import("@/features/seasons/pages/leaderboards"));
const Players = lazyPage(() => import("@/features/players/pages/players"));
const UserManagement = lazyPage(() => import("@/features/users/pages/user-management"));
const AccountSettings = lazyPage(() => import("@/features/account/pages/settings"));

/**
 * A staff page in the staff layout. Its code starts downloading as soon as the route matches, beside
 * the layout's and the sign-in check, rather than once both are done (P3REV4-PERF-07).
 */
function StaffPage({ page: Page, requireAdmin = false }: { page: ComponentType & Preloadable; requireAdmin?: boolean }) {
  Page.preload();
  return (
    <AdminLayout requireAdmin={requireAdmin}>
      <Page />
    </AdminLayout>
  );
}

/** An unknown URL: inside the staff layout for someone signed in (as before), else on its own. */
function UnknownPage() {
  const { loading, isAuthenticated } = useAuth();
  if (loading) return <PageSpinner className="min-h-dvh" />;
  if (isAuthenticated) {
    return (
      <AdminLayout>
        <NotFound />
      </AdminLayout>
    );
  }
  return (
    <PublicLayout>
      <NotFound />
    </PublicLayout>
  );
}

export function AppRouter() {
  const [location] = useLocation();
  return (
    // Catches what no layout can: the staff layout's own code failing to load (a dropped request, or a
    // tab left open across a deploy), which would otherwise leave a blank page (P3REV4-PERF-01).
    <RouteErrorBoundary homeHref={routes.landing()} resetKey={location}>
      {/* Shown only while the staff layout's code loads; each layout has its own for the page inside. */}
      <Suspense fallback={<PageSpinner className="min-h-dvh" />}>
        <Switch>
          <Route path={paths.login}>
            <AuthLayout>
              <Login />
            </AuthLayout>
          </Route>
          <Route path={paths.register}>
            <AuthLayout>
              <Register />
            </AuthLayout>
          </Route>
          {/* Open to anyone: it asks the visitor to sign in before accepting (SEC-P2REV-03). */}
          <Route path={paths.staffInvite}>
            <AuthLayout>
              <StaffInvite />
            </AuthLayout>
          </Route>

          <Route path={paths.landing}>
            <PublicLayout>
              <Landing />
            </PublicLayout>
          </Route>
          <Route path={paths.home}>
            <PublicLayout>
              <PublicHome />
            </PublicLayout>
          </Route>
          <Route path={paths.privacy}>
            <PublicLayout>
              <Privacy />
            </PublicLayout>
          </Route>
          <Route path={paths.publicRegister}>
            <PublicLayout>
              <PublicRegister />
            </PublicLayout>
          </Route>
          <Route path={paths.publicSeats}>
            <PublicLayout>
              <PublicSeats />
            </PublicLayout>
          </Route>
          <Route path={paths.publicTournament}>
            <PublicLayout>
              <PublicTournament />
            </PublicLayout>
          </Route>
          <Route path={paths.publicClub}>
            <PublicLayout>
              <PublicClub />
            </PublicLayout>
          </Route>
          <Route path={paths.tournamentQr}>
            <PublicLayout>
              <TournamentQr />
            </PublicLayout>
          </Route>
          <Route path={paths.playerActions}>
            <PublicLayout>
              <PlayerActions />
            </PublicLayout>
          </Route>
          <Route path={paths.publicSeason}>
            <PublicLayout>
              <PublicSeason />
            </PublicLayout>
          </Route>
          <Route path={paths.clockDisplay}>
            <DisplayLayout>
              <ClockDisplay />
            </DisplayLayout>
          </Route>

          <Route path={paths.dashboard}>
            <StaffPage page={Dashboard} />
          </Route>
          <Route path={paths.clubs}>
            <StaffPage page={Clubs} />
          </Route>
          <Route path={paths.clubSettings}>
            <StaffPage page={ClubSettings} />
          </Route>
          <Route path={paths.clubDetails}>
            <StaffPage page={ClubDetails} />
          </Route>
          <Route path={paths.tournaments}>
            <StaffPage page={TournamentsList} />
          </Route>
          <Route path={paths.tournamentAdmin}>
            <StaffPage page={TournamentDetails} />
          </Route>
          <Route path={paths.adminRegistrations}>
            <StaffPage page={AdminRegistrations} />
          </Route>
          <Route path={paths.adminActions}>
            <StaffPage page={AdminActions} />
          </Route>
          <Route path={paths.seasonSettings}>
            <StaffPage page={SeasonSettings} />
          </Route>
          <Route path={paths.seasons}>
            <StaffPage page={Seasons} />
          </Route>
          <Route path={paths.leaderboards}>
            <StaffPage page={Leaderboards} />
          </Route>
          <Route path={paths.players}>
            <StaffPage page={Players} />
          </Route>
          <Route path={paths.users}>
            <StaffPage page={UserManagement} requireAdmin />
          </Route>
          <Route path={paths.settings}>
            <StaffPage page={AccountSettings} />
          </Route>

          <Route>
            <UnknownPage />
          </Route>
        </Switch>
      </Suspense>
    </RouteErrorBoundary>
  );
}
