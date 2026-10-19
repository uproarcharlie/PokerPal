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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CorrectResultsDialog, FinalizeDialog } from "@/components/tournament/finalize-dialog";
import { LIVE_REFRESH_MS } from "@/lib/live-refresh";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ordinal, tournamentMoney } from "@/lib/prize-pool";
import { useToast } from "@/hooks/use-toast";
import { centsToDollars, formatMoney, toCents } from "@shared/domain/money";
import { nextHighHandAward, paidPercentage, rakeLabel } from "@shared/domain/prize-pool";
import type { Viewer } from "@shared/api/common";
import type { PendingActionDto } from "@shared/api/pending-actions";
import type { PrizePoolSnapshot } from "@shared/api/finalize";
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

/** How often the count of player requests still waiting is refreshed. */
const WAITING_REQUESTS_REFRESH_MS = 15_000;

const isClosedStatus = (status: string | undefined) => status === "completed" || status === "cancelled";

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
  rebuyRakeType: string | null;
  rebuyRakeAmount: string | null;
  addonRakeType: string | null;
  addonRakeAmount: string | null;
  payoutStructure: string;
  customPayouts?: string | null;
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
  manualPrizePool?: string | null;
  rakeOverride?: string | null;
  prizePoolSnapshot?: PrizePoolSnapshot | null;
  createdAt: string;
  viewer?: Viewer;
}

interface Club {
  id: string;
  name: string;
  rakeLabel?: string | null;
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
  const [showFinalizeDialog, setShowFinalizeDialog] = useState(false);
  const [showCorrectResults, setShowCorrectResults] = useState(false);
  const [highHandModalOpen, setHighHandModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const [editingPrizePool, setEditingPrizePool] = useState(false);
  const [manualPrizePool, setManualPrizePool] = useState("");
  const [editingMaxPlayers, setEditingMaxPlayers] = useState(false);
  const [maxPlayersInput, setMaxPlayersInput] = useState("");
  const [confirmLock, setConfirmLock] = useState<"lock" | "unlock" | null>(null);
  
  // Polled while the tournament runs, like the public page: QR sign-ups and requests confirmed on another
  // device change the pool, and what the TD reads out must be what the server pays (P2REV1-MONEY-01).
  const { data: tournament, isLoading: tournamentLoading } = useQuery<Tournament>({
    queryKey: ["/api/tournaments", id],
    refetchInterval: (query) => (isClosedStatus(query.state.data?.status) ? false : LIVE_REFRESH_MS),
  });
  const live = tournament !== undefined && !isClosedStatus(tournament.status);

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
    refetchInterval: live ? LIVE_REFRESH_MS : false,
  });

  // Player requests still waiting (staff only): ending the tournament discards them, so the page says how many.
  const runsOpenTournament =
    tournament?.viewer?.canManage === true && tournament.status !== "completed" && tournament.status !== "cancelled";
  const { data: waitingRequests = [] } = useQuery<PendingActionDto[]>({
    queryKey: ["/api/tournaments", id, "pending-actions"],
    enabled: !!id && runsOpenTournament,
    refetchInterval: WAITING_REQUESTS_REFRESH_MS,
    staleTime: 0,
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
    mutationFn: async (locked: boolean) => {
      const response = await apiRequest("PUT", `/api/tournaments/${id}`, { prizePoolLocked: locked });
      return response.json();
    },
    onSuccess: (_data, locked) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tournaments", id] });
      setConfirmLock(null);
      toast(
        locked
          ? { title: "Prize Pool Locked", description: "No further registrations, rebuys, or addons will be allowed" }
          : { title: "Prize Pool Unlocked", description: "Registrations, rebuys and addons are open again" },
      );
    },
    onError: (error: any) => {
      setConfirmLock(null);
      toast({
        title: "Error",
        description: error.message || "Failed to change the prize pool lock",
        variant: "destructive",
      });
    },
  });

  // Staff are not held to maxPlayers, but QR sign-ups are: raising it lets more players sign themselves up (TN2-03).
  const updateMaxPlayersMutation = useMutation({
    mutationFn: async (maxPlayers: number) => {
      const response = await apiRequest("PUT", `/api/tournaments/${id}`, { maxPlayers });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tournaments", id] });
      setEditingMaxPlayers(false);
      toast({ title: "Success", description: "Max players updated" });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update max players",
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
  // The same shared functions finalize pays with: what the TD sees here is what is paid.
  const { breakdown, display, poolCents } = tournamentMoney(tournament, registrations);
  const { buyIns: totalBuyIns, rebuys: totalRebuys, addons: totalAddons } = breakdown.counts;
  const prizePayouts = display.rows;
  const label = rakeLabel(club);
  const canManage = tournament.viewer?.canManage === true;
  // Deleting is for the club's owner or an admin; a manager cancels instead (TN-09).
  const canDelete = tournament.viewer?.canOwn === true;
  const closed = tournament.status === "completed" || tournament.status === "cancelled";
  const paidShare = paidPercentage(prizePayouts);
  // What the next high-hand winner is awarded, or null once every prize is: the server works it out the same way (MONEY-36).
  const highHandAwards = registrations.filter((r) => r.highHandWinner).map((r) => toCents(r.highHandAmount));
  const nextHighHand = nextHighHandAward(breakdown.highHand, highHandAwards);
  // A finalized tournament's whole finishing order, for correcting it (D19).
  const finishers = registrations
    .filter((r) => r.finalPosition != null)
    .sort((a, b) => (a.finalPosition ?? 0) - (b.finalPosition ?? 0))
    .map((r) => ({ registrationId: r.id, playerName: r.player?.name ?? "Unknown player" }));

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

  const canStart = canManage && tournament.status === 'registration' && totalPlayers >= tournament.minPlayers;
  const canPause = canManage && tournament.status === 'in_progress';
  const canEnd = canManage && tournament.status === 'in_progress';
  const canEditPrizePool =
    canManage && !tournament.prizePoolLocked && tournament.status !== 'completed' && tournament.status !== 'cancelled';

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
                   tournament.status === 'completed' ? 'Completed' :
                   tournament.status === 'cancelled' ? 'Cancelled' : 'Scheduled'}
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
                {canManage && !closed && (
                  <Button variant="outline" size="sm" onClick={() => setShowRegisterPlayer(true)} data-testid="register-player">
                    <UserPlus className="w-4 h-4 mr-2" />
                    Register Player
                  </Button>
                )}
                {canDelete && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowDeleteDialog(true)}
                    className="text-destructive hover:text-destructive hover:bg-destructive/10 hidden md:flex"
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete
                  </Button>
                )}
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
                    onClick={() => setShowFinalizeDialog(true)}
                    data-testid="end-tournament"
                  >
                    <Square className="w-4 h-4 mr-2" />
                    End Tournament
                    {waitingRequests.length > 0 && (
                      <Badge variant="secondary" className="ml-2" data-testid="end-tournament-waiting">
                        {waitingRequests.length} waiting
                      </Badge>
                    )}
                  </Button>
                )}
                {canManage && tournament.status === "completed" && finishers.length > 0 && (
                  <Button variant="outline" onClick={() => setShowCorrectResults(true)} data-testid="correct-results">
                    Correct Results
                  </Button>
                )}
              </div>
            </div>

            {/* Tournament Stats */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 md:gap-4">
              <div className="bg-muted/30 rounded-lg p-3 md:p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                  Players
                  {canManage && !closed && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 px-2 ml-2"
                      data-testid="edit-max-players"
                      onClick={() => {
                        setEditingMaxPlayers(!editingMaxPlayers);
                        setMaxPlayersInput(String(tournament.maxPlayers));
                      }}
                    >
                      {editingMaxPlayers ? "Cancel" : "Edit"}
                    </Button>
                  )}
                </p>
                {editingMaxPlayers && canManage && !closed ? (
                  <div className="flex gap-2 items-center">
                    <span className="text-sm text-muted-foreground">{totalPlayers}/</span>
                    <Input
                      type="number"
                      min={Math.max(2, totalPlayers)}
                      max={1000}
                      value={maxPlayersInput}
                      onChange={(e) => setMaxPlayersInput(e.target.value)}
                      className="h-8 text-sm"
                      aria-label="Max players"
                      data-testid="max-players-input"
                    />
                    <Button
                      size="sm"
                      className="h-8"
                      disabled={updateMaxPlayersMutation.isPending || !/^\d+$/.test(maxPlayersInput)}
                      onClick={() => updateMaxPlayersMutation.mutate(Number(maxPlayersInput))}
                      data-testid="save-max-players"
                    >
                      Save
                    </Button>
                  </div>
                ) : (
                  <p className="text-xl md:text-2xl font-bold text-foreground" data-testid="players-count">
                    {totalPlayers}/{tournament.maxPlayers}
                  </p>
                )}
              </div>
              <div className="bg-muted/30 rounded-lg p-3 md:p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                  Prize Pool
                  {canEditPrizePool && (
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
                {editingPrizePool && canEditPrizePool ? (
                  <div className="flex gap-2 items-center">
                    <Input
                      type="number"
                      value={manualPrizePool}
                      onChange={(e) => setManualPrizePool(e.target.value)}
                      placeholder={Math.round(centsToDollars(breakdown.netAfterAp)).toString()}
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
                    {formatMoney(poolCents)}
                    {display.source === "live" && breakdown.netSource === "manual_pool" && (
                      <span className="text-xs text-muted-foreground ml-2">(manual)</span>
                    )}
                    {display.source === "live" && breakdown.netSource === "ap_override" && (
                      <span className="text-xs text-muted-foreground ml-2">(manual {label})</span>
                    )}
                    {(display.source === "snapshot" || display.source === "stored") && (
                      <span className="text-xs text-muted-foreground ml-2">(paid)</span>
                    )}
                    {display.source === "unrecorded" && (
                      <span className="text-xs text-muted-foreground ml-2">(estimated: prizes not recorded)</span>
                    )}
                    {display.source === "cancelled" && (
                      <span className="text-xs text-muted-foreground ml-2">(cancelled: no prizes)</span>
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
                  <p className="text-sm text-muted-foreground">
                    {display.source === "live"
                      ? "Payout distribution for top finishers"
                      : display.source === "unrecorded"
                        ? "Prizes were not recorded for this tournament"
                        : display.source === "cancelled"
                          ? "Cancelled: no prizes are paid"
                          : "What was paid out"}
                  </p>
                </CardHeader>
                <CardContent className="p-6">
                  {prizePayouts.length > 0 ? (
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
                                {ordinal(payout.position)} Place
                              </span>
                              <Trophy className={`w-5 h-5 ${index === 0 ? 'text-accent' : 'text-muted-foreground'}`} />
                            </div>
                            <p className="text-3xl font-bold text-foreground" data-testid={`payout-${payout.position}`}>
                              {formatMoney(payout.amountCents)}
                            </p>
                            {payout.percentage !== null && (
                              <p className="text-xs text-muted-foreground mt-1">{payout.percentage}% of prize pool</p>
                            )}
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
                                         ordinal(payout.position)}
                                      </span>
                                    </td>
                                    <td className="py-3 px-3 text-right text-sm text-muted-foreground">
                                      {payout.percentage !== null ? `${payout.percentage}%` : '-'}
                                    </td>
                                    <td className="py-3 px-3 text-right">
                                      <span className="font-bold text-foreground">
                                        {formatMoney(payout.amountCents)}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot>
                                <tr className="border-t-2 border-border font-bold">
                                  <td className="py-3 px-3 text-foreground">Total</td>
                                  <td className="py-3 px-3 text-right text-muted-foreground">
                                    {paidShare !== null ? `${paidShare}%` : ""}
                                  </td>
                                  <td className="py-3 px-3 text-right text-primary text-lg">
                                    {formatMoney(display.totalCents)}
                                  </td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                        </div>
                      )}

                      {display.undistributedCents > 0 && (
                        <Alert className="mt-4" data-testid="undistributed">
                          <AlertDescription>
                            {display.source === "live"
                              ? `Only ${totalPlayers} ${totalPlayers === 1 ? "player" : "players"}: ${formatMoney(display.undistributedCents)} of the pool is not paid out unless more players enter.`
                              : `${formatMoney(display.undistributedCents)} of the pool was not paid out: there were fewer players than paid places.`}
                          </AlertDescription>
                        </Alert>
                      )}

                      {tournament.enableHighHand && tournament.highHandAmount && (
                        <div className="mt-4 pt-4 border-t border-border flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-foreground">High Hand Bonus</p>
                            <p className="text-xs text-muted-foreground">Additional prize for highest hand</p>
                          </div>
                          <p className="text-xl font-bold text-accent">
                            {formatMoney(toCents(tournament.highHandAmount))}
                          </p>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-center py-8">
                      <Trophy className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                      <p className="text-sm text-muted-foreground" data-testid="no-payouts">
                        {display.source === "unrecorded"
                          ? "This tournament's results were entered by hand, so what each place was paid was never recorded."
                          : display.source === "cancelled"
                            ? "This tournament was cancelled, so no prizes are paid."
                            : "Prize pool will be calculated once players register"}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Prize Pool Calculator */}
              <PrizePoolCalculator
                tournament={tournament}
                breakdown={breakdown}
                display={display}
                rakeLabel={label}
                highHandAwardsCents={highHandAwards}
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
                canManage={canManage}
                closed={closed}
                completed={tournament.status === "completed"}
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
                          <p
                            className={`text-xs md:text-sm ${waitingRequests.length > 0 ? "font-semibold text-destructive" : "text-muted-foreground"}`}
                            data-testid="waiting-requests"
                          >
                            {waitingRequests.length > 0
                              ? `${waitingRequests.length} player request${waitingRequests.length === 1 ? "" : "s"} waiting`
                              : "Review and approve pending actions"}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>

                {canManage && tournament.enableHighHand && (
                  <Card
                    className="transition-colors h-full hover:bg-muted/50 cursor-pointer"
                    onClick={() => {
                      // The award is worked out from the pot as it is now: fetch it before showing the amount.
                      queryClient.invalidateQueries({ queryKey: ["/api/tournaments", id, "registrations"] });
                      queryClient.invalidateQueries({ queryKey: ["/api/tournaments", id], exact: true });
                      setHighHandModalOpen(true);
                    }}
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

                {/* A finished tournament's pool settings are frozen, so the lock is offered only while it is open. */}
                {canManage && !closed && (
                  <Card
                    className="transition-colors h-full hover:bg-muted/50 cursor-pointer"
                    onClick={() => setConfirmLock(tournament.prizePoolLocked ? "unlock" : "lock")}
                    data-testid="prize-pool-lock-card"
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
                            {tournament.prizePoolLocked ? "Tap to unlock" : "Finalize registrations"}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

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

      <AlertDialog open={confirmLock !== null} onOpenChange={(open) => !open && setConfirmLock(null)}>
        <AlertDialogContent data-testid="confirm-lock">
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmLock === "unlock" ? "Unlock the prize pool?" : "Lock the prize pool?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmLock === "unlock"
                ? "Players can sign up, and re-buys and add-ons can be added, again until you lock it."
                : "No new sign-ups, re-buys or add-ons after this. Re-buy and add-on requests players sent before the lock can still be confirmed."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={lockPrizePoolMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={lockPrizePoolMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                lockPrizePoolMutation.mutate(confirmLock !== "unlock");
              }}
              data-testid="confirm-lock-action"
            >
              {confirmLock === "unlock" ? "Unlock" : "Lock"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <FinalizeDialog open={showFinalizeDialog} onOpenChange={setShowFinalizeDialog} tournamentId={tournament.id} />

      <CorrectResultsDialog
        open={showCorrectResults}
        onOpenChange={setShowCorrectResults}
        tournamentId={tournament.id}
        finishers={finishers}
      />

      <AssignHighHandModal
        open={highHandModalOpen}
        onOpenChange={setHighHandModalOpen}
        tournamentId={tournament.id}
        registrations={registrations}
        nextAwardCents={nextHighHand}
      />
    </>
  );
}
