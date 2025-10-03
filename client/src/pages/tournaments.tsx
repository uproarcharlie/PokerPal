import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CreateTournamentModal } from "@/components/modals/create-tournament-modal";
import { Plus, Trophy, Eye, Edit, ArrowLeft, Filter, Download } from "lucide-react";
import { Link } from "wouter";

interface Tournament {
  id: string;
  name: string;
  description?: string;
  clubId: string;
  seasonId?: string;
  startDateTime: string;
  status: string;
  buyInAmount: string;
  rebuyAmount?: string;
  addonAmount?: string;
  maxPlayers: number;
  createdAt: string;
}

interface Club {
  id: string;
  name: string;
}

export default function Tournaments() {
  const [showCreateTournament, setShowCreateTournament] = useState(false);

  const { data: tournaments = [], isLoading } = useQuery<Tournament[]>({
    queryKey: ["/api/tournaments"],
  });

  const { data: clubs = [] } = useQuery<Club[]>({
    queryKey: ["/api/clubs"],
  });

  if (isLoading) {
    return (
      <div className="min-h-screen">
        <header className="bg-card border-b border-border">
          <div className="px-8 py-4">
            <div className="animate-pulse space-y-3">
              <div className="h-8 bg-muted rounded w-48"></div>
              <div className="h-4 bg-muted rounded w-64"></div>
            </div>
          </div>
        </header>
        <div className="p-8">
          <div className="h-96 bg-muted rounded animate-pulse"></div>
        </div>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'in_progress':
        return 'bg-green-100 text-green-800';
      case 'registration':
        return 'bg-blue-100 text-blue-800';
      case 'scheduled':
        return 'bg-yellow-100 text-yellow-800';
      case 'completed':
        return 'bg-gray-100 text-gray-800';
      case 'cancelled':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'in_progress':
        return 'In Progress';
      case 'registration':
        return 'Registration';
      case 'scheduled':
        return 'Scheduled';
      case 'completed':
        return 'Completed';
      case 'cancelled':
        return 'Cancelled';
      default:
        return status;
    }
  };

  const getClubName = (clubId: string) => {
    const club = clubs.find(c => c.id === clubId);
    return club?.name || 'Unknown Club';
  };

  const getClubInitials = (clubId: string) => {
    const clubName = getClubName(clubId);
    return clubName.substring(0, 2).toUpperCase();
  };

  return (
    <>
      <div className="min-h-screen">
        <header className="bg-card border-b border-border sticky top-0 z-10">
          <div className="px-8 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Link href="/">
                  <Button variant="ghost" size="sm" data-testid="back-to-dashboard">
                    <ArrowLeft className="w-4 h-4" />
                  </Button>
                </Link>
                <div>
                  <h2 className="text-2xl font-bold text-foreground">Tournaments</h2>
                  <p className="text-sm text-muted-foreground mt-1">Manage all your poker tournaments</p>
                </div>
              </div>
              <Button onClick={() => setShowCreateTournament(true)} data-testid="create-tournament-button">
                <Plus className="w-4 h-4 mr-2" />
                Create Tournament
              </Button>
            </div>
          </div>
        </header>

        <div className="p-8">
          {tournaments.length === 0 ? (
            <div className="text-center py-16">
              <Trophy className="w-16 h-16 text-muted-foreground mx-auto mb-6" />
              <h3 className="text-xl font-semibold text-foreground mb-3">No Tournaments Found</h3>
              <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                Create your first tournament to start organizing poker events and managing player registrations.
              </p>
              <Button onClick={() => setShowCreateTournament(true)} data-testid="create-first-tournament">
                <Plus className="w-4 h-4 mr-2" />
                Create Your First Tournament
              </Button>
            </div>
          ) : (
            <Card>
              <CardHeader className="border-b border-border flex flex-row items-center justify-between">
                <div>
                  <CardTitle>All Tournaments</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">Manage and view all tournament events</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm">
                    <Filter className="w-4 h-4 mr-2" />
                    Filter
                  </Button>
                  <Button variant="ghost" size="sm">
                    <Download className="w-4 h-4 mr-2" />
                    Export
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        <th className="text-left py-3 px-6 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tournament</th>
                        <th className="text-left py-3 px-6 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Club</th>
                        <th className="text-left py-3 px-6 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                        <th className="text-left py-3 px-6 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Buy-in</th>
                        <th className="text-left py-3 px-6 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Players</th>
                        <th className="text-left py-3 px-6 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Start Time</th>
                        <th className="text-right py-3 px-6 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {tournaments.map((tournament) => (
                        <tr key={tournament.id} className="hover:bg-muted/20 transition-colors" data-testid={`tournament-row-${tournament.id}`}>
                          <td className="py-4 px-6">
                            <div>
                              <p className="font-medium text-foreground">{tournament.name}</p>
                              <p className="text-sm text-muted-foreground">
                                {tournament.seasonId ? `Season: ${tournament.seasonId}` : 'No Season'}
                              </p>
                            </div>
                          </td>
                          <td className="py-4 px-6">
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 bg-gradient-to-br from-primary to-accent rounded-md flex items-center justify-center text-white text-xs font-bold">
                                {getClubInitials(tournament.clubId)}
                              </div>
                              <span className="text-sm font-medium text-foreground">{getClubName(tournament.clubId)}</span>
                            </div>
                          </td>
                          <td className="py-4 px-6">
                            <Badge className={getStatusColor(tournament.status)}>
                              <span className="w-1.5 h-1.5 bg-current rounded-full mr-1.5"></span>
                              {getStatusLabel(tournament.status)}
                            </Badge>
                          </td>
                          <td className="py-4 px-6">
                            <span className="text-sm font-semibold text-foreground">${tournament.buyInAmount}</span>
                          </td>
                          <td className="py-4 px-6">
                            <span className="text-sm font-medium text-foreground">0/{tournament.maxPlayers}</span>
                          </td>
                          <td className="py-4 px-6">
                            <span className="text-sm text-muted-foreground">
                              {new Date(tournament.startDateTime).toLocaleString()}
                            </span>
                          </td>
                          <td className="py-4 px-6">
                            <div className="flex items-center justify-end gap-2">
                              <Link href={`/tournaments/${tournament.id}`}>
                                <Button variant="ghost" size="sm" data-testid={`view-tournament-${tournament.id}`}>
                                  <Eye className="w-4 h-4 mr-1" />
                                  View
                                </Button>
                              </Link>
                              <Button variant="ghost" size="sm" data-testid={`edit-tournament-${tournament.id}`}>
                                <Edit className="w-4 h-4 mr-1" />
                                Edit
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <CreateTournamentModal 
        open={showCreateTournament} 
        onOpenChange={setShowCreateTournament}
      />
    </>
  );
}
