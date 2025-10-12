import { useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { CheckCircle2, Clock, ShoppingCart, RefreshCw, Skull, Check } from "lucide-react";
import type { Tournament } from "@shared/schema";

interface PendingAction {
  id: string;
  tournamentId: string;
  playerId: string;
  actionType: "rebuy" | "addon" | "knockout";
  targetPlayerId?: string; // For knockouts
  timestamp: string;
  player: {
    id: string;
    name: string;
  };
  targetPlayer?: {
    id: string;
    name: string;
  };
  amount?: number;
}

export function AdminActionsPage() {
  const { tournamentId } = useParams<{ tournamentId: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: tournament, isLoading: tournamentLoading } = useQuery<Tournament>({
    queryKey: [`/api/tournaments/${tournamentId}`],
  });

  const { data: pendingActions = [] } = useQuery<PendingAction[]>({
    queryKey: [`/api/tournaments/${tournamentId}/pending-actions`],
    refetchInterval: 3000,
  });

  const confirmActionMutation = useMutation({
    mutationFn: async ({ actionId, action }: { actionId: string; action: PendingAction }) => {
      // Find the registration for this player
      const registrationsResponse = await apiRequest("GET", `/api/tournaments/${tournamentId}/registrations`);
      const registrations = await registrationsResponse.json();
      const registration = registrations.find((r: any) => r.playerId === action.playerId);

      if (!registration) {
        throw new Error("Registration not found");
      }

      if (action.actionType === "rebuy") {
        await apiRequest("PATCH", `/api/registrations/${registration.id}`, {
          rebuys: (registration.rebuys || 0) + 1,
        });
      } else if (action.actionType === "addon") {
        await apiRequest("PATCH", `/api/registrations/${registration.id}`, {
          addons: (registration.addons || 0) + 1,
        });
      } else if (action.actionType === "knockout" && action.targetPlayerId) {
        const targetRegistration = registrations.find((r: any) => r.playerId === action.targetPlayerId);
        if (targetRegistration) {
          try {
            // Eliminate the target player and record who knocked them out
            await apiRequest("PUT", `/api/registrations/${targetRegistration.id}`, {
              isEliminated: true,
              eliminationTime: new Date().toISOString(),
              eliminatedBy: action.playerId,
            });

            // Increment knockout count for the player who made the knockout
            await apiRequest("PUT", `/api/registrations/${registration.id}`, {
              knockouts: ((registration as any).knockouts || 0) + 1,
            });
          } catch (error) {
            console.error('Knockout confirmation error:', error);
            throw error;
          }
        }
      }

      // Delete the pending action
      await apiRequest("DELETE", `/api/pending-actions/${actionId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/pending-actions`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/registrations`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/activity`] });
      toast({
        title: "Action Confirmed",
        description: "Player action has been confirmed.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to confirm action. Please try again.",
        variant: "destructive",
      });
    },
  });

  if (tournamentLoading) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">Loading tournament...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!tournament) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-destructive">Tournament not found</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const getActionIcon = (actionType: string) => {
    switch (actionType) {
      case "rebuy":
        return <RefreshCw className="w-4 h-4" />;
      case "addon":
        return <ShoppingCart className="w-4 h-4" />;
      case "knockout":
        return <Skull className="w-4 h-4" />;
      default:
        return null;
    }
  };

  const getActionAmount = (action: PendingAction) => {
    if (action.actionType === "rebuy") return tournament.rebuyAmount;
    if (action.actionType === "addon") return tournament.addonAmount;
    return null;
  };

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-4 md:space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold mb-2">{tournament.name}</h1>
        <p className="text-sm md:text-base text-muted-foreground">Player Actions Confirmation</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg md:text-xl">
                <Clock className="w-4 h-4 md:w-5 md:h-5" />
                Pending Actions
              </CardTitle>
              <CardDescription className="text-xs md:text-sm">Actions waiting for payment confirmation</CardDescription>
            </div>
            <Badge variant="secondary" className="text-base md:text-lg px-3 md:px-4 py-1">
              {pendingActions.length}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {pendingActions.length === 0 ? (
            <div className="text-center py-12">
              <CheckCircle2 className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No pending actions</p>
            </div>
          ) : (
            <>
              {/* Desktop table view */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Player</TableHead>
                      <TableHead>Details</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingActions.map((action) => (
                      <TableRow key={action.id}>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(action.timestamp).toLocaleTimeString()}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {getActionIcon(action.actionType)}
                            <span className="capitalize">{action.actionType}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="font-medium">{action.player.name}</p>
                            {action.actionType === "knockout" && action.targetPlayer && (
                              <p className="text-xs text-muted-foreground">Knockout by</p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          {action.actionType === "knockout" && action.targetPlayer ? (
                            <div>
                              <p className="font-medium text-destructive">{action.targetPlayer.name}</p>
                              <p className="text-xs text-muted-foreground">Knocked out</p>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {getActionAmount(action) && (
                            <span className="font-semibold">${getActionAmount(action)}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            onClick={() => confirmActionMutation.mutate({ actionId: action.id, action })}
                            disabled={confirmActionMutation.isPending}
                          >
                            <Check className="w-4 h-4 mr-2" />
                            Confirm
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile card view */}
              <div className="md:hidden space-y-3">
                {pendingActions.map((action) => (
                  <Card key={action.id} className="border-2">
                    <CardContent className="p-4">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {getActionIcon(action.actionType)}
                            <span className="font-semibold capitalize">{action.actionType}</span>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {new Date(action.timestamp).toLocaleTimeString()}
                          </span>
                        </div>

                        <div>
                          <p className="text-sm text-muted-foreground">
                            {action.actionType === "knockout" ? "Knockout by" : "Player"}
                          </p>
                          <p className="font-medium">{action.player.name}</p>
                        </div>

                        {action.actionType === "knockout" && action.targetPlayer && (
                          <div>
                            <p className="text-sm text-muted-foreground">Knocked Out</p>
                            <p className="font-medium text-destructive">{action.targetPlayer.name}</p>
                          </div>
                        )}

                        {getActionAmount(action) && (
                          <div>
                            <p className="text-sm text-muted-foreground">Amount</p>
                            <p className="text-lg font-bold">${getActionAmount(action)}</p>
                          </div>
                        )}

                        <Button
                          className="w-full"
                          onClick={() => confirmActionMutation.mutate({ actionId: action.id, action })}
                          disabled={confirmActionMutation.isPending}
                        >
                          <Check className="w-4 h-4 mr-2" />
                          Confirm Payment
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
