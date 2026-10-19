import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EliminatePlayerModal } from "@/components/modals/eliminate-player-modal";
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Edit, RotateCcw, Trash2, Users } from "lucide-react";
import { formatMoney, toCents } from "@shared/domain/money";
import { registrationRemovalProblem } from "@shared/domain/standings";

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
  eliminatedBy?: string | null;
  knockouts?: number | null;
  highHandWinner?: boolean | null;
  player: {
    id: string;
    name: string;
    email?: string;
  } | null;
}

interface StandingsTableProps {
  tournamentId: string;
  registrations: TournamentRegistration[];
  isLoading: boolean;
  /** Eliminate, restore and remove are for the club's staff (viewer.canManage). */
  canManage?: boolean;
  /** Completed or cancelled: the standings can no longer change here (a finished one is fixed with Correct Results). */
  closed?: boolean;
  completed?: boolean;
}


export function StandingsTable({
  tournamentId,
  registrations,
  isLoading,
  canManage = false,
  closed = false,
  completed = false,
}: StandingsTableProps) {
  const { toast } = useToast();
  const [eliminateModalOpen, setEliminateModalOpen] = useState(false);
  const [selectedRegistration, setSelectedRegistration] = useState<TournamentRegistration | null>(null);
  const [toRemove, setToRemove] = useState<TournamentRegistration | null>(null);

  // A mis-tapped or fake sign-up comes out again; the server keeps the whole entry in the audit log (P2REV0-02).
  const removeRegistrationMutation = useMutation({
    mutationFn: async (registrationId: string) => {
      await apiRequest("DELETE", `/api/registrations/${registrationId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tournaments", tournamentId, "registrations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tournaments", tournamentId, "activity"] });
      setToRemove(null);
      toast({ title: "Entry removed", description: "The player is no longer registered for this tournament" });
    },
    onError: (error: any) => {
      setToRemove(null);
      toast({
        title: "Error",
        description: error.message || "Failed to remove the entry",
        variant: "destructive",
      });
    },
  });

  const restorePlayerMutation = useMutation({
    mutationFn: async (registrationId: string) => {
      // The server clears the elimination time and takes the knockout back off the eliminator.
      const response = await apiRequest("PUT", `/api/registrations/${registrationId}`, {
        isEliminated: false,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tournaments", tournamentId, "registrations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tournaments", tournamentId, "activity"] });
      toast({
        title: "Success",
        description: "Player restored successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to restore player",
        variant: "destructive",
      });
    },
  });

  const handleEliminate = (registration: TournamentRegistration) => {
    setSelectedRegistration(registration);
    setEliminateModalOpen(true);
  };

  const handleRestore = (registrationId: string) => {
    restorePlayerMutation.mutate(registrationId);
  };

  const getPlayerInitials = (name: string) => {
    return name
      .split(' ')
      .map(word => word[0])
      .join('')
      .toUpperCase()
      .substring(0, 2);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <div className="animate-pulse space-y-3">
            <div className="h-6 bg-muted rounded w-48"></div>
            <div className="h-4 bg-muted rounded w-64"></div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-16 bg-muted rounded animate-pulse"></div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Once finalized, players are in their finishing order: finalize places the players still in without
  // eliminating them, so they would otherwise stay in registration order. Before that, active players
  // first, then the eliminated, most recently eliminated first.
  const sortedRegistrations = [...registrations].sort((a, b) => {
    if (a.finalPosition && b.finalPosition) return a.finalPosition - b.finalPosition;
    if (a.finalPosition) return -1;
    if (b.finalPosition) return 1;

    // Active players come first
    if (a.isEliminated && !b.isEliminated) return 1;
    if (!a.isEliminated && b.isEliminated) return -1;

    // Both eliminated: sort by elimination time (most recent first = higher position)
    if (a.isEliminated && b.isEliminated) {
      if (!a.eliminationTime) return 1;
      if (!b.eliminationTime) return -1;
      return new Date(b.eliminationTime).getTime() - new Date(a.eliminationTime).getTime();
    }

    // Both active: keep original order
    return 0;
  });

  return (
    <Card>
      <CardHeader className="border-b border-border">
        <CardTitle>{closed ? "Final Standings" : "Current Standings"}</CardTitle>
        <p className="text-sm text-muted-foreground mt-1" data-testid="standings-note">
          {completed && canManage
            ? "This tournament is finalized: to change who finished where, use Correct Results."
            : closed
              ? "This tournament is closed."
              : "Live player rankings and eliminations"}
        </p>
      </CardHeader>
      <CardContent className="p-0">
        {registrations.length === 0 ? (
          <div className="p-8 text-center">
            <Users className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No Players Registered</h3>
            <p className="text-sm text-muted-foreground">
              Players will appear here once they register for the tournament.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left py-3 px-6 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Place</th>
                  <th className="text-left py-3 px-6 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Player</th>
                  <th className="text-left py-3 px-6 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                  <th className="text-left py-3 px-6 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Entry</th>
                  <th className="text-left py-3 px-6 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Points</th>
                  <th className="text-left py-3 px-6 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Prize</th>
                  <th className="text-right py-3 px-6 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sortedRegistrations.map((registration, index) => {
                  const position = registration.finalPosition ?? index + 1;
                  const isFirst = position === 1 && (registration.finalPosition != null || !registration.isEliminated);
                  
                  return (
                    <tr 
                      key={registration.id} 
                      className={`hover:bg-muted/20 transition-colors ${registration.isEliminated ? 'bg-muted/10' : ''}`}
                      data-testid={`player-row-${registration.id}`}
                    >
                      <td className="py-4 px-6">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                          isFirst ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground'
                        }`}>
                          {position}
                        </div>
                      </td>
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white text-sm font-semibold">
                            {registration.player ? getPlayerInitials(registration.player.name) : '??'}
                          </div>
                          <div>
                            <p className={`font-medium ${registration.isEliminated ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                              {registration.player?.name || 'Unknown Player'}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Buy-in: {registration.buyIns}
                              {registration.rebuys > 0 && ` + ${registration.rebuys} Re-buy${registration.rebuys > 1 ? 's' : ''}`}
                              {registration.addons > 0 && ` + ${registration.addons} Add-on${registration.addons > 1 ? 's' : ''}`}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-6">
                        <Badge className={registration.isEliminated ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}>
                          <span className="w-1.5 h-1.5 bg-current rounded-full mr-1.5"></span>
                          {registration.isEliminated ? 'Eliminated' : 'Active'}
                        </Badge>
                      </td>
                      <td className="py-4 px-6">
                        <span className="text-sm text-muted-foreground">
                          {registration.buyIns + registration.rebuys + registration.addons} entries
                        </span>
                      </td>
                      <td className="py-4 px-6">
                        <span className="text-sm font-semibold text-foreground">
                          {registration.pointsAwarded || 0}
                        </span>
                      </td>
                      <td className="py-4 px-6">
                        <span className={`text-sm font-semibold ${registration.prizeAmount ? 'text-accent' : 'text-muted-foreground'}`}>
                          {registration.prizeAmount ? formatMoney(toCents(registration.prizeAmount)) : '-'}
                        </span>
                      </td>
                      <td className="py-4 px-6">
                        {canManage && !closed && (
                          <div className="flex items-center justify-end gap-2">
                            <Button variant="ghost" size="sm" data-testid={`edit-player-${registration.id}`}>
                              <Edit className="w-4 h-4 mr-1" />
                              Edit
                            </Button>
                            {registration.isEliminated ? (
                              <Button 
                                variant="ghost" 
                                size="sm"
                                onClick={() => handleRestore(registration.id)}
                                disabled={restorePlayerMutation.isPending}
                                data-testid={`restore-player-${registration.id}`}
                              >
                                <RotateCcw className="w-4 h-4 mr-1" />
                                Restore
                              </Button>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleEliminate(registration)}
                                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                data-testid={`eliminate-player-${registration.id}`}
                              >
                                Eliminate
                              </Button>
                            )}
                            {/* An entry nothing has happened to yet: the server's own rule (CQ-P2-03). */}
                            {registrationRemovalProblem(registration, registrations) === null && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setToRemove(registration)}
                                disabled={removeRegistrationMutation.isPending}
                                aria-label={`Remove ${registration.player?.name ?? "this player"}'s entry`}
                                data-testid={`remove-registration-${registration.id}`}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      <DeleteConfirmationDialog
        open={toRemove !== null}
        onOpenChange={(open) => !open && setToRemove(null)}
        onConfirm={() => toRemove && removeRegistrationMutation.mutate(toRemove.id)}
        title="Remove this entry?"
        description="Use this for a sign-up that should not be here, such as the wrong player or someone who is not playing. Their requests waiting for confirmation are removed too."
        itemName={toRemove?.player?.name}
        isDeleting={removeRegistrationMutation.isPending}
      />

      {selectedRegistration && (
        <EliminatePlayerModal
          open={eliminateModalOpen}
          onOpenChange={setEliminateModalOpen}
          registration={selectedRegistration}
          tournamentId={tournamentId}
          allRegistrations={registrations}
        />
      )}
    </Card>
  );
}
