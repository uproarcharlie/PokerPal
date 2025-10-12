import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActivityFeed } from "@/components/tournament/activity-feed";
import { Trophy, Users, DollarSign, Calendar, UserPlus, Lock, Target, ChartLine } from "lucide-react";

interface Tournament {
  id: string;
  name: string;
  description?: string;
  clubId: string;
  seasonId?: string;
  pointsSystemId?: string;
  startDateTime: string;
  status: string;
  buyInAmount: string;
  rebuyAmount?: string;
  addonAmount?: string;
  maxPlayers: number;
  enableHighHand: boolean;
  highHandAmount?: string;
  payoutStructure: string;
  rakeType?: string;
  rakeAmount?: string;
  rebuyRakeType?: string;
  rebuyRakeAmount?: string;
  addonRakeType?: string;
  addonRakeAmount?: string;
  trackPoints: boolean;
  prizePoolLocked: boolean;
  prizePoolLockedAt?: string;
}

interface Club {
  id: string;
  name: string;
  slug: string;
  description?: string;
  imageUrl?: string;
}

interface Season {
  id: string;
  name: string;
}

interface PointsSystem {
  id: string;
  name: string;
  participationPoints?: number;
  knockoutPoints?: number;
}

interface PointsAllocation {
  id: string;
  position: number;
  positionEnd?: number | null;
  points: number;
  description?: string | null;
}

interface TournamentRegistration {
  id: string;
  playerId: string;
  finalPosition?: number;
  prizeAmount?: string;
  pointsAwarded?: number;
  isEliminated: boolean;
  knockouts: number;
  buyIns: number;
  rebuys: number;
  addons: number;
  enteringHighHands: boolean;
  highHandWinner?: boolean;
  highHandAmount?: string;
  player: {
    name: string;
    imageUrl?: string;
  } | null;
}

interface LeaderboardEntry {
  player: {
    id: string;
    name: string;
    imageUrl?: string;
  };
  points: number;
  tournaments: number;
}

export default function PublicTournamentView() {
  const { id } = useParams();
  const [activeTab, setActiveTab] = useState("details");

  const { data: tournament, isLoading: tournamentLoading } = useQuery<Tournament>({
    queryKey: ["/api/tournaments", id],
  });

  const { data: club } = useQuery<Club>({
    queryKey: ["/api/clubs", tournament?.clubId],
    enabled: !!tournament?.clubId,
  });

  const { data: season } = useQuery<Season>({
    queryKey: ["/api/seasons", tournament?.seasonId],
    enabled: !!tournament?.seasonId,
  });

  const { data: pointsSystem } = useQuery<PointsSystem>({
    queryKey: ["/api/points-systems", tournament?.pointsSystemId],
    enabled: !!tournament?.pointsSystemId,
  });

  const { data: pointsAllocations = [] } = useQuery<PointsAllocation[]>({
    queryKey: ["/api/points-systems", tournament?.pointsSystemId, "allocations"],
    enabled: !!tournament?.pointsSystemId,
  });

  const { data: registrations = [] } = useQuery<TournamentRegistration[]>({
    queryKey: ["/api/tournaments", id, "registrations"],
    enabled: !!id,
    refetchInterval: 5000, // Refresh every 5 seconds
  });

  const { data: leaderboard = [] } = useQuery<LeaderboardEntry[]>({
    queryKey: ["/api/seasons", tournament?.seasonId, "leaderboard"],
    enabled: !!tournament?.seasonId,
  });

  if (tournamentLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="animate-pulse">
          <div className="bg-card border-b border-border p-8">
            <div className="max-w-6xl mx-auto">
              <div className="h-8 bg-muted rounded w-64 mb-4"></div>
              <div className="h-4 bg-muted rounded w-96"></div>
            </div>
          </div>
          <div className="max-w-6xl mx-auto p-8 space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="h-24 bg-muted rounded"></div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!tournament) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="max-w-md">
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">Tournament not found</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const totalPlayers = registrations.length;
  const activePlayers = registrations.filter(r => !r.isEliminated).length;
  const sortedStandings = [...registrations].sort((a, b) => {
    // If tournament is completed, sort by final position
    if (tournament.status === 'completed') {
      // Players with positions come first
      if (a.finalPosition && !b.finalPosition) return -1;
      if (!a.finalPosition && b.finalPosition) return 1;

      // Both have positions: sort by position (lower is better)
      if (a.finalPosition && b.finalPosition) {
        return a.finalPosition - b.finalPosition;
      }
    }

    // For in-progress tournaments: Active players first
    if (a.isEliminated && !b.isEliminated) return 1;
    if (!a.isEliminated && b.isEliminated) return -1;

    // Both eliminated: sort by elimination time (most recent first)
    if (a.isEliminated && b.isEliminated) {
      const aTime = a.eliminationTime ? new Date(a.eliminationTime).getTime() : 0;
      const bTime = b.eliminationTime ? new Date(b.eliminationTime).getTime() : 0;
      return bTime - aTime;
    }

    // Both active
    return 0;
  });

  // Calculate prize pool
  const totalBuyIns = registrations.reduce((sum, reg) => sum + reg.buyIns, 0);
  const totalRebuys = registrations.reduce((sum, reg) => sum + reg.rebuys, 0);
  const totalAddons = registrations.reduce((sum, reg) => sum + reg.addons, 0);

  const buyInTotal = totalBuyIns * parseFloat(tournament.buyInAmount);
  const rebuyTotal = totalRebuys * parseFloat(tournament.rebuyAmount || '0');
  const addonTotal = totalAddons * parseFloat(tournament.addonAmount || '0');
  const grossTotal = buyInTotal + rebuyTotal + addonTotal;

  // Calculate rake
  let buyInRake = 0;
  if (tournament.rakeType === 'percentage') {
    buyInRake = buyInTotal * (parseFloat(tournament.rakeAmount || '0') / 100);
  } else if (tournament.rakeType === 'fixed') {
    buyInRake = totalBuyIns * parseFloat(tournament.rakeAmount || '0');
  }

  let rebuyRake = 0;
  if (tournament.rebuyRakeType === 'percentage') {
    rebuyRake = rebuyTotal * (parseFloat(tournament.rebuyRakeAmount || '0') / 100);
  } else if (tournament.rebuyRakeType === 'fixed') {
    rebuyRake = totalRebuys * parseFloat(tournament.rebuyRakeAmount || '0');
  }

  let addonRake = 0;
  if (tournament.addonRakeType === 'percentage') {
    addonRake = addonTotal * (parseFloat(tournament.addonRakeAmount || '0') / 100);
  } else if (tournament.addonRakeType === 'fixed') {
    addonRake = totalAddons * parseFloat(tournament.addonRakeAmount || '0');
  }

  const rake = buyInRake + rebuyRake + addonRake;
  const netPrizePool = grossTotal - rake;

  // Prizes are shown once the pool is manually locked
  const isPrizePoolLocked = tournament.prizePoolLocked;

  // Calculate prize payouts
  const getPrizePayouts = () => {
    if (netPrizePool <= 0) return [];

    const payoutStructures: Record<string, number[]> = {
      'standard': [0.50, 0.30, 0.20],
      'top3': [0.50, 0.30, 0.20],
      'top5': [0.40, 0.25, 0.20, 0.10, 0.05],
      'top8': [0.35, 0.22, 0.15, 0.12, 0.08, 0.04, 0.02, 0.02],
      'top9': [0.30, 0.20, 0.15, 0.12, 0.09, 0.06, 0.04, 0.02, 0.02],
    };

    const percentages = payoutStructures[tournament.payoutStructure] || payoutStructures['standard'];

    return percentages.map((percentage, index) => ({
      position: index + 1,
      percentage: percentage * 100,
      amount: Math.round(netPrizePool * percentage),
    }));
  };

  const prizePayouts = getPrizePayouts();

  // Get finished players for results display
  const finishedPlayers = registrations.filter(r => r.finalPosition).sort((a, b) =>
    (a.finalPosition || 0) - (b.finalPosition || 0)
  );

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
        return 'In Progress';
      case 'registration':
        return 'Registration Open';
      case 'scheduled':
        return 'Scheduled';
      case 'completed':
        return 'Completed';
      default:
        return status;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header - Club Branded */}
      <header className="bg-gradient-to-br from-card via-card to-primary/5 border-b border-border">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-6 md:py-8">
          {/* Club Branding */}
          <div className="flex items-center justify-between mb-6">
            <Link href={`/club/${club?.slug || tournament.clubId}`}>
              <div className="flex items-center gap-3 hover:opacity-80 transition-opacity cursor-pointer">
                {club?.imageUrl ? (
                  <img
                    src={club.imageUrl}
                    alt={club.name}
                    className="w-12 h-12 md:w-16 md:h-16 rounded-lg object-cover border-2 border-primary/20"
                  />
                ) : (
                  <div className="w-12 h-12 md:w-16 md:h-16 bg-gradient-to-br from-primary to-accent rounded-lg flex items-center justify-center border-2 border-primary/20">
                    <Trophy className="w-6 h-6 md:w-8 md:h-8 text-white" />
                  </div>
                )}
                <div>
                  <h2 className="text-xl md:text-2xl font-bold text-primary">{club?.name || 'Poker Club'}</h2>
                </div>
              </div>
            </Link>
            {season && (
              <Badge variant="outline" className="text-xs md:text-sm px-3 py-1">
                {season.name}
              </Badge>
            )}
          </div>

          {/* Tournament Info */}
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div className="flex-1">
              <h1 className="text-2xl md:text-3xl font-bold text-foreground mb-2">{tournament.name}</h1>
              <div className="flex flex-wrap items-center gap-2 text-sm md:text-base text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Calendar className="w-4 h-4" />
                  {new Date(tournament.startDateTime).toLocaleDateString('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
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
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <Badge className={`${getStatusColor(tournament.status)} px-3 py-1 text-sm justify-center`}>
                <span className="w-2 h-2 bg-current rounded-full mr-2 animate-pulse"></span>
                {getStatusLabel(tournament.status)}
              </Badge>
              {(tournament.status === 'registration' || tournament.status === 'scheduled') && (
                <Link href={`/register/${tournament.id}`}>
                  <Button size="lg" className="w-full sm:w-auto">
                    <UserPlus className="w-4 h-4 mr-2" />
                    Register Now
                  </Button>
                </Link>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto p-4 md:p-8">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6 md:mb-8">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-primary/10 rounded-lg">
                  <Users className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Players</p>
                  <p className="text-2xl font-bold">{totalPlayers}/{tournament.maxPlayers}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {tournament.status === 'in_progress' && (
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-green-100 rounded-lg">
                    <Users className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Active</p>
                    <p className="text-2xl font-bold">{activePlayers}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-accent/10 rounded-lg">
                  <DollarSign className="w-5 h-5 text-accent" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Buy-in</p>
                  <p className="text-2xl font-bold">${tournament.buyInAmount}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-blue-100 rounded-lg">
                  <Calendar className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Start Time</p>
                  <p className="text-sm font-semibold">{new Date(tournament.startDateTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="standings">Standings</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>

          {/* Details Tab */}
          <TabsContent value="details" className="space-y-6">
            {/* Tournament Description */}
            {tournament.description && (
              <Card>
                <CardHeader className="border-b border-border">
                  <CardTitle>About This Tournament</CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                  <p className="text-muted-foreground">{tournament.description}</p>
                </CardContent>
              </Card>
            )}

            {/* Entry Info and High Hand */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader className="border-b border-border">
                  <CardTitle>Entry Details</CardTitle>
                </CardHeader>
                <CardContent className="p-6 space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Buy-in</span>
                    <span className="font-semibold">${tournament.buyInAmount}</span>
                  </div>
                  {tournament.rebuyAmount && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Re-buy</span>
                      <span className="font-semibold">${tournament.rebuyAmount}</span>
                    </div>
                  )}
                  {tournament.addonAmount && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Add-on</span>
                      <span className="font-semibold">${tournament.addonAmount}</span>
                    </div>
                  )}
                </CardContent>
              </Card>

              {tournament.enableHighHand && tournament.highHandAmount && (
                <Card>
                  <CardHeader className="border-b border-border">
                    <CardTitle className="flex items-center gap-2">
                      <Trophy className="w-5 h-5 text-accent" />
                      High Hand Bonus
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-6">
                    <p className="text-3xl font-bold text-accent">${parseFloat(tournament.highHandAmount).toLocaleString()}</p>
                    <p className="text-sm text-muted-foreground mt-1">Additional prize for highest hand</p>
                  </CardContent>
                </Card>
              )}
            </div>


            {/* Prize Structure - moved from separate tab */}
            <Card>
              <CardHeader className="border-b border-border">
                <CardTitle className="flex items-center gap-2 justify-between">
                  <div className="flex items-center gap-2">
                    <Trophy className="w-5 h-5 text-accent" />
                    Prize Pool Structure
                  </div>
                  {isPrizePoolLocked && (
                    <Badge variant="outline" className="text-xs">
                      <Lock className="w-3 h-3 mr-1" />
                      Locked
                    </Badge>
                  )}
                </CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  {isPrizePoolLocked ? (
                    `Total prize pool: $${Math.round(netPrizePool).toLocaleString()}`
                  ) : (
                    <span className="inline-flex items-center gap-1 text-orange-600">
                      <Lock className="w-4 h-4" />
                      Prize pool will be revealed when locked
                    </span>
                  )}
                </p>
              </CardHeader>
              <CardContent className="p-6">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-3 px-3">Position</th>
                        <th className="text-left py-3 px-3">Player</th>
                        <th className="text-right py-3 px-3">Prize</th>
                        {tournament.trackPoints && <th className="text-right py-3 px-3">Points</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {(() => {
                        // Get max position from either prizes or points
                        const maxPrizePosition = prizePayouts[prizePayouts.length - 1]?.position || 0;
                        const pointsPositions = pointsAllocations.map(pa => pa.positionEnd || pa.position).filter(p => p > 0);
                        const maxPointsPosition = pointsPositions.length > 0 ? Math.max(...pointsPositions) : 0;
                        const maxPosition = Math.max(maxPrizePosition, maxPointsPosition);

                        const rows = [];

                        // Create rows for all individual positions
                        for (let position = 1; position <= maxPosition; position++) {
                          const payout = prizePayouts.find(p => p.position === position);
                          const pointsAllocation = pointsAllocations.find(
                            pa => pa.positionEnd
                              ? (position >= pa.position && position <= pa.positionEnd)
                              : position === pa.position
                          );

                          // Find player at this position
                          const playerAtPosition = registrations.find(r => r.finalPosition === position);

                          // Skip if no prize and no points for this position
                          if (!payout && !pointsAllocation) continue;

                          rows.push(
                            <tr key={position} className="hover:bg-muted/20">
                              <td className="py-3 px-3">
                                <div className="flex items-center gap-2">
                                  {position <= 3 && (
                                    <Trophy className={`w-4 h-4 ${
                                      position === 1 ? 'text-yellow-500' :
                                      position === 2 ? 'text-gray-400' :
                                      'text-amber-600'
                                    }`} />
                                  )}
                                  <span className="font-medium">{position}{position === 1 ? 'st' : position === 2 ? 'nd' : position === 3 ? 'rd' : 'th'} Place</span>
                                </div>
                              </td>
                              <td className="py-3 px-3">
                                {playerAtPosition ? (
                                  <div className="flex items-center gap-2">
                                    {playerAtPosition.player?.imageUrl ? (
                                      <img
                                        src={playerAtPosition.player.imageUrl}
                                        alt={playerAtPosition.player.name}
                                        className="w-6 h-6 rounded-full object-cover"
                                      />
                                    ) : (
                                      <div className="w-6 h-6 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white text-xs font-semibold">
                                        {playerAtPosition.player?.name ? playerAtPosition.player.name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2) : '??'}
                                      </div>
                                    )}
                                    <span className="font-medium text-foreground">{playerAtPosition.player?.name || 'Unknown'}</span>
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground text-sm">-</span>
                                )}
                              </td>
                              <td className="py-3 px-3 text-right">
                                {payout ? (
                                  <span className="font-bold text-foreground">
                                    {isPrizePoolLocked ? `$${payout.amount.toLocaleString()}` : 'TBD'}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">-</span>
                                )}
                              </td>
                              {tournament.trackPoints && (
                                <td className="py-3 px-3 text-right">
                                  <Badge variant="outline" className="font-semibold">
                                    {pointsAllocation?.points || 0} pts
                                  </Badge>
                                </td>
                              )}
                            </tr>
                          );
                        }

                        // Add participation points row if applicable
                        console.log('Checking participation points:', {
                          trackPoints: tournament.trackPoints,
                          participationPoints: pointsSystem?.participationPoints,
                          maxPosition,
                          maxPlayers: tournament.maxPlayers
                        });

                        if (tournament.trackPoints && pointsSystem?.participationPoints && pointsSystem.participationPoints > 0) {
                          const startPosition = maxPosition + 1;
                          console.log('Start position:', startPosition, 'Max players:', tournament.maxPlayers);

                          if (startPosition <= tournament.maxPlayers) {
                            console.log('Adding participation row!');
                            rows.push(
                              <tr key="participation" className="bg-muted/20 border-t-2 border-border">
                                <td className="py-3 px-3">
                                  <span className="font-medium text-muted-foreground">
                                    {startPosition}{startPosition === 1 ? 'st' : startPosition === 2 ? 'nd' : startPosition === 3 ? 'rd' : 'th'}-{tournament.maxPlayers}{tournament.maxPlayers === 1 ? 'st' : tournament.maxPlayers === 2 ? 'nd' : tournament.maxPlayers === 3 ? 'rd' : 'th'} Place
                                  </span>
                                  <p className="text-xs text-muted-foreground mt-1">All other finishers</p>
                                </td>
                                <td className="py-3 px-3">
                                  <span className="text-muted-foreground text-sm">-</span>
                                </td>
                                <td className="py-3 px-3 text-right">
                                  <span className="text-muted-foreground">-</span>
                                </td>
                                {tournament.trackPoints && (
                                  <td className="py-3 px-3 text-right">
                                    <Badge variant="secondary" className="font-semibold">
                                      {pointsSystem.participationPoints} pts
                                    </Badge>
                                  </td>
                                )}
                              </tr>
                            );
                          }
                        }

                        return rows;
                      })()}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Standings Tab */}
          <TabsContent value="standings" className="space-y-6">
            <Tabs defaultValue="tournament" className="space-y-6">
              <TabsList className={`grid w-full ${tournament.seasonId ? 'grid-cols-2' : 'grid-cols-1'}`}>
                <TabsTrigger value="tournament">Tournament Standings</TabsTrigger>
                {tournament.seasonId && season && (
                  <TabsTrigger value="season">{season.name}</TabsTrigger>
                )}
              </TabsList>

              {/* Tournament Standings Sub-tab */}
              <TabsContent value="tournament">
                {/* High Hand Winners */}
                {tournament.enableHighHand && (() => {
                  const highHandWinners = registrations.filter(r => r.highHandWinner);
                  return highHandWinners.length > 0 ? (
                    <Card className="mb-6">
                      <CardHeader className="border-b border-border">
                        <CardTitle className="flex items-center gap-2">
                          <Trophy className="w-5 h-5 text-accent" />
                          High Hand Winners
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-0">
                        <div className="overflow-x-auto">
                          <table className="w-full">
                            <thead>
                              <tr className="border-b border-border bg-muted/30">
                                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase">Player</th>
                                <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase">Prize</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                              {highHandWinners.map((winner) => (
                                <tr key={winner.id} className="hover:bg-muted/20">
                                  <td className="py-4 px-4">
                                    <div className="flex items-center gap-3">
                                      {winner.player?.imageUrl ? (
                                        <img
                                          src={winner.player.imageUrl}
                                          alt={winner.player.name}
                                          className="w-10 h-10 rounded-full object-cover"
                                        />
                                      ) : (
                                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white text-sm font-semibold">
                                          {winner.player?.name ? winner.player.name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2) : '??'}
                                        </div>
                                      )}
                                      <p className="font-semibold text-foreground">{winner.player?.name || 'Unknown Player'}</p>
                                    </div>
                                  </td>
                                  <td className="py-4 px-4 text-right">
                                    {winner.highHandAmount && (
                                      <span className="text-xl font-bold text-accent">${parseFloat(winner.highHandAmount).toLocaleString()}</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </CardContent>
                    </Card>
                  ) : null;
                })()}

                {sortedStandings.length > 0 ? (
          <Card>
            <CardHeader className="border-b border-border">
              <CardTitle className="flex items-center gap-2">
                <Trophy className="w-5 h-5 text-accent" />
                {tournament.status === 'completed' ? 'Final Results' : 'Current Standings'}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase">Place</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase">Player</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase">Status</th>
                      <th className="text-center py-3 px-4 text-xs font-semibold text-muted-foreground uppercase">Knockouts</th>
                      {tournament.trackPoints && <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase">Points</th>}
                      <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase">Prize</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {sortedStandings.map((reg, index) => (
                      <tr key={reg.id} className="hover:bg-muted/20">
                        <td className="py-4 px-4">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                            !reg.isEliminated ? 'bg-green-100 text-green-800' :
                            index < 3 ? 'bg-accent/10 text-accent' :
                            'bg-muted text-muted-foreground'
                          }`}>
                            {index + 1}
                          </div>
                        </td>
                        <td className="py-4 px-4">
                          <div className="flex items-center gap-3">
                            {reg.player?.imageUrl ? (
                              <img
                                src={reg.player.imageUrl}
                                alt={reg.player.name}
                                className="w-10 h-10 rounded-full object-cover"
                              />
                            ) : (
                              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white text-sm font-semibold">
                                {reg.player?.name ? reg.player.name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2) : '??'}
                              </div>
                            )}
                            <p className={`font-semibold ${reg.isEliminated ? 'text-muted-foreground' : 'text-foreground'}`}>
                              {reg.player?.name || 'Unknown Player'}
                            </p>
                          </div>
                        </td>
                        <td className="py-4 px-4">
                          <Badge className={reg.isEliminated ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}>
                            {reg.isEliminated ? 'Eliminated' : 'Active'}
                          </Badge>
                        </td>
                        <td className="py-4 px-4 text-center">
                          <span className="inline-flex items-center gap-1 text-sm">
                            <Target className="w-4 h-4" />
                            {reg.knockouts || 0}
                          </span>
                        </td>
                        {tournament.trackPoints && (
                          <td className="py-4 px-4 text-right font-semibold">
                            {reg.pointsAwarded || 0}
                          </td>
                        )}
                        <td className="py-4 px-4 text-right">
                          {reg.prizeAmount && parseFloat(reg.prizeAmount) > 0 ? (
                            <span className="font-bold text-accent">${parseFloat(reg.prizeAmount).toLocaleString()}</span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
                ) : (
                  <Card>
                    <CardContent className="p-8 text-center">
                      <Trophy className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                      <p className="text-muted-foreground">No players registered yet</p>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* Season Leaderboard Sub-tab */}
              {tournament.seasonId && season && (
                <TabsContent value="season">
                  <Card>
                    <CardHeader className="border-b border-border">
                      <CardTitle className="flex items-center gap-2">
                        <ChartLine className="w-5 h-5 text-primary" />
                        {season.name} Leaderboard
                      </CardTitle>
                      <p className="text-sm text-muted-foreground mt-1">Season standings across all tournaments</p>
                    </CardHeader>
                    <CardContent className="p-0">
                      {leaderboard.length === 0 ? (
                        <div className="p-8 text-center">
                          <ChartLine className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                          <h3 className="text-lg font-semibold text-foreground mb-2">No Leaderboard Data</h3>
                          <p className="text-sm text-muted-foreground">
                            Complete some tournaments in this season to see player rankings.
                          </p>
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full">
                            <thead>
                              <tr className="border-b border-border bg-muted/30">
                                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase">Rank</th>
                                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase">Player</th>
                                <th className="text-center py-3 px-4 text-xs font-semibold text-muted-foreground uppercase">Tournaments</th>
                                <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase">Points</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                              {leaderboard.map((entry, index) => {
                                const position = index + 1;
                                const isTopThree = position <= 3;

                                return (
                                  <tr key={entry.player.id} className={`hover:bg-muted/20 ${isTopThree ? 'bg-accent/5' : ''}`}>
                                    <td className="py-4 px-4">
                                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                                        position === 1 ? 'bg-yellow-100 text-yellow-800' :
                                        position === 2 ? 'bg-gray-100 text-gray-800' :
                                        position === 3 ? 'bg-amber-100 text-amber-800' :
                                        'bg-muted text-muted-foreground'
                                      }`}>
                                        {position}
                                      </div>
                                    </td>
                                    <td className="py-4 px-4">
                                      <div className="flex items-center gap-3">
                                        {entry.player.imageUrl ? (
                                          <img
                                            src={entry.player.imageUrl}
                                            alt={entry.player.name}
                                            className="w-10 h-10 rounded-full object-cover"
                                          />
                                        ) : (
                                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white text-sm font-semibold">
                                            {entry.player.name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2)}
                                          </div>
                                        )}
                                        <div>
                                          <p className="font-semibold text-foreground">{entry.player.name}</p>
                                          {isTopThree && (
                                            <div className="flex items-center gap-1 mt-1">
                                              <Trophy className={`w-3 h-3 ${
                                                position === 1 ? 'text-yellow-500' :
                                                position === 2 ? 'text-gray-400' :
                                                'text-amber-600'
                                              }`} />
                                              <span className="text-xs text-muted-foreground">
                                                {position === 1 ? '1st Place' : position === 2 ? '2nd Place' : '3rd Place'}
                                              </span>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    </td>
                                    <td className="py-4 px-4 text-center">
                                      <Badge variant="outline" className="font-medium">
                                        {entry.tournaments}
                                      </Badge>
                                    </td>
                                    <td className="py-4 px-4 text-right">
                                      <span className={`text-xl font-bold ${isTopThree ? 'text-accent' : 'text-foreground'}`}>
                                        {entry.points.toLocaleString()}
                                      </span>
                                      <span className="text-xs text-muted-foreground ml-1">pts</span>
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
                </TabsContent>
              )}
            </Tabs>
          </TabsContent>

          {/* Activity Tab */}
          <TabsContent value="activity">
            <ActivityFeed tournamentId={tournament.id} />
          </TabsContent>
        </Tabs>
      </div>

      {/* Footer - Club Branding */}
      <footer className="mt-12 border-t border-border bg-card">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {club?.imageUrl ? (
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
                <p className="font-semibold text-foreground">{club?.name || 'Poker Club'}</p>
                <p className="text-xs text-muted-foreground">Powered by LovePoker.club</p>
              </div>
            </div>
            <div className="text-center md:text-right text-xs text-muted-foreground">
              <p>&copy; {new Date().getFullYear()} {club?.name || 'Poker Club'}. All rights reserved.</p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}