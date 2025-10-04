import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/layout/sidebar";
import Dashboard from "@/pages/dashboard";
import Clubs from "@/pages/clubs";
import ClubDetails from "@/pages/club-details";
import Tournaments from "@/pages/tournaments";
import TournamentDetails from "@/pages/tournament-details";
import Seasons from "@/pages/seasons";
import Leaderboards from "@/pages/leaderboards";
import Players from "@/pages/players";
import { PublicRegisterPage } from "@/pages/public-register-page";
import { AdminRegistrationsPage } from "@/pages/admin-registrations-page";
import { QRCodePage } from "@/pages/qr-code-page";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      {/* Public routes without sidebar */}
      <Route path="/register/:tournamentId" component={PublicRegisterPage} />
      <Route path="/admin/qr/:tournamentId" component={QRCodePage} />
      
      {/* Admin routes with sidebar */}
      <Route path="/admin/registrations/:tournamentId" component={() => (
        <div className="flex h-screen overflow-hidden">
          <Sidebar />
          <main className="flex-1 overflow-y-auto">
            <AdminRegistrationsPage />
          </main>
        </div>
      )} />
      
      {/* Standard routes with sidebar */}
      <Route>
        {() => (
          <div className="flex h-screen overflow-hidden">
            <Sidebar />
            <main className="flex-1 overflow-y-auto">
              <Switch>
                <Route path="/" component={Dashboard} />
                <Route path="/clubs" component={Clubs} />
                <Route path="/clubs/:id" component={ClubDetails} />
                <Route path="/tournaments" component={Tournaments} />
                <Route path="/tournaments/:id" component={TournamentDetails} />
                <Route path="/seasons" component={Seasons} />
                <Route path="/leaderboards" component={Leaderboards} />
                <Route path="/players" component={Players} />
                <Route component={NotFound} />
              </Switch>
            </main>
          </div>
        )}
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
