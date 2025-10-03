import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PrizePoolCalculator } from "@/components/tournament/prize-pool-calculator";
import { StandingsTable } from "@/components/tournament/standings-table";
import { RegisterPlayerModal } from "@/components/modals/register-player-modal";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { 
  ArrowLeft, 
  Play, 
  Pause, 
  Square, 
  UserPlus, 
  Trophy,
  Calculator,
  FolderSync,
  PlusCircle,
  Download,
  Info
} from "lucide-react";

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
  maxRebuys?: number;
  rebuyPeriodMinutes?: number;
  rakeType: string;
  rakeAmount: string;
  payoutStructure: string;
  enableHighHand: boolean;
  highHandAmount?: string;
  enableLateRegistration: boolean;
  trackPoints: boolean;
  minPlayers: number;
  maxPlayers: number;
  createdAt: string;
}

interface Club {
  id: string;
  name: string;
}

interface TournamentRegistration {
  id: string;
  tournamentId: string;
  playerId: string;
  buyIns: number;
  rebuys: number;
  addons: number;
  finalPosition?: number;
  prizeAmount?: string;
  pointsAwarded?: number;
  isEliminated: boolean;
  eliminationTime?: string;
  player: {
    id: string;
    name: string;
    email?: string;
  } | null;
}

export default function TournamentDetails() {
  const { id } = useParams();
  const { toast } = useToast();
  const [showRegisterPlayer, setShowRegisterPlayer] = useState(false);
  
  const { data: tournament, isLoading: tournamentLoading } = useQuery<Tournament>({
    queryKey: ["/api/tournaments", id],
  });

  const { data: club } = useQuery<Club>({
    queryKey: ["/api/clubs", tournament?.clubId],
    enabled: !!tournament?.clubId,
  });

  const { data: registrations = [], isLoading: registrationsLoading } = useQuery<TournamentRegistration[]>({
    queryKey: ["/api/tournaments", id, "registrations"],
    enabled: !!id,
  });

  const updateTournamentMutation = useMutation({
    mutationFn: async (data: { status: string }) => {
      const response = await apiRequest("PUT", `/api/tournaments/${id}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tournaments", id] });
      toast({
        title: "Success",
        description: "Tournament status updated successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update tournament",
        variant: "destructive",
      });
    },
  });

  if (tournamentLoading) {
    return (
      <div className="min-h-screen">
        <div className="animate-pulse">
          <div className="bg-card border-b border-border p-8">
            <div className="h-8 bg-muted rounded w-64 mb-4"></div>
            <div className="h-4 bg-muted rounded w-96"></div>
          </div>
          <div className="p-8 space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              {[1,2,3,4,5].map(i => (
                <div key={i} className="h-20 bg-muted rounded"></div>
              ))}
            </div>
            <div className="h-96 bg-muted rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!tournament) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Alert className="max-w-md">
          <AlertDescription>Tournament not found</AlertDescription>
        </Alert>
      </div>
    );
  }

  const totalPlayers = registrations.length;
  const totalBuyIns = registrations.reduce((sum, reg) => sum + reg.buyIns, 0);
  const totalRebuys = registrations.reduce((sum, reg) => sum + reg.rebuys, 0);
  const totalAddons = registrations.reduce((sum, reg) => sum + reg.addons, 0);

  const grossTotal = 
    (totalBuyIns * parseFloat(tournament.buyInAmount)) +
    (totalRebuys * parseFloat(tournament.rebuyAmount || '0')) +
    (totalAddons * parseFloat(tournament.addonAmount || '0'));

  let rake = 0;
  if (tournament.rakeType === 'percentage') {
    rake = grossTotal * (parseFloat(tournament.rakeAmount) / 100);
  } else if (tournament.rakeType === 'fixed') {
    rake = parseFloat(tournament.rakeAmount);
  }

  const netPrizePool = grossTotal - rake;

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

  const handleStatusChange = (newStatus: string) => {
    updateTournamentMutation.mutate({ status: newStatus });
  };

  const canStart = tournament.status === 'registration' && totalPlayers >= tournament.minPlayers;
  const canPause = tournament.status === 'in_progress';
  const canEnd = tournament.status === 'in_progress';

  return (
    <>
      <div className="min-h-screen">
        {/* Tournament Header */}
        <header className="bg-card border-b border-border sticky top-0 z-10">
          <div className="px-8 py-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-4">
                <Link href="/tournaments">
                  <Button variant="ghost" size="sm" data-testid="back-to-tournaments">
                    <ArrowLeft className="w-4 h-4" />
                  </Button>
                </Link>
                <div>
                  <h2 className="text-2xl font-bold text-foreground">{tournament.name}</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    <span>{club?.name || 'Unknown Club'}</span>
                    {tournament.seasonId && <span> • Season: {tournament.seasonId}</span>}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge className={getStatusColor(tournament.status)}>
                  <span className="w-2 h-2 bg-current rounded-full mr-2 animate-pulse"></span>
                  {tournament.status === 'in_progress' ? 'In Progress' :
                   tournament.status === 'registration' ? 'Registration' : 
                   tournament.status === 'completed' ? 'Completed' : 'Scheduled'}
                </Badge>
                {canStart && (
                  <Button 
                    onClick={() => handleStatusChange('in_progress')}
                    disabled={updateTournamentMutation.isPending}
                    data-testid="start-tournament"
                  >
                    <Play className="w-4 h-4 mr-2" />
                    Start Tournament
                  </Button>
                )}
                {canPause && (
                  <Button 
                    variant="outline"
                    onClick={() => handleStatusChange('registration')}
                    disabled={updateTournamentMutation.isPending}
                    data-testid="pause-tournament"
                  >
                    <Pause className="w-4 h-4 mr-2" />
                    Pause
                  </Button>
                )}
                {canEnd && (
                  <Button 
                    variant="destructive"
                    onClick={() => handleStatusChange('completed')}
                    disabled={updateTournamentMutation.isPending}
                    data-testid="end-tournament"
                  >
                    <Square className="w-4 h-4 mr-2" />
                    End Tournament
                  </Button>
                )}
              </div>
            </div>

            {/* Tournament Stats */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="bg-muted/30 rounded-lg p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Players</p>
                <p className="text-2xl font-bold text-foreground" data-testid="players-count">
                  {totalPlayers}/{tournament.maxPlayers}
                </p>
              </div>
              <div className="bg-muted/30 rounded-lg p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Prize Pool</p>
                <p className="text-2xl font-bold text-foreground" data-testid="prize-pool">
                  ${Math.round(netPrizePool).toLocaleString()}
                </p>
              </div>
              <div className="bg-muted/30 rounded-lg p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Buy-ins</p>
                <p className="text-2xl font-bold text-foreground" data-testid="total-buyins">
                  {totalBuyIns}
                </p>
              </div>
              <div className="bg-muted/30 rounded-lg p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Re-buys</p>
                <p className="text-2xl font-bold text-foreground" data-testid="total-rebuys">
                  {totalRebuys}
                </p>
              </div>
              <div className="bg-muted/30 rounded-lg p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Add-ons</p>
                <p className="text-2xl font-bold text-foreground" data-testid="total-addons">
                  {totalAddons}
                </p>
              </div>
            </div>
          </div>
        </header>

        <div className="p-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main Tournament Content */}
            <div className="lg:col-span-2 space-y-6">
              {/* Prize Structure Display */}
              <Card>
                <CardHeader className="border-b border-border">
                  <CardTitle className="flex items-center gap-2">
                    <Trophy className="w-5 h-5" />
                    Prize Structure
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">Payout distribution for top finishers</p>
                </CardHeader>
                <CardContent className="p-6">
                  {netPrizePool > 0 ? (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="bg-gradient-to-br from-accent/10 to-accent/5 rounded-lg p-4 border-2 border-accent">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-muted-foreground">1st Place</span>
                            <Trophy className="text-accent w-5 h-5" />
                          </div>
                          <p className="text-3xl font-bold text-foreground">
                            ${Math.round(netPrizePool * 0.5).toLocaleString()}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">50% of prize pool</p>
                        </div>
                        <div className="bg-muted/30 rounded-lg p-4 border border-border">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-muted-foreground">2nd Place</span>
                            <Trophy className="text-muted-foreground w-5 h-5" />
                          </div>
                          <p className="text-3xl font-bold text-foreground">
                            ${Math.round(netPrizePool * 0.3).toLocaleString()}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">30% of prize pool</p>
                        </div>
                        <div className="bg-muted/30 rounded-lg p-4 border border-border">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-muted-foreground">3rd Place</span>
                            <Trophy className="text-muted-foreground w-5 h-5" />
                          </div>
                          <p className="text-3xl font-bold text-foreground">
                            ${Math.round(netPrizePool * 0.2).toLocaleString()}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">20% of prize pool</p>
                        </div>
                      </div>

                      {tournament.enableHighHand && tournament.highHandAmount && (
                        <div className="mt-4 pt-4 border-t border-border flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-foreground">High Hand Bonus</p>
                            <p className="text-xs text-muted-foreground">Additional prize for highest hand</p>
                          </div>
                          <p className="text-xl font-bold text-accent">
                            ${parseFloat(tournament.highHandAmount).toLocaleString()}
                          </p>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-center py-8">
                      <Trophy className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                      <p className="text-sm text-muted-foreground">Prize pool will be calculated once players register</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Tournament Standings */}
              <StandingsTable 
                tournamentId={tournament.id} 
                registrations={registrations}
                isLoading={registrationsLoading}
                onRegisterPlayer={() => setShowRegisterPlayer(true)}
              />
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Prize Pool Calculator */}
              <PrizePoolCalculator 
                tournament={tournament}
                grossTotal={grossTotal}
                rake={rake}
                netPrizePool={netPrizePool}
              />

              {/* Quick Actions */}
              <Card>
                <CardHeader className="border-b border-border">
                  <CardTitle>Quick Actions</CardTitle>
                </CardHeader>
                <CardContent className="p-6 space-y-3">
                  <Button 
                    variant="outline" 
                    className="w-full justify-between"
                    onClick={() => setShowRegisterPlayer(true)}
                    data-testid="register-player-button"
                  >
                    <span className="flex items-center">
                      <UserPlus className="w-4 h-4 mr-3" />
                      Register Player
                    </span>
                  </Button>
                  
                  {tournament.enableHighHand && (
                    <Button variant="outline" className="w-full justify-between">
                      <span className="flex items-center">
                        <Trophy className="w-4 h-4 mr-3" />
                        Award High Hand
                      </span>
                    </Button>
                  )}
                  
                  <Button variant="outline" className="w-full justify-between">
                    <span className="flex items-center">
                      <FolderSync className="w-4 h-4 mr-3" />
                      Process Re-buy
                    </span>
                  </Button>
                  
                  <Button variant="outline" className="w-full justify-between">
                    <span className="flex items-center">
                      <PlusCircle className="w-4 h-4 mr-3" />
                      Process Add-on
                    </span>
                  </Button>
                  
                  <Button variant="outline" className="w-full justify-between">
                    <span className="flex items-center">
                      <Download className="w-4 h-4 mr-3" />
                      Export Results
                    </span>
                  </Button>
                </CardContent>
              </Card>

              {/* Tournament Info */}
              <Card>
                <CardHeader className="border-b border-border">
                  <CardTitle>Tournament Info</CardTitle>
                </CardHeader>
                <CardContent className="p-6 space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Start Time</span>
                    <span className="font-medium text-foreground">
                      {new Date(tournament.startDateTime).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Buy-in</span>
                    <span className="font-medium text-foreground">${tournament.buyInAmount}</span>
                  </div>
                  {tournament.rebuyAmount && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Re-buy</span>
                      <span className="font-medium text-foreground">${tournament.rebuyAmount}</span>
                    </div>
                  )}
                  {tournament.addonAmount && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Add-on</span>
                      <span className="font-medium text-foreground">${tournament.addonAmount}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Max Players</span>
                    <span className="font-medium text-foreground">{tournament.maxPlayers}</span>
                  </div>
                  {tournament.description && (
                    <div className="pt-3 border-t border-border">
                      <span className="text-muted-foreground block mb-2">Description</span>
                      <span className="font-medium text-foreground">{tournament.description}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>

      <RegisterPlayerModal 
        open={showRegisterPlayer}
        onOpenChange={setShowRegisterPlayer}
        tournamentId={tournament.id}
      />
    </>
  );
}
