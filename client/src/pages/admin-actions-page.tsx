import { useState } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiJson, isApiRequestError } from "@/lib/queryClient";
import { AccessDenied } from "@/components/auth/access-denied";
import { CheckCircle2, Clock, ShoppingCart, RefreshCw, Skull, Check, X } from "lucide-react";
import type { Tournament } from "@shared/schema";
import type { Viewer } from "@shared/api/common";
import type {
  ConfirmPendingActionInput,
  ConfirmPendingActionResponse,
  PendingActionDto,
  RebuyBeforeEliminationDetails,
} from "@shared/api/pending-actions";

/** A confirmation the server sent back for the TD to decide: a re-buy asked for before the player went out. */
interface ReentryQuestion {
  actionId: string;
  details: RebuyBeforeEliminationDetails;
}

const timeOf = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null);

export function AdminActionsPage() {
  const { tournamentId } = useParams<{ tournamentId: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: tournament, isLoading: tournamentLoading } = useQuery<Tournament & { viewer?: Viewer }>({
    queryKey: [`/api/tournaments/${tournamentId}`],
  });
  const canManage = tournament?.viewer?.canManage === true;

  const { data: pendingActions = [] } = useQuery<PendingActionDto[]>({
    queryKey: [`/api/tournaments/${tournamentId}/pending-actions`],
    refetchInterval: 3000,
    enabled: canManage,
  });

  // Why the server last refused to confirm each request: shown beside it until it is confirmed or dismissed.
  const [refusals, setRefusals] = useState<Record<string, string>>({});
  const forget = (actionId: string) =>
    setRefusals(({ [actionId]: _gone, ...rest }) => rest);

  // A re-buy asked for before the player went out: the TD says whether it puts them back in (TN-RV2-01).
  const [reentryQuestion, setReentryQuestion] = useState<ReentryQuestion | null>(null);

  // One call: the server applies the action and removes it in one transaction, exactly once.
  const confirmActionMutation = useMutation({
    mutationFn: ({ actionId, reenter }: { actionId: string } & ConfirmPendingActionInput) =>
      apiJson<ConfirmPendingActionResponse>(
        "POST",
        `/api/pending-actions/${actionId}/confirm`,
        reenter === undefined ? undefined : { reenter },
      ),
    onSuccess: (data, { actionId }) => {
      forget(actionId);
      setReentryQuestion(null);
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/pending-actions`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/registrations`] });
      queryClient.invalidateQueries({ queryKey: ["/api/tournaments", tournamentId, "registrations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tournaments", tournamentId, "activity"] });
      toast({
        title: "Action Confirmed",
        description: data.reentered
          ? `${data.registration.player?.name ?? "The player"} is back in with the re-buy.`
          : "Player action has been confirmed.",
      });
    },
    onError: (error: Error, { actionId }) => {
      if (isApiRequestError(error) && error.code === "REBUY_BEFORE_ELIMINATION") {
        setReentryQuestion({ actionId, details: error.details as RebuyBeforeEliminationDetails });
        return;
      }
      setReentryQuestion(null);
      // A refused action stays pending, with the reason beside it, until it is dismissed; one already handled is gone.
      setRefusals((current) => ({ ...current, [actionId]: error.message || "The request could not be confirmed" }));
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/pending-actions`] });
      toast({
        title: "Could not confirm",
        description: error.message || "Failed to confirm action. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Takes a request off the list without applying it (TN2-02).
  const dismissActionMutation = useMutation({
    mutationFn: ({ actionId }: { actionId: string }) => apiJson<{ success: true }>("DELETE", `/api/pending-actions/${actionId}`),
    onSettled: (_data, _error, { actionId }) => {
      forget(actionId);
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/pending-actions`] });
    },
    onError: (error: Error) => {
      toast({ title: "Could not dismiss", description: error.message || "Please try again.", variant: "destructive" });
    },
  });
  const busy = confirmActionMutation.isPending || dismissActionMutation.isPending;

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

  if (!canManage) {
    return (
      <AccessDenied
        message="Only this club's owner, its managers and admins can confirm player actions."
        backHref="/tournaments"
        backLabel="Back to Tournaments"
      />
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

  const getActionAmount = (action: PendingActionDto) => {
    if (action.actionType === "rebuy") return tournament.rebuyAmount;
    if (action.actionType === "addon") return tournament.addonAmount;
    return null;
  };

  const question = reentryQuestion?.details;
  const askedAt = timeOf(question?.requestedAt ?? null);
  const outAt = timeOf(question?.eliminatedAt ?? null);

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-4 md:space-y-6">
      <AlertDialog open={reentryQuestion !== null} onOpenChange={(open) => !open && setReentryQuestion(null)}>
        <AlertDialogContent data-testid="reentry-question">
          <AlertDialogHeader>
            <AlertDialogTitle>Put {question?.playerName} back in?</AlertDialogTitle>
            <AlertDialogDescription>
              {question?.playerName} asked for this re-buy{askedAt ? ` at ${askedAt}` : ""} while still in, and was knocked out
              {outAt ? ` at ${outAt}` : " after that"}. If this re-buy is their buy-back, they go back in. If they had the chips
              before going out, it is only recorded and they stay out.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => reentryQuestion && confirmActionMutation.mutate({ actionId: reentryQuestion.actionId, reenter: false })}
              data-testid="reentry-record-only"
            >
              Record the re-buy only
            </Button>
            <Button
              disabled={busy}
              onClick={() => reentryQuestion && confirmActionMutation.mutate({ actionId: reentryQuestion.actionId, reenter: true })}
              data-testid="reentry-back-in"
            >
              Put them back in
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
                          {action.timestamp ? new Date(action.timestamp).toLocaleTimeString() : "-"}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {getActionIcon(action.actionType)}
                            <span className="capitalize">{action.actionType}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="font-medium">{action.player?.name ?? "Unknown player"}</p>
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
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              size="sm"
                              onClick={() => confirmActionMutation.mutate({ actionId: action.id })}
                              disabled={busy}
                            >
                              <Check className="w-4 h-4 mr-2" />
                              Confirm
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => dismissActionMutation.mutate({ actionId: action.id })}
                              disabled={busy}
                              data-testid={`dismiss-action-${action.id}`}
                            >
                              <X className="w-4 h-4 mr-2" />
                              Dismiss
                            </Button>
                          </div>
                          {refusals[action.id] && (
                            <p className="mt-1 text-xs text-destructive" role="alert" data-testid={`refusal-${action.id}`}>
                              {refusals[action.id]}
                            </p>
                          )}
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
                            {action.timestamp ? new Date(action.timestamp).toLocaleTimeString() : "-"}
                          </span>
                        </div>

                        <div>
                          <p className="text-sm text-muted-foreground">
                            {action.actionType === "knockout" ? "Knockout by" : "Player"}
                          </p>
                          <p className="font-medium">{action.player?.name ?? "Unknown player"}</p>
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

                        {refusals[action.id] && (
                          <p className="text-sm text-destructive" role="alert">
                            {refusals[action.id]}
                          </p>
                        )}

                        <div className="flex gap-2">
                          <Button
                            className="flex-1"
                            onClick={() => confirmActionMutation.mutate({ actionId: action.id })}
                            disabled={busy}
                          >
                            <Check className="w-4 h-4 mr-2" />
                            Confirm Payment
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => dismissActionMutation.mutate({ actionId: action.id })}
                            disabled={busy}
                          >
                            <X className="w-4 h-4 mr-2" />
                            Dismiss
                          </Button>
                        </div>
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
