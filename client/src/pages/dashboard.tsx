import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CreateTournamentModal } from "@/components/modals/create-tournament-modal";
import { PlayCircle, UsersRound, DollarSign, Users, Eye, Edit, Bell, Plus, Filter, Download, Trophy, ChartLine } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";

interface DashboardStats {
  activeTournaments: number;
  totalPlayers: number;
  totalPrizePool: number;
  activeClubs: number;
}

interface Tournament {
  id: string;
  name: string;
  status: string;
  clubId: string;
  seasonId?: string;
  startDateTime: string;
  maxPlayers: number;
}

interface Club {
  id: string;
  name: string;
  createdAt: string;
}

export default function Dashboard() {
  const [showCreateTournament, setShowCreateTournament] = useState(false);

  const { data: stats, isLoading: statsLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats"],
  });

  const { data: tournaments = [], isLoading: tournamentsLoading } = useQuery<Tournament[]>({
    queryKey: ["/api/tournaments"],
  });

  const { data: clubs = [], isLoading: clubsLoading } = useQuery<Club[]>({
    queryKey: ["/api/clubs"],
  });

  const { data: leaderboard = [] } = useQuery({
    queryKey: ["/api/seasons/active/leaderboard"],
    enabled: false, // Enable when we have active seasons
  });

  if (statsLoading || tournamentsLoading || clubsLoading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-muted rounded w-64"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-32 bg-muted rounded"></div>
            ))}
          </div>
          <div className="h-96 bg-muted rounded"></div>
        </div>
      </div>
    );
  }

  const activeTournaments = tournaments.filter(t => 
    t.status === 'in_progress' || t.status === 'registration'
  );

  return (
    <>
      <div className="min-h-screen">
        {/* Header */}
        <header className="bg-card border-b border-border sticky top-0 z-10">
          <div className="px-8 py-4 flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-foreground">Dashboard</h2>
              <p className="text-sm text-muted-foreground mt-1">Manage your poker tournaments and clubs</p>
            </div>
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="sm" data-testid="notifications-button">
                <Bell className="w-4 h-4 mr-2" />
                Notifications
              </Button>
              <Button onClick={() => setShowCreateTournament(true)} data-testid="create-tournament-button">
                <Plus className="w-4 h-4 mr-2" />
                New Tournament
              </Button>
            </div>
          </div>
        </header>

        {/* Content */}
        <div className="p-8 space-y-6">
          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                    <PlayCircle className="text-primary w-6 h-6" />
                  </div>
                  <Badge variant="secondary" className="text-green-600 bg-green-50">+12%</Badge>
                </div>
                <h3 className="text-2xl font-bold text-foreground" data-testid="active-tournaments-count">
                  {stats?.activeTournaments || 0}
                </h3>
                <p className="text-sm text-muted-foreground mt-1">Active Tournaments</p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-12 h-12 bg-accent/10 rounded-lg flex items-center justify-center">
                    <UsersRound className="text-accent w-6 h-6" />
                  </div>
                  <Badge variant="secondary" className="text-green-600 bg-green-50">+24%</Badge>
                </div>
                <h3 className="text-2xl font-bold text-foreground" data-testid="total-players-count">
                  {stats?.totalPlayers || 0}
                </h3>
                <p className="text-sm text-muted-foreground mt-1">Total Players</p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-12 h-12 bg-green-500/10 rounded-lg flex items-center justify-center">
                    <DollarSign className="text-green-600 w-6 h-6" />
                  </div>
                  <Badge variant="secondary" className="text-green-600 bg-green-50">+8%</Badge>
                </div>
                <h3 className="text-2xl font-bold text-foreground" data-testid="total-prize-pool">
                  ${stats?.totalPrizePool?.toLocaleString() || '0'}
                </h3>
                <p className="text-sm text-muted-foreground mt-1">Total Prize Pool</p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-12 h-12 bg-blue-500/10 rounded-lg flex items-center justify-center">
                    <Users className="text-blue-600 w-6 h-6" />
                  </div>
                  <Badge variant="secondary" className="text-green-600 bg-green-50">+3</Badge>
                </div>
                <h3 className="text-2xl font-bold text-foreground" data-testid="active-clubs-count">
                  {stats?.activeClubs || 0}
                </h3>
                <p className="text-sm text-muted-foreground mt-1">Active Clubs</p>
              </CardContent>
            </Card>
          </div>

          {/* Active Tournaments */}
          <Card>
            <CardHeader className="border-b border-border flex flex-row items-center justify-between">
              <div>
                <CardTitle>Active Tournaments</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">Currently running and upcoming events</p>
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
              {activeTournaments.length === 0 ? (
                <div className="p-8 text-center">
                  <Trophy className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-foreground mb-2">No Active Tournaments</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Create your first tournament to get started with managing poker events.
                  </p>
                  <Button onClick={() => setShowCreateTournament(true)} data-testid="create-first-tournament">
                    <Plus className="w-4 h-4 mr-2" />
                    Create Tournament
                  </Button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        <th className="text-left py-3 px-6 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tournament</th>
                        <th className="text-left py-3 px-6 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Club</th>
                        <th className="text-left py-3 px-6 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                        <th className="text-left py-3 px-6 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Players</th>
                        <th className="text-left py-3 px-6 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Start Time</th>
                        <th className="text-right py-3 px-6 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {activeTournaments.map((tournament) => {
                        const club = clubs.find(c => c.id === tournament.clubId);
                        const statusColors = {
                          'in_progress': 'bg-green-100 text-green-800',
                          'registration': 'bg-blue-100 text-blue-800',
                          'scheduled': 'bg-yellow-100 text-yellow-800'
                        };
                        
                        return (
                          <tr key={tournament.id} className="hover:bg-muted/20 transition-colors" data-testid={`tournament-row-${tournament.id}`}>
                            <td className="py-4 px-6">
                              <div>
                                <p className="font-medium text-foreground">{tournament.name}</p>
                                <p className="text-sm text-muted-foreground">Season: {tournament.seasonId || 'No Season'}</p>
                              </div>
                            </td>
                            <td className="py-4 px-6">
                              <div className="flex items-center gap-2">
                                <div className="w-8 h-8 bg-gradient-to-br from-primary to-accent rounded-md flex items-center justify-center text-white text-xs font-bold">
                                  {club?.name?.substring(0, 2).toUpperCase() || 'CL'}
                                </div>
                                <span className="text-sm font-medium text-foreground">{club?.name || 'Unknown Club'}</span>
                              </div>
                            </td>
                            <td className="py-4 px-6">
                              <Badge className={statusColors[tournament.status as keyof typeof statusColors] || statusColors.scheduled}>
                                <span className="w-1.5 h-1.5 bg-current rounded-full mr-1.5"></span>
                                {tournament.status === 'in_progress' ? 'In Progress' :
                                 tournament.status === 'registration' ? 'Registration' : 'Scheduled'}
                              </Badge>
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
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Two Column Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Recent Clubs */}
            <Card>
              <CardHeader className="border-b border-border flex flex-row items-center justify-between">
                <CardTitle>Recent Clubs</CardTitle>
                <Link href="/clubs">
                  <Button variant="link" size="sm">View all</Button>
                </Link>
              </CardHeader>
              <CardContent className="p-6 space-y-4">
                {clubs.length === 0 ? (
                  <div className="text-center py-8">
                    <Users className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">No clubs found</p>
                    <p className="text-xs text-muted-foreground mt-1">Create your first club to organize tournaments</p>
                  </div>
                ) : (
                  clubs.slice(0, 3).map((club) => (
                    <div key={club.id} className="flex items-center gap-4 p-3 hover:bg-muted/20 rounded-lg transition-colors cursor-pointer" data-testid={`club-card-${club.id}`}>
                      <div className="w-12 h-12 bg-gradient-to-br from-primary to-accent rounded-lg flex items-center justify-center text-white text-sm font-bold shrink-0">
                        {club.name.substring(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-foreground">{club.name}</h4>
                        <p className="text-sm text-muted-foreground">0 members • 0 tournaments</p>
                      </div>
                      <Button variant="ghost" size="sm">
                        <Eye className="w-4 h-4" />
                      </Button>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            {/* Season Leaderboard Preview */}
            <Card>
              <CardHeader className="border-b border-border flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Season Leaderboard</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">Current Season - Top 5</p>
                </div>
                <Link href="/leaderboards">
                  <Button variant="link" size="sm">Full leaderboard</Button>
                </Link>
              </CardHeader>
              <CardContent className="p-6">
                <div className="text-center py-8">
                  <ChartLine className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">No leaderboard data</p>
                  <p className="text-xs text-muted-foreground mt-1">Complete some tournaments to see rankings</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <CreateTournamentModal 
        open={showCreateTournament} 
        onOpenChange={setShowCreateTournament}
      />
    </>
  );
}
