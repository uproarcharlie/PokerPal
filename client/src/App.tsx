import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/auth-context";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { Sidebar } from "@/components/layout/sidebar";
import Dashboard from "@/pages/dashboard";
import Clubs from "@/pages/clubs";
import ClubDetails from "@/pages/club-details";
import ClubSettings from "@/pages/club-settings";
import Tournaments from "@/pages/tournaments";
import TournamentDetails from "@/pages/tournament-details";
import PublicTournamentView from "@/pages/public-tournament-view";
import PublicClubView from "@/pages/public-club-view";
import Seasons from "@/pages/seasons";
import SeasonSettings from "@/pages/season-settings";
import Leaderboards from "@/pages/leaderboards";
import Players from "@/pages/players";
import PlayerActions from "@/pages/player-actions";
import { PublicRegisterPage } from "@/pages/public-register-page";
import { AdminRegistrationsPage } from "@/pages/admin-registrations-page";
import { AdminActionsPage } from "@/pages/admin-actions-page";
import { QRCodePage } from "@/pages/qr-code-page";
import UserManagement from "@/pages/user-management";
import RegisterPage from "@/pages/register";
import LoginPage from "@/pages/login";
import SettingsPage from "@/pages/settings";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      {/* Auth routes without sidebar */}
      <Route path="/login" component={LoginPage} />
      <Route path="/register" component={RegisterPage} />

      {/* Public routes without sidebar */}
      <Route path="/register/:tournamentId" component={PublicRegisterPage} />
      <Route path="/tournament/:id" component={PublicTournamentView} />
      <Route path="/club/:id" component={PublicClubView} />
      <Route path="/qr/:tournamentId" component={QRCodePage} />
      <Route path="/tournaments/:tournamentId/actions" component={PlayerActions} />

      {/* Admin routes with sidebar - PROTECTED */}
      <Route path="/admin/registrations/:tournamentId" component={() => (
        <ProtectedRoute>
          <div className="flex h-screen overflow-hidden">
            <Sidebar />
            <main className="flex-1 overflow-y-auto pt-[57px] lg:pt-0">
              <AdminRegistrationsPage />
            </main>
          </div>
        </ProtectedRoute>
      )} />

      <Route path="/admin/actions/:tournamentId" component={() => (
        <ProtectedRoute>
          <div className="flex h-screen overflow-hidden">
            <Sidebar />
            <main className="flex-1 overflow-y-auto pt-[57px] lg:pt-0">
              <AdminActionsPage />
            </main>
          </div>
        </ProtectedRoute>
      )} />

      <Route path="/admin/tournaments/:id" component={() => (
        <ProtectedRoute>
          <div className="flex h-screen overflow-hidden">
            <Sidebar />
            <main className="flex-1 overflow-y-auto pt-[57px] lg:pt-0">
              <TournamentDetails />
            </main>
          </div>
        </ProtectedRoute>
      )} />

      {/* Standard routes with sidebar - PROTECTED (Admin Only) */}
      <Route>
        {() => (
          <ProtectedRoute requireAdmin={true}>
            <div className="flex h-screen overflow-hidden">
              <Sidebar />
              <main className="flex-1 overflow-y-auto pt-[57px] lg:pt-0">
                <Switch>
                  <Route path="/" component={Dashboard} />
                  <Route path="/dashboard" component={Dashboard} />
                  <Route path="/clubs" component={Clubs} />
                  <Route path="/clubs/:id/settings" component={ClubSettings} />
                  <Route path="/clubs/:id" component={ClubDetails} />
                  <Route path="/tournaments" component={Tournaments} />
                  <Route path="/seasons/:id/settings" component={SeasonSettings} />
                  <Route path="/seasons" component={Seasons} />
                  <Route path="/leaderboards" component={Leaderboards} />
                  <Route path="/players" component={Players} />
                  <Route path="/users" component={UserManagement} />
                  <Route path="/settings" component={SettingsPage} />
                  <Route component={NotFound} />
                </Switch>
              </main>
            </div>
          </ProtectedRoute>
        )}
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
