import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Users, Trophy, Calendar, Settings as SettingsIcon, ChartLine, ExternalLink, Copy, Check } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

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
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

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

  const { data: membersData } = useQuery<{ count: number }>({
    queryKey: ["/api/clubs", id, "members-count"],
    enabled: !!id,
  });

  const clubTournaments = tournaments.filter(t => t.clubId === id);
  const clubSeasons = seasons.filter(s => s.clubId === id);
  const activeSeasons = clubSeasons.filter(s => s.isActive);
  const activeTournaments = clubTournaments.filter(t => t.status === 'in_progress' || t.status === 'registration');

  const publicClubUrl = `${window.location.origin}/club/${id}`;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(publicClubUrl);
    setCopied(true);
    toast({
      title: "Link copied!",
      description: "Public club link copied to clipboard",
    });
    setTimeout(() => setCopied(false), 2000);
  };

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
        <Card className="mb-6 bg-gradient-to-r from-primary/5 to-accent/5 border-primary/20">
          <CardContent className="pt-6">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="flex-1">
                <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
                  <ExternalLink className="w-5 h-5 text-primary" />
                  Public Club Page
                </h3>
                <p className="text-sm text-muted-foreground mb-3">
                  Share this link with members and on social media to let people view tournaments and register
                </p>
                <div className="flex items-center gap-2 bg-background/60 p-3 rounded-md border border-border">
                  <code className="text-sm text-foreground flex-1 truncate">
                    {publicClubUrl}
                  </code>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCopyLink}
                    className="shrink-0"
                  >
                    {copied ? (
                      <Check className="w-4 h-4 text-green-600" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              </div>
              <a href={publicClubUrl} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" className="shrink-0">
                  <ExternalLink className="w-4 h-4 mr-2" />
                  View Public Page
                </Button>
              </a>
            </div>
          </CardContent>
        </Card>

        {club.description && (
          <Card className="mb-6">
            <CardContent className="pt-6">
              <div
                className="text-muted-foreground prose prose-sm max-w-none"
                data-testid="club-description"
                dangerouslySetInnerHTML={{ __html: club.description }}
              />
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6 mb-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Active Tournaments</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-green-600" data-testid="active-tournaments">
                {activeTournaments.length}
              </p>
            </CardContent>
          </Card>

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
              <CardTitle className="text-sm font-medium text-muted-foreground">Members</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-foreground" data-testid="members-count">
                {membersData?.count || 0}
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
                    <div key={season.id} className="p-3 rounded-lg border border-border hover:border-accent/40 transition-colors">
                      <div className="flex items-center justify-between mb-2">
                        <p className="font-semibold text-foreground">{season.name}</p>
                        {season.isActive && (
                          <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">Active</span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mb-3">
                        {new Date(season.startDate).toLocaleDateString()}
                        {season.endDate && ` - ${new Date(season.endDate).toLocaleDateString()}`}
                      </p>
                      <Link href={`/leaderboards?seasonId=${season.id}`}>
                        <Button variant="outline" size="sm" className="w-full">
                          <ChartLine className="w-4 h-4 mr-2" />
                          View Leaderboard
                        </Button>
                      </Link>
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
