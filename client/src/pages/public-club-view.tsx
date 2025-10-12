import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Trophy, Calendar, Users, TrendingUp, Info, Medal, Globe } from "lucide-react";
import { FaDiscord, FaTwitter, FaFacebook, FaInstagram } from "react-icons/fa";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Club {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
  createdAt: string;
  discordUrl?: string;
  twitterUrl?: string;
  facebookUrl?: string;
  instagramUrl?: string;
  websiteUrl?: string;
}

interface Tournament {
  id: string;
  name: string;
  clubId: string;
  startDateTime: string;
  status: string;
  buyInAmount: string;
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

interface LeaderboardEntry {
  player: {
    id: string;
    name: string;
    email?: string;
  };
  points: number;
  tournaments: number;
}

function SeasonLeaderboard({ season }: { season: Season }) {
  const { data: leaderboard = [], isLoading } = useQuery<LeaderboardEntry[]>({
    queryKey: [`/api/seasons/${season.id}/leaderboard`],
  });

  const getRankIcon = (rank: number) => {
    switch (rank) {
      case 1:
        return <Medal className="w-5 h-5 text-yellow-500" />;
      case 2:
        return <Medal className="w-5 h-5 text-gray-400" />;
      case 3:
        return <Medal className="w-5 h-5 text-amber-600" />;
      default:
        return <span className="text-muted-foreground font-semibold">{rank}</span>;
    }
  };

  return (
    <TabsContent key={season.id} value={season.id}>
      <Card>
        <CardHeader className="border-b border-border">
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" />
            {season.name} Leaderboard
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            {new Date(season.startDate).toLocaleDateString()}
            {season.endDate && ` - ${new Date(season.endDate).toLocaleDateString()}`}
          </p>
        </CardHeader>
        <CardContent className="p-6">
          {isLoading ? (
            <div className="text-center py-8">
              <div className="animate-pulse space-y-3">
                <div className="h-12 bg-muted rounded"></div>
                <div className="h-12 bg-muted rounded"></div>
                <div className="h-12 bg-muted rounded"></div>
              </div>
            </div>
          ) : leaderboard.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <TrendingUp className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p>No standings yet</p>
              <p className="text-sm mt-2">Points will appear here once tournaments are completed</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Rank</TableHead>
                    <TableHead>Player</TableHead>
                    <TableHead className="text-right">Tournaments</TableHead>
                    <TableHead className="text-right">Points</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leaderboard.map((entry, index) => (
                    <TableRow key={entry.player.id} className={index < 3 ? 'bg-primary/5' : ''}>
                      <TableCell className="font-medium">
                        <div className="flex items-center justify-center">
                          {getRankIcon(index + 1)}
                        </div>
                      </TableCell>
                      <TableCell className="font-semibold">{entry.player.name}</TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {entry.tournaments}
                      </TableCell>
                      <TableCell className="text-right font-bold text-primary">
                        {entry.points}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </TabsContent>
  );
}

export default function PublicClubView() {
  const { id } = useParams();
  const [activeTab, setActiveTab] = useState("details");

  const { data: club, isLoading: clubLoading } = useQuery<Club>({
    queryKey: ["/api/clubs", id],
  });

  const { data: tournaments = [] } = useQuery<Tournament[]>({
    queryKey: ["/api/tournaments"],
  });

  const { data: seasons = [] } = useQuery<Season[]>({
    queryKey: ["/api/seasons"],
  });

  const clubTournaments = tournaments.filter(t => t.clubId === id);
  const clubSeasons = seasons.filter(s => s.clubId === id);
  const activeSeasons = clubSeasons.filter(s => s.isActive);
  const currentSeason = activeSeasons[0]; // Default to first active season

  const upcomingTournaments = clubTournaments.filter(
    t => t.status === 'scheduled' || t.status === 'registration'
  ).sort((a, b) => new Date(a.startDateTime).getTime() - new Date(b.startDateTime).getTime());

  const activeTournaments = clubTournaments.filter(t => t.status === 'in_progress');
  const completedTournaments = clubTournaments.filter(t => t.status === 'completed')
    .sort((a, b) => new Date(b.startDateTime).getTime() - new Date(a.startDateTime).getTime());
  const allTournaments = [...activeTournaments, ...upcomingTournaments];

  if (clubLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="animate-pulse">
          <div className="bg-card border-b border-border p-8">
            <div className="max-w-6xl mx-auto">
              <div className="h-20 bg-muted rounded w-64 mb-4"></div>
              <div className="h-4 bg-muted rounded w-96"></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!club) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="max-w-md">
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">Club not found</p>
          </CardContent>
        </Card>
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
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'in_progress':
        return 'Live';
      case 'registration':
        return 'Registration Open';
      case 'scheduled':
        return 'Upcoming';
      case 'completed':
        return 'Completed';
      default:
        return status;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header - Club Branding */}
      <header className="bg-gradient-to-br from-card via-card to-primary/5 border-b border-border">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-6 md:py-8">
          <div className="flex items-center gap-4 md:gap-6">
            {club.imageUrl ? (
              <img
                src={club.imageUrl}
                alt={club.name}
                className="w-16 h-16 md:w-20 md:h-20 rounded-lg object-cover border-2 border-primary/20"
              />
            ) : (
              <div className="w-16 h-16 md:w-20 md:h-20 bg-gradient-to-br from-primary to-accent rounded-lg flex items-center justify-center border-2 border-primary/20">
                <Trophy className="w-8 h-8 md:w-10 md:h-10 text-white" />
              </div>
            )}
            <div className="flex-1">
              <h1 className="text-2xl md:text-3xl font-bold text-primary">{club.name}</h1>

              {/* Social Icons */}
              {(club.discordUrl || club.twitterUrl || club.facebookUrl || club.instagramUrl || club.websiteUrl) && (
                <div className="flex items-center gap-3 mt-3">
                  {club.discordUrl && (
                    <a
                      href={club.discordUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-[#5865F2] transition-colors"
                      title="Discord"
                    >
                      <FaDiscord className="w-5 h-5" />
                    </a>
                  )}
                  {club.twitterUrl && (
                    <a
                      href={club.twitterUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-[#1DA1F2] transition-colors"
                      title="Twitter/X"
                    >
                      <FaTwitter className="w-5 h-5" />
                    </a>
                  )}
                  {club.facebookUrl && (
                    <a
                      href={club.facebookUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-[#1877F2] transition-colors"
                      title="Facebook"
                    >
                      <FaFacebook className="w-5 h-5" />
                    </a>
                  )}
                  {club.instagramUrl && (
                    <a
                      href={club.instagramUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-[#E4405F] transition-colors"
                      title="Instagram"
                    >
                      <FaInstagram className="w-5 h-5" />
                    </a>
                  )}
                  {club.websiteUrl && (
                    <a
                      href={club.websiteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-primary transition-colors"
                      title="Website"
                    >
                      <Globe className="w-5 h-5" />
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto p-4 md:p-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="tournaments">Tournaments</TabsTrigger>
            <TabsTrigger value="standings">Standings</TabsTrigger>
          </TabsList>

          {/* Details Tab */}
          <TabsContent value="details" className="space-y-6">
            <Card>
              <CardHeader className="border-b border-border">
                <CardTitle className="flex items-center gap-2">
                  <Info className="w-5 h-5 text-primary" />
                  About {club.name}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                {club.description ? (
                  <div
                    className="text-muted-foreground prose prose-sm max-w-none"
                    dangerouslySetInnerHTML={{ __html: club.description }}
                  />
                ) : (
                  <p className="text-muted-foreground italic">No description available</p>
                )}
              </CardContent>
            </Card>

            {/* Active Seasons Info */}
            {activeSeasons.length > 0 && (
              <div>
                <h2 className="text-2xl font-bold mb-4">Active Seasons</h2>
                <div className="grid gap-4 md:grid-cols-2">
                  {activeSeasons.map((season) => (
                    <Card key={season.id}>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <TrendingUp className="w-5 h-5 text-primary" />
                          {season.name}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Start Date:</span>
                            <span className="font-semibold">
                              {new Date(season.startDate).toLocaleDateString()}
                            </span>
                          </div>
                          {season.endDate && (
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">End Date:</span>
                              <span className="font-semibold">
                                {new Date(season.endDate).toLocaleDateString()}
                              </span>
                            </div>
                          )}
                          <div className="pt-2">
                            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                              Active
                            </Badge>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>

          {/* Tournaments Tab */}
          <TabsContent value="tournaments" className="space-y-6">
            {/* Live Tournaments */}
            {activeTournaments.length > 0 && (
              <div>
                <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
                  <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                  Live Tournaments
                </h2>
                <div className="grid gap-4">
                  {activeTournaments.map((tournament) => (
                    <Link key={tournament.id} href={`/tournament/${tournament.id}`}>
                      <Card className="hover:border-primary transition-colors cursor-pointer">
                        <CardContent className="p-6">
                          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div className="flex-1">
                              <h3 className="text-xl font-bold mb-2">{tournament.name}</h3>
                              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                                <div className="flex items-center gap-1">
                                  <Calendar className="w-4 h-4" />
                                  {new Date(tournament.startDateTime).toLocaleDateString()}
                                </div>
                                <span>•</span>
                                <div className="flex items-center gap-1">
                                  Buy-in: ${parseFloat(tournament.buyInAmount).toFixed(2)}
                                </div>
                                <span>•</span>
                                <div className="flex items-center gap-1">
                                  <Users className="w-4 h-4" />
                                  {tournament.maxPlayers} max
                                </div>
                              </div>
                            </div>
                            <Badge className={`${getStatusColor(tournament.status)} whitespace-nowrap`}>
                              <span className="w-2 h-2 bg-current rounded-full mr-2 animate-pulse"></span>
                              {getStatusLabel(tournament.status)}
                            </Badge>
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Upcoming Tournaments */}
            <div>
              <h2 className="text-2xl font-bold mb-4">Upcoming Tournaments</h2>
              {upcomingTournaments.length === 0 ? (
                <Card>
                  <CardContent className="p-8 text-center">
                    <Calendar className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground">No upcoming tournaments scheduled</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-4">
                  {upcomingTournaments.map((tournament) => (
                    <Link key={tournament.id} href={`/tournament/${tournament.id}`}>
                      <Card className="hover:border-primary transition-colors cursor-pointer">
                        <CardContent className="p-6">
                          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div className="flex-1">
                              <h3 className="text-xl font-bold mb-2">{tournament.name}</h3>
                              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                                <div className="flex items-center gap-1">
                                  <Calendar className="w-4 h-4" />
                                  {new Date(tournament.startDateTime).toLocaleDateString('en-US', {
                                    weekday: 'long',
                                    month: 'long',
                                    day: 'numeric',
                                    year: 'numeric'
                                  })}
                                </div>
                                <span>•</span>
                                <div className="flex items-center gap-1">
                                  {new Date(tournament.startDateTime).toLocaleTimeString('en-US', {
                                    hour: '2-digit',
                                    minute: '2-digit'
                                  })}
                                </div>
                              </div>
                              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground mt-2">
                                <div className="flex items-center gap-1">
                                  Buy-in: ${parseFloat(tournament.buyInAmount).toFixed(2)}
                                </div>
                                <span>•</span>
                                <div className="flex items-center gap-1">
                                  <Users className="w-4 h-4" />
                                  {tournament.maxPlayers} max players
                                </div>
                              </div>
                            </div>
                            <Badge className={`${getStatusColor(tournament.status)} whitespace-nowrap`}>
                              {getStatusLabel(tournament.status)}
                            </Badge>
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Completed Tournaments */}
            {completedTournaments.length > 0 && (
              <div>
                <h2 className="text-2xl font-bold mb-4">Past Tournaments</h2>
                <div className="grid gap-4">
                  {completedTournaments.map((tournament) => (
                    <Link key={tournament.id} href={`/tournament/${tournament.id}`}>
                      <Card className="hover:border-primary transition-colors cursor-pointer">
                        <CardContent className="p-6">
                          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div className="flex-1">
                              <h3 className="text-xl font-bold mb-2">{tournament.name}</h3>
                              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                                <div className="flex items-center gap-1">
                                  <Calendar className="w-4 h-4" />
                                  {new Date(tournament.startDateTime).toLocaleDateString('en-US', {
                                    weekday: 'long',
                                    month: 'long',
                                    day: 'numeric',
                                    year: 'numeric'
                                  })}
                                </div>
                                <span>•</span>
                                <div className="flex items-center gap-1">
                                  {new Date(tournament.startDateTime).toLocaleTimeString('en-US', {
                                    hour: '2-digit',
                                    minute: '2-digit'
                                  })}
                                </div>
                              </div>
                              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground mt-2">
                                <div className="flex items-center gap-1">
                                  Buy-in: ${parseFloat(tournament.buyInAmount).toFixed(2)}
                                </div>
                                <span>•</span>
                                <div className="flex items-center gap-1">
                                  <Users className="w-4 h-4" />
                                  {tournament.maxPlayers} max players
                                </div>
                              </div>
                            </div>
                            <Badge className={`${getStatusColor(tournament.status)} whitespace-nowrap`}>
                              {getStatusLabel(tournament.status)}
                            </Badge>
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>

          {/* Standings Tab */}
          <TabsContent value="standings" className="space-y-6">
            {clubSeasons.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <TrendingUp className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">No seasons available</p>
                </CardContent>
              </Card>
            ) : (
              <Tabs defaultValue={currentSeason?.id || clubSeasons[0]?.id} className="space-y-6">
                <TabsList className={`grid w-full ${clubSeasons.length > 3 ? 'grid-cols-3' : `grid-cols-${clubSeasons.length}`}`}>
                  {clubSeasons.slice(0, 3).map((season) => (
                    <TabsTrigger key={season.id} value={season.id}>
                      {season.name}
                      {season.isActive && (
                        <Badge variant="outline" className="ml-2 bg-green-50 text-green-700 border-green-200 text-xs">
                          Active
                        </Badge>
                      )}
                    </TabsTrigger>
                  ))}
                </TabsList>

                {clubSeasons.map((season) => (
                  <SeasonLeaderboard key={season.id} season={season} />
                ))}
              </Tabs>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Footer */}
      <footer className="mt-12 border-t border-border bg-card">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {club.imageUrl ? (
                <img
                  src={club.imageUrl}
                  alt={club.name}
                  className="w-10 h-10 rounded-lg object-cover"
                />
              ) : (
                <div className="w-10 h-10 bg-gradient-to-br from-primary to-accent rounded-lg flex items-center justify-center">
                  <Trophy className="w-5 h-5 text-white" />
                </div>
              )}
              <div>
                <p className="font-semibold text-foreground">{club.name}</p>
                <p className="text-xs text-muted-foreground">Powered by LovePoker.club</p>
              </div>
            </div>
            <div className="text-center md:text-right text-xs text-muted-foreground">
              <p>&copy; {new Date().getFullYear()} {club.name}. All rights reserved.</p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
