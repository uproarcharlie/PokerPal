import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { PrizePoolCalculator } from "@/components/tournament/prize-pool-calculator";
import { StandingsTable } from "@/components/tournament/standings-table";
import { ActivityFeed } from "@/components/tournament/activity-feed";
import { RegisterPlayerModal } from "@/components/modals/register-player-modal";
import { AssignHighHandModal } from "@/components/modals/assign-high-hand-modal";
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog";
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
  Info,
  CheckCircle2,
  ExternalLink,
  Trash2,
  Lock,
  Unlock
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
  highHandRakeType?: string;
  highHandRakeAmount?: string;
  highHandPayouts?: number;
  enableLateRegistration: boolean;
  trackPoints: boolean;
  minPlayers: number;
  maxPlayers: number;
  prizePoolLocked: boolean;
  prizePoolLockedAt?: string;
  manualPrizePool?: string;
  createdAt: string;
}

interface Club {
  id: string;
  name: string;
}

interface Season {
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
  enteringHighHands: boolean;
  highHandWinner?: boolean;
  highHandAmount?: string;
  player: {
    id: string;
    name: string;
    email?: string;
  } | null;
}

export default function TournamentDetails() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [showRegisterPlayer, setShowRegisterPlayer] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [highHandModalOpen, setHighHandModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const [editingPrizePool, setEditingPrizePool] = useState(false);
  const [manualPrizePool, setManualPrizePool] = useState("");
  
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

  const deleteTournamentMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/tournaments/${id}`);
    },
    onSuccess: async () => {
      // Invalidate and refetch queries before navigating
      await queryClient.invalidateQueries({ queryKey: ["/api/tournaments"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });

      toast({
        title: "Success",
        description: "Tournament deleted successfully",
      });

      // Navigate after queries are invalidated
      setLocation("/tournaments");
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete tournament",
        variant: "destructive",
      });
    },
  });

  const lockPrizePoolMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("PUT", `/api/tournaments/${id}`, {
        prizePoolLocked: true,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tournaments", id] });
      toast({
        title: "Prize Pool Locked",
        description: "No further registrations, rebuys, or addons will be allowed",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to lock prize pool",
        variant: "destructive",
      });
    },
  });

  const updatePrizePoolMutation = useMutation({
    mutationFn: async (amount: string) => {
      const response = await apiRequest("PUT", `/api/tournaments/${id}`, {
        manualPrizePool: amount || null,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tournaments", id] });
      setEditingPrizePool(false);
      toast({
        title: "Success",
        description: "Prize pool updated successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update prize pool",
        variant: "destructive",
      });
    },
  });

  const finalizeTournamentMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/tournaments/${id}/finalize`, {});
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tournaments", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/tournaments", id, "registrations"] });
      toast({
        title: "Tournament Finalized",
        description: "Positions, prizes, and points have been assigned to all players",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to finalize tournament",
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

  const buyInTotal = totalBuyIns * parseFloat(tournament.buyInAmount);
  const rebuyTotal = totalRebuys * parseFloat(tournament.rebuyAmount || '0');
  const addonTotal = totalAddons * parseFloat(tournament.addonAmount || '0');
  const grossTotal = buyInTotal + rebuyTotal + addonTotal;

  // Calculate buy-in rake
  let buyInRake = 0;
  if (tournament.rakeType === 'percentage') {
    buyInRake = buyInTotal * (parseFloat(tournament.rakeAmount) / 100);
  } else if (tournament.rakeType === 'fixed') {
    buyInRake = totalBuyIns * parseFloat(tournament.rakeAmount);
  }

  // Calculate rebuy rake
  let rebuyRake = 0;
  if (tournament.rebuyRakeType === 'percentage') {
    rebuyRake = rebuyTotal * (parseFloat(tournament.rebuyRakeAmount || '0') / 100);
  } else if (tournament.rebuyRakeType === 'fixed') {
    rebuyRake = totalRebuys * parseFloat(tournament.rebuyRakeAmount || '0');
  }

  // Calculate addon rake
  let addonRake = 0;
  if (tournament.addonRakeType === 'percentage') {
    addonRake = addonTotal * (parseFloat(tournament.addonRakeAmount || '0') / 100);
  } else if (tournament.addonRakeType === 'fixed') {
    addonRake = totalAddons * parseFloat(tournament.addonRakeAmount || '0');
  }

  const rake = buyInRake + rebuyRake + addonRake;
  const calculatedPrizePool = grossTotal - rake;
  const netPrizePool = tournament.manualPrizePool
    ? parseFloat(tournament.manualPrizePool)
    : calculatedPrizePool;

  // Calculate prize payouts based on payout structure
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
          <div className="px-4 md:px-8 py-3 md:py-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-3 md:mb-4">
              <div className="flex items-center gap-2 md:gap-4">
                <Link href="/tournaments">
                  <Button variant="ghost" size="sm" data-testid="back-to-tournaments">
                    <ArrowLeft className="w-4 h-4" />
                  </Button>
                </Link>
                <div className="min-w-0">
                  <h2 className="text-lg md:text-2xl font-bold text-foreground truncate">{tournament.name}</h2>
                  <p className="text-xs md:text-sm text-muted-foreground mt-1">
                    <span>{club?.name || 'Unknown Club'}</span>
                    {season && <span className="hidden sm:inline"> • Season: {season.name}</span>}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 md:gap-3 flex-wrap">
                <Badge className={getStatusColor(tournament.status)}>
                  <span className="w-2 h-2 bg-current rounded-full mr-2 animate-pulse"></span>
                  {tournament.status === 'in_progress' ? 'In Progress' :
                   tournament.status === 'registration' ? 'Registration' :
                   tournament.status === 'completed' ? 'Completed' : 'Scheduled'}
                </Badge>
                <Link href={`/admin/registrations/${tournament.id}`} className="hidden sm:inline">
                  <Button variant="outline" size="sm">
                    <UserPlus className="w-4 h-4 mr-2" />
                    Registrations
                  </Button>
                </Link>
                <Link href={`/tournament/${tournament.id}`} className="hidden sm:inline">
                  <Button variant="outline" size="sm">
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Public View
                  </Button>
                </Link>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDeleteDialog(true)}
                  className="text-destructive hover:text-destructive hover:bg-destructive/10 hidden md:flex"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete
                </Button>
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
                    onClick={() => finalizeTournamentMutation.mutate()}
                    disabled={finalizeTournamentMutation.isPending}
                    data-testid="end-tournament"
                  >
                    <Square className="w-4 h-4 mr-2" />
                    {finalizeTournamentMutation.isPending ? 'Finalizing...' : 'End Tournament'}
                  </Button>
                )}
              </div>
            </div>

            {/* Tournament Stats */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 md:gap-4">
              <div className="bg-muted/30 rounded-lg p-3 md:p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Players</p>
                <p className="text-xl md:text-2xl font-bold text-foreground" data-testid="players-count">
                  {totalPlayers}/{tournament.maxPlayers}
                </p>
              </div>
              <div className="bg-muted/30 rounded-lg p-3 md:p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                  Prize Pool
                  {!tournament.prizePoolLocked && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 px-2 ml-2"
                      onClick={() => {
                        setEditingPrizePool(!editingPrizePool);
                        setManualPrizePool(tournament.manualPrizePool || "");
                      }}
                    >
                      {editingPrizePool ? "Cancel" : "Edit"}
                    </Button>
                  )}
                </p>
                {editingPrizePool && !tournament.prizePoolLocked ? (
                  <div className="flex gap-2 items-center">
                    <Input
                      type="number"
                      value={manualPrizePool}
                      onChange={(e) => setManualPrizePool(e.target.value)}
                      placeholder={Math.round(calculatedPrizePool).toString()}
                      className="h-8 text-sm"
                    />
                    <Button
                      size="sm"
                      className="h-8"
                      onClick={() => updatePrizePoolMutation.mutate(manualPrizePool)}
                    >
                      Save
                    </Button>
                  </div>
                ) : (
                  <p className="text-xl md:text-2xl font-bold text-foreground" data-testid="prize-pool">
                    ${Math.round(netPrizePool).toLocaleString()}
                    {tournament.manualPrizePool && (
                      <span className="text-xs text-muted-foreground ml-2">(manual)</span>
                    )}
                  </p>
                )}
              </div>
              <div className="bg-muted/30 rounded-lg p-3 md:p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Buy-ins</p>
                <p className="text-xl md:text-2xl font-bold text-foreground" data-testid="total-buyins">
                  {totalBuyIns}
                </p>
              </div>
              <div className="bg-muted/30 rounded-lg p-3 md:p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Re-buys</p>
                <p className="text-xl md:text-2xl font-bold text-foreground" data-testid="total-rebuys">
                  {totalRebuys}
                </p>
              </div>
              <div className="bg-muted/30 rounded-lg p-3 md:p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Add-ons</p>
                <p className="text-xl md:text-2xl font-bold text-foreground" data-testid="total-addons">
                  {totalAddons}
                </p>
              </div>
            </div>
          </div>
        </header>

        <div className="p-4 md:p-8">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-4 mb-6">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="standings">Standings</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
              <TabsTrigger value="actions">Actions</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-0">
              <div className="space-y-6">
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
                      {/* Top 3 Highlight */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                        {prizePayouts.slice(0, 3).map((payout, index) => (
                          <div
                            key={payout.position}
                            className={`rounded-lg p-4 ${
                              index === 0
                                ? 'bg-gradient-to-br from-accent/10 to-accent/5 border-2 border-accent'
                                : 'bg-muted/30 border border-border'
                            }`}
                          >
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm font-medium text-muted-foreground">
                                {payout.position === 1 ? '1st' : payout.position === 2 ? '2nd' : '3rd'} Place
                              </span>
                              <Trophy className={`w-5 h-5 ${index === 0 ? 'text-accent' : 'text-muted-foreground'}`} />
                            </div>
                            <p className="text-3xl font-bold text-foreground">
                              ${payout.amount.toLocaleString()}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">{payout.percentage}% of prize pool</p>
                          </div>
                        ))}
                      </div>

                      {/* Full Payout Table */}
                      {prizePayouts.length > 3 && (
                        <div className="border-t border-border pt-6">
                          <h5 className="text-sm font-semibold text-foreground mb-4 uppercase tracking-wide">
                            Complete Payout Structure
                          </h5>
                          <div className="overflow-x-auto">
                            <table className="w-full">
                              <thead>
                                <tr className="border-b border-border">
                                  <th className="text-left py-2 px-3 text-xs font-semibold text-muted-foreground uppercase">Position</th>
                                  <th className="text-right py-2 px-3 text-xs font-semibold text-muted-foreground uppercase">Percentage</th>
                                  <th className="text-right py-2 px-3 text-xs font-semibold text-muted-foreground uppercase">Prize</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border">
                                {prizePayouts.map((payout) => (
                                  <tr key={payout.position} className="hover:bg-muted/20">
                                    <td className="py-3 px-3">
                                      <span className="font-medium text-foreground">
                                        {payout.position === 1 ? '🥇 1st' :
                                         payout.position === 2 ? '🥈 2nd' :
                                         payout.position === 3 ? '🥉 3rd' :
                                         `${payout.position}th`}
                                      </span>
                                    </td>
                                    <td className="py-3 px-3 text-right text-sm text-muted-foreground">
                                      {payout.percentage}%
                                    </td>
                                    <td className="py-3 px-3 text-right">
                                      <span className="font-bold text-foreground">
                                        ${payout.amount.toLocaleString()}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot>
                                <tr className="border-t-2 border-border font-bold">
                                  <td className="py-3 px-3 text-foreground">Total</td>
                                  <td className="py-3 px-3 text-right text-muted-foreground">100%</td>
                                  <td className="py-3 px-3 text-right text-primary text-lg">
                                    ${netPrizePool.toLocaleString()}
                                  </td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                        </div>
                      )}

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

              {/* Prize Pool Calculator */}
              <PrizePoolCalculator
                tournament={tournament}
                grossTotal={grossTotal}
                rake={rake}
                netPrizePool={netPrizePool}
                totalBuyIns={totalBuyIns}
                totalRebuys={totalRebuys}
                totalAddons={totalAddons}
                highHandEntrants={registrations.filter(r => r.enteringHighHands).length}
              />

              {/* Tournament Info */}
              <Card>
                <CardHeader className="border-b border-border">
                  <CardTitle>Tournament Info</CardTitle>
                </CardHeader>
                <CardContent className="p-4 md:p-6">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <div className="flex justify-between sm:flex-col sm:gap-1">
                      <span className="text-muted-foreground">Start Time</span>
                      <span className="font-medium text-foreground text-right sm:text-left">
                        {new Date(tournament.startDateTime).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between sm:flex-col sm:gap-1">
                      <span className="text-muted-foreground">Buy-in</span>
                      <span className="font-medium text-foreground text-right sm:text-left">${tournament.buyInAmount}</span>
                    </div>
                    {tournament.rebuyAmount && (
                      <div className="flex justify-between sm:flex-col sm:gap-1">
                        <span className="text-muted-foreground">Re-buy</span>
                        <span className="font-medium text-foreground text-right sm:text-left">${tournament.rebuyAmount}</span>
                      </div>
                    )}
                    {tournament.addonAmount && (
                      <div className="flex justify-between sm:flex-col sm:gap-1">
                        <span className="text-muted-foreground">Add-on</span>
                        <span className="font-medium text-foreground text-right sm:text-left">${tournament.addonAmount}</span>
                      </div>
                    )}
                    <div className="flex justify-between sm:flex-col sm:gap-1">
                      <span className="text-muted-foreground">Max Players</span>
                      <span className="font-medium text-foreground text-right sm:text-left">{tournament.maxPlayers}</span>
                    </div>
                    {tournament.enableHighHand && tournament.highHandAmount && (
                      <div className="flex justify-between sm:flex-col sm:gap-1">
                        <span className="text-muted-foreground">High Hand Pool</span>
                        <span className="font-medium text-foreground text-right sm:text-left">${tournament.highHandAmount}</span>
                      </div>
                    )}
                  </div>
                  {tournament.description && (
                    <div className="pt-3 mt-3 border-t border-border">
                      <span className="text-muted-foreground block mb-2 text-sm">Description</span>
                      <span className="font-medium text-foreground text-sm">{tournament.description}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
              </div>
            </TabsContent>

            <TabsContent value="standings" className="mt-0">
              <StandingsTable
                tournamentId={tournament.id}
                registrations={registrations}
                isLoading={registrationsLoading}
              />
            </TabsContent>

            <TabsContent value="activity" className="mt-0">
              <ActivityFeed tournamentId={tournament.id} />
            </TabsContent>

            <TabsContent value="actions" className="mt-0">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
                <Link href={`/tournaments/${tournament.id}/actions`} className="block">
                  <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
                    <CardContent className="p-4 md:p-6">
                      <div className="flex items-center gap-3">
                        <div className="shrink-0">
                          <FolderSync className="w-6 h-6 md:w-8 md:h-8 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-semibold text-sm md:text-base">Player Actions</h3>
                          <p className="text-xs md:text-sm text-muted-foreground">Rebuy, addon, knockout registration</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>

                <Link href={`/admin/actions/${tournament.id}`} className="block">
                  <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
                    <CardContent className="p-4 md:p-6">
                      <div className="flex items-center gap-3">
                        <div className="shrink-0">
                          <CheckCircle2 className="w-6 h-6 md:w-8 md:h-8 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-semibold text-sm md:text-base">Confirm Actions</h3>
                          <p className="text-xs md:text-sm text-muted-foreground">Review and approve pending actions</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>

                {tournament.enableHighHand && (
                  <Card
                    className="transition-colors h-full hover:bg-muted/50 cursor-pointer"
                    onClick={() => setHighHandModalOpen(true)}
                  >
                    <CardContent className="p-4 md:p-6">
                      <div className="flex items-center gap-3">
                        <div className="shrink-0">
                          <Trophy className="w-6 h-6 md:w-8 md:h-8 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-semibold text-sm md:text-base">Award High Hand</h3>
                          <p className="text-xs md:text-sm text-muted-foreground">
                            Assign high hand winner
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                <Card
                  className={`transition-colors h-full ${
                    tournament.prizePoolLocked ? 'opacity-50' : 'hover:bg-muted/50 cursor-pointer'
                  }`}
                  onClick={() => !tournament.prizePoolLocked && lockPrizePoolMutation.mutate()}
                >
                  <CardContent className="p-4 md:p-6">
                    <div className="flex items-center gap-3">
                      <div className="shrink-0">
                        {tournament.prizePoolLocked ? (
                          <Lock className="w-6 h-6 md:w-8 md:h-8 text-primary" />
                        ) : (
                          <Unlock className="w-6 h-6 md:w-8 md:h-8 text-primary" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-sm md:text-base">
                          {tournament.prizePoolLocked ? "Prize Pool Locked" : "Lock Prize Pool"}
                        </h3>
                        <p className="text-xs md:text-sm text-muted-foreground">
                          {tournament.prizePoolLocked ? "No further changes allowed" : "Finalize registrations"}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Link href={`/admin/registrations/${tournament.id}`} className="block">
                  <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
                    <CardContent className="p-4 md:p-6">
                      <div className="flex items-center gap-3">
                        <div className="shrink-0">
                          <UserPlus className="w-6 h-6 md:w-8 md:h-8 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-semibold text-sm md:text-base">Manage Registrations</h3>
                          <p className="text-xs md:text-sm text-muted-foreground">View and edit player registrations</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>

                <Link href={`/tournament/${tournament.id}`} className="block">
                  <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
                    <CardContent className="p-4 md:p-6">
                      <div className="flex items-center gap-3">
                        <div className="shrink-0">
                          <ExternalLink className="w-6 h-6 md:w-8 md:h-8 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-semibold text-sm md:text-base">Public View</h3>
                          <p className="text-xs md:text-sm text-muted-foreground">See the public tournament page</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>

                <Card
                  className="hover:bg-muted/50 transition-colors cursor-pointer h-full"
                  onClick={() => {
                    const url = `${window.location.origin}/tournaments/${tournament.id}/actions`;
                    navigator.clipboard.writeText(url);
                    toast({
                      title: "Link Copied!",
                      description: "Player actions link copied to clipboard",
                    });
                  }}
                >
                  <CardContent className="p-4 md:p-6">
                    <div className="flex items-center gap-3">
                      <div className="shrink-0">
                        <Download className="w-6 h-6 md:w-8 md:h-8 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-sm md:text-base">Copy Player Link</h3>
                        <p className="text-xs md:text-sm text-muted-foreground">Share actions page with players</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <RegisterPlayerModal
        open={showRegisterPlayer}
        onOpenChange={setShowRegisterPlayer}
        tournamentId={tournament.id}
      />

      <DeleteConfirmationDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        onConfirm={() => deleteTournamentMutation.mutate()}
        title="Delete Tournament"
        description="Are you sure you want to delete this tournament? This action cannot be undone and will remove all associated registrations and data."
        itemName={tournament.name}
        isDeleting={deleteTournamentMutation.isPending}
      />

      <AssignHighHandModal
        open={highHandModalOpen}
        onOpenChange={setHighHandModalOpen}
        tournamentId={tournament.id}
        registrations={registrations}
        defaultHighHandAmount={(() => {
          // Calculate high hand amount per winner
          const highHandEntrants = registrations.filter(r => r.enteringHighHands).length;
          const highHandGross = highHandEntrants * parseFloat(tournament.highHandAmount || '0');
          const highHandRakeAmount = tournament.highHandRakeType === 'percentage'
            ? highHandGross * (parseFloat(tournament.highHandRakeAmount || '0') / 100)
            : parseFloat(tournament.highHandRakeAmount || '0');
          const highHandNet = highHandGross - highHandRakeAmount;
          const highHandPerWinner = tournament.highHandPayouts && tournament.highHandPayouts > 0
            ? highHandNet / tournament.highHandPayouts
            : highHandNet;
          return highHandPerWinner.toFixed(2);
        })()}
      />
    </>
  );
}
