import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, ChartLine, Trophy, Medal, Award, Download } from "lucide-react";
import { Link } from "wouter";

interface Season {
  id: string;
  name: string;
  clubId: string;
  isActive: boolean;
}

interface Club {
  id: string;
  name: string;
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

export default function Leaderboards() {
  const [selectedSeasonId, setSelectedSeasonId] = useState<string>("");

  const { data: seasons = [] } = useQuery<Season[]>({
    queryKey: ["/api/seasons"],
  });

  const { data: clubs = [] } = useQuery<Club[]>({
    queryKey: ["/api/clubs"],
  });

  const { data: leaderboard = [] } = useQuery<LeaderboardEntry[]>({
    queryKey: ["/api/seasons", selectedSeasonId, "leaderboard"],
    enabled: !!selectedSeasonId,
  });

  const getClubName = (clubId: string) => {
    const club = clubs.find(c => c.id === clubId);
    return club?.name || 'Unknown Club';
  };

  const getPlayerInitials = (name: string) => {
    return name
      .split(' ')
      .map(word => word[0])
      .join('')
      .toUpperCase()
      .substring(0, 2);
  };

  const getRankIcon = (position: number) => {
    switch (position) {
      case 1:
        return <Trophy className="w-5 h-5 text-accent" />;
      case 2:
        return <Medal className="w-5 h-5 text-muted-foreground" />;
      case 3:
        return <Award className="w-5 h-5 text-muted-foreground" />;
      default:
        return null;
    }
  };

  const getRankBadgeClass = (position: number) => {
    switch (position) {
      case 1:
        return "bg-accent text-accent-foreground";
      case 2:
        return "bg-muted text-muted-foreground";
      case 3:
        return "bg-muted text-muted-foreground";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const selectedSeason = seasons.find(s => s.id === selectedSeasonId);

  return (
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
                <h2 className="text-2xl font-bold text-foreground">Leaderboards</h2>
                <p className="text-sm text-muted-foreground mt-1">Track player rankings and tournament performance</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Select value={selectedSeasonId} onValueChange={setSelectedSeasonId}>
                <SelectTrigger className="w-64" data-testid="season-selector">
                  <SelectValue placeholder="Select a season" />
                </SelectTrigger>
                <SelectContent>
                  {seasons.length === 0 ? (
                    <SelectItem value="no-seasons" disabled>No seasons available</SelectItem>
                  ) : (
                    seasons.map((season) => (
                      <SelectItem key={season.id} value={season.id}>
                        {season.name} - {getClubName(season.clubId)}
                        {season.isActive && <Badge className="ml-2 bg-green-100 text-green-800">Active</Badge>}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" disabled={!selectedSeasonId}>
                <Download className="w-4 h-4 mr-2" />
                Export
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="p-8">
        {!selectedSeasonId ? (
          <div className="text-center py-16">
            <ChartLine className="w-16 h-16 text-muted-foreground mx-auto mb-6" />
            <h3 className="text-xl font-semibold text-foreground mb-3">Select a Season</h3>
            <p className="text-muted-foreground mb-6 max-w-md mx-auto">
              Choose a season from the dropdown above to view its leaderboard and player rankings.
            </p>
          </div>
        ) : seasons.length === 0 ? (
          <div className="text-center py-16">
            <ChartLine className="w-16 h-16 text-muted-foreground mx-auto mb-6" />
            <h3 className="text-xl font-semibold text-foreground mb-3">No Seasons Available</h3>
            <p className="text-muted-foreground mb-6 max-w-md mx-auto">
              Create seasons and tournaments to start tracking player leaderboards and rankings.
            </p>
            <div className="flex gap-3 justify-center">
              <Link href="/clubs">
                <Button variant="outline">Create Club</Button>
              </Link>
              <Link href="/seasons">
                <Button>Create Season</Button>
              </Link>
            </div>
          </div>
        ) : (
          <Card>
            <CardHeader className="border-b border-border">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Trophy className="w-6 h-6 text-accent" />
                    Season Leaderboard
                  </CardTitle>
                  {selectedSeason && (
                    <p className="text-sm text-muted-foreground mt-1">
                      {selectedSeason.name} - {getClubName(selectedSeason.clubId)}
                      {selectedSeason.isActive && (
                        <Badge className="ml-2 bg-green-100 text-green-800">Active</Badge>
                      )}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-foreground" data-testid="total-players">
                    {leaderboard.length}
                  </p>
                  <p className="text-sm text-muted-foreground">Total Players</p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {leaderboard.length === 0 ? (
                <div className="p-8 text-center">
                  <ChartLine className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-foreground mb-2">No Leaderboard Data</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Complete some tournaments in this season to see player rankings.
                  </p>
                  <Link href="/tournaments">
                    <Button>View Tournaments</Button>
                  </Link>
                </div>
              ) : (
                <div className="p-6">
                  <div className="space-y-3">
                    {leaderboard.map((entry, index) => {
                      const position = index + 1;
                      const isTopThree = position <= 3;
                      
                      return (
                        <div 
                          key={entry.player.id} 
                          className={`flex items-center gap-4 p-4 rounded-lg border ${
                            isTopThree ? 'border-accent/20 bg-accent/5' : 'border-border'
                          } hover:border-accent/40 transition-colors`}
                          data-testid={`leaderboard-entry-${position}`}
                        >
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${getRankBadgeClass(position)}`}>
                            {position}
                          </div>
                          
                          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white text-sm font-semibold shrink-0">
                            {getPlayerInitials(entry.player.name)}
                          </div>
                          
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="font-semibold text-foreground">{entry.player.name}</p>
                              {getRankIcon(position)}
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {entry.tournaments} tournament{entry.tournaments !== 1 ? 's' : ''}
                              {entry.player.email && ` • ${entry.player.email}`}
                            </p>
                          </div>

                          <div className="text-right shrink-0 mr-4">
                            <p className={`text-xl font-bold ${isTopThree ? 'text-accent' : 'text-foreground'}`}>
                              {entry.points.toLocaleString()}
                            </p>
                            <p className="text-xs text-muted-foreground">points</p>
                          </div>

                          <div className="text-right shrink-0">
                            <p className={`text-xl font-bold ${isTopThree ? 'text-accent' : 'text-foreground'}`}>
                              {entry.tournaments}
                            </p>
                            <p className="text-xs text-muted-foreground">tournaments</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
