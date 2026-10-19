import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Trophy, User } from "lucide-react";
import { formatMoney, toCents } from "@shared/domain/money";
import { splitHighHandAward } from "@shared/domain/prize-pool";

interface TournamentRegistration {
  id: string;
  playerId: string;
  player: {
    name: string;
    imageUrl?: string;
  } | null;
  enteringHighHands: boolean;
  highHandWinner?: boolean;
  highHandAmount?: string | null;
}

interface AssignHighHandModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tournamentId: string;
  registrations: TournamentRegistration[];
  /** What the next winner is awarded (nextHighHandAward), or null once every prize is awarded. */
  nextAwardCents: number | null;
}

/** The "split with" choice meaning: a new prize, not a tie. */
const NEXT_PRIZE = "next";

export function AssignHighHandModal({
  open,
  onOpenChange,
  tournamentId,
  registrations,
  nextAwardCents,
}: AssignHighHandModalProps) {
  const { toast } = useToast();
  const [selectedPlayerId, setSelectedPlayerId] = useState<string>("");
  const [splitWith, setSplitWith] = useState<string>(NEXT_PRIZE);

  // Only show players who entered high hands AND haven't already won
  const eligiblePlayers = registrations.filter(
    reg => reg.enteringHighHands && !reg.highHandWinner
  );

  const previousWinners = registrations.filter((reg) => reg.highHandWinner);
  // Once every prize is awarded the only award left is a tie, which shares a winner's prize (TN2-04).
  const allAwarded = nextAwardCents === null;
  const splitTarget = previousWinners.find((winner) => winner.id === splitWith);
  const splitting = splitTarget !== undefined;
  // What the server will award: shown, never sent, since the server works it out under its lock.
  const awardCents = splitTarget ? splitHighHandAward(toCents(splitTarget.highHandAmount)).shareCents : (nextAwardCents ?? 0);

  const close = () => {
    onOpenChange(false);
    setSelectedPlayerId("");
    setSplitWith(NEXT_PRIZE);
  };

  const assignHighHandMutation = useMutation({
    mutationFn: async () => {
      const selectedReg = registrations.find(r => r.playerId === selectedPlayerId);
      if (!selectedReg) throw new Error("Player not found");

      const response = await apiRequest("PUT", `/api/registrations/${selectedReg.id}`, {
        highHandWinner: true,
        ...(splitTarget ? { highHandSplitWith: splitTarget.id } : {}),
      });
      return (await response.json()) as { highHandAmount: string | null; player: { name: string } | null };
    },
    onSuccess: (awarded) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tournaments", tournamentId, "registrations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tournaments", tournamentId, "activity"] });
      // A tie adds a high-hand prize to the tournament itself, which the next award is worked out from (P2REV1-03).
      queryClient.invalidateQueries({ queryKey: ["/api/tournaments", tournamentId], exact: true });
      // The amount the server recorded, which is what is paid (it works the award out from the pot as it is now).
      const amount = formatMoney(toCents(awarded.highHandAmount));
      const winner = awarded.player?.name ?? "The winner";
      toast({
        title: "Success",
        description: splitting ? `High hand split: ${winner} gets ${amount}` : `${winner} wins the high hand: ${amount}`,
      });
      close();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to assign high hand winner",
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-accent" />
            Assign High Hand Winner
          </DialogTitle>
          <DialogDescription>
            Select the next player who won the high hand bonus
            {previousWinners.length > 0 && (
              <span className="block mt-1 text-foreground font-medium">
                {previousWinners.length} winner{previousWinners.length > 1 ? 's' : ''} already assigned
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {previousWinners.length > 0 && (
            <div className="space-y-2 p-3 rounded-lg bg-muted/50 border">
              <Label className="text-xs font-semibold">Previous Winners</Label>
              <div className="space-y-1">
                {previousWinners.map((winner) => (
                  <div key={winner.id} className="flex items-center gap-2 text-sm">
                    <Trophy className="w-3 h-3 text-accent" />
                    <span>{winner.player?.name || "Unknown Player"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="player">Player*</Label>
            <Select value={selectedPlayerId} onValueChange={setSelectedPlayerId}>
              <SelectTrigger id="player">
                <SelectValue placeholder="Select player" />
              </SelectTrigger>
              <SelectContent>
                {eligiblePlayers.length === 0 ? (
                  <div className="p-4 text-center text-sm text-muted-foreground">
                    {previousWinners.length > 0
                      ? "All eligible players have been assigned"
                      : "No players entered high hands"}
                  </div>
                ) : (
                  eligiblePlayers.map((reg) => (
                    <SelectItem key={reg.playerId} value={reg.playerId} className="py-2">
                      <div className="flex items-center gap-2">
                        <Avatar className="w-6 h-6">
                          <AvatarImage src={reg.player?.imageUrl} alt={reg.player?.name} />
                          <AvatarFallback>
                            <User className="w-3 h-3" />
                          </AvatarFallback>
                        </Avatar>
                        <span>{reg.player?.name || "Unknown Player"}</span>
                      </div>
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Only players who entered high hands and haven't won yet are shown
            </p>
          </div>

          {previousWinners.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="split-with">Tied hand?</Label>
              <Select value={allAwarded && !splitting ? "" : splitWith} onValueChange={setSplitWith}>
                <SelectTrigger id="split-with" data-testid="split-with">
                  <SelectValue placeholder="Split with a winner" />
                </SelectTrigger>
                <SelectContent>
                  {!allAwarded && <SelectItem value={NEXT_PRIZE}>No: the next high-hand prize</SelectItem>}
                  {previousWinners.map((winner) => (
                    <SelectItem key={winner.id} value={winner.id}>
                      Split with {winner.player?.name || "Unknown Player"} ({formatMoney(toCents(winner.highHandAmount))})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {allAwarded
                  ? "Every high-hand prize has been awarded: a tie shares a winner's prize, half each."
                  : "A tie shares that winner's prize, half each; otherwise this is the next prize."}
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="amount">High Hand Amount</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
              <Input
                id="amount"
                type="text"
                className="pl-8 bg-muted"
                value={(awardCents / 100).toFixed(2)}
                disabled
                readOnly
                data-testid="high-hand-amount"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {splitting
                ? "Half of that winner's prize; they keep the other half"
                : "What is left of the high-hand pot, shared among the winners still to come"}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button
            onClick={() => assignHighHandMutation.mutate()}
            disabled={!selectedPlayerId || (allAwarded && !splitting) || assignHighHandMutation.isPending}
            data-testid="assign-high-hand"
          >
            {assignHighHandMutation.isPending ? "Assigning..." : "Assign High Hand"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
