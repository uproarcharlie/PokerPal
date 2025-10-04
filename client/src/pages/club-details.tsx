import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Users, Trophy, Calendar, Settings as SettingsIcon } from "lucide-react";

interface Club {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
}

interface Tournament {
  id: string;
  name: string;
  clubId: string;
  startDateTime: string;
  status: string;
  maxPlayers: number;
}

interface Season {
  id: string;
  name: string;
  clubId: string;
  startDate: string;
  endDate?: string;
  isActive: boolean;
}

export default function ClubDetails() {
  const { id } = useParams();

  const { data: club, isLoading: clubLoading } = useQuery<Club>({
    queryKey: ["/api/clubs", id],
    enabled: !!id,
  });

  const { data: tournaments = [], isLoading: tournamentsLoading } = useQuery<Tournament[]>({
    queryKey: ["/api/tournaments"],
  });

  const { data: seasons = [], isLoading: seasonsLoading } = useQuery<Season[]>({
    queryKey: ["/api/seasons"],
  });

  const clubTournaments = tournaments.filter(t => t.clubId === id);
  const clubSeasons = seasons.filter(s => s.clubId === id);
  const activeSeasons = clubSeasons.filter(s => s.isActive);

  if (clubLoading || tournamentsLoading || seasonsLoading) {
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
          <div className="space-y-6">
            <div className="h-32 bg-muted rounded-lg animate-pulse"></div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="h-64 bg-muted rounded-lg animate-pulse"></div>
              <div className="h-64 bg-muted rounded-lg animate-pulse"></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!club) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-foreground mb-4">Club Not Found</h2>
          <p className="text-muted-foreground mb-6">The club you're looking for doesn't exist.</p>
          <Link href="/clubs">
            <Button>Back to Clubs</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="bg-card border-b border-border sticky top-0 z-10">
        <div className="px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/clubs">
                <Button variant="ghost" size="sm" data-testid="back-to-clubs">
                  <ArrowLeft className="w-4 h-4" />
                </Button>
              </Link>
              <div>
                <h2 className="text-2xl font-bold text-foreground" data-testid="club-name">{club.name}</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Est. {new Date(club.createdAt).toLocaleDateString()}
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <Link href={`/tournaments?clubId=${club.id}`}>
                <Button variant="outline">
                  <Trophy className="w-4 h-4 mr-2" />
                  Create Tournament
                </Button>
              </Link>
              <Link href={`/seasons?clubId=${club.id}`}>
                <Button variant="outline">
                  <Calendar className="w-4 h-4 mr-2" />
                  Create Season
                </Button>
              </Link>
              <Button variant="outline">
                <SettingsIcon className="w-4 h-4 mr-2" />
                Settings
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="p-8">
        {club.description && (
          <Card className="mb-6">
            <CardContent className="pt-6">
              <p className="text-muted-foreground" data-testid="club-description">{club.description}</p>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Tournaments</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-foreground" data-testid="total-tournaments">
                {clubTournaments.length}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Active Seasons</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-foreground" data-testid="active-seasons">
                {activeSeasons.length}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Seasons</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-foreground" data-testid="total-seasons">
                {clubSeasons.length}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Members</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-foreground" data-testid="members-count">
                0
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader className="border-b border-border">
              <CardTitle className="flex items-center gap-2">
                <Trophy className="w-5 h-5 text-accent" />
                Recent Tournaments
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              {clubTournaments.length === 0 ? (
                <div className="text-center py-8">
                  <Trophy className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground">No tournaments yet</p>
                  <Link href={`/tournaments?clubId=${club.id}`}>
                    <Button variant="outline" size="sm" className="mt-4">
                      Create First Tournament
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="space-y-3">
                  {clubTournaments.slice(0, 5).map((tournament) => (
                    <Link key={tournament.id} href={`/tournaments/${tournament.id}`}>
                      <div className="p-3 rounded-lg border border-border hover:border-accent/40 transition-colors cursor-pointer">
                        <p className="font-semibold text-foreground">{tournament.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {new Date(tournament.startDateTime).toLocaleDateString()} • {tournament.status}
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b border-border">
              <CardTitle className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-accent" />
                Seasons
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              {clubSeasons.length === 0 ? (
                <div className="text-center py-8">
                  <Calendar className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground">No seasons yet</p>
                  <Link href={`/seasons?clubId=${club.id}`}>
                    <Button variant="outline" size="sm" className="mt-4">
                      Create First Season
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="space-y-3">
                  {clubSeasons.map((season) => (
                    <div key={season.id} className="p-3 rounded-lg border border-border">
                      <div className="flex items-center justify-between">
                        <p className="font-semibold text-foreground">{season.name}</p>
                        {season.isActive && (
                          <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">Active</span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {new Date(season.startDate).toLocaleDateString()}
                        {season.endDate && ` - ${new Date(season.endDate).toLocaleDateString()}`}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
