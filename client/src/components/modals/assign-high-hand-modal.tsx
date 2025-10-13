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
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Trophy } from "lucide-react";

interface TournamentRegistration {
  id: string;
  playerId: string;
  player: {
    name: string;
    imageUrl?: string;
  } | null;
  enteringHighHands: boolean;
  highHandWinner?: boolean;
}

interface AssignHighHandModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tournamentId: string;
  registrations: TournamentRegistration[];
  defaultHighHandAmount?: string;
}

export function AssignHighHandModal({
  open,
  onOpenChange,
  tournamentId,
  registrations,
  defaultHighHandAmount = "0",
}: AssignHighHandModalProps) {
  const { toast } = useToast();
  const [selectedPlayerId, setSelectedPlayerId] = useState<string>("");
  // Use the tournament's configured high hand amount (not editable)
  const highHandAmount = defaultHighHandAmount;

  // Only show players who entered high hands AND haven't already won
  const eligiblePlayers = registrations.filter(
    reg => reg.enteringHighHands && !reg.highHandWinner
  );

  // Show count of previous winners
  const previousWinners = registrations.filter(
    reg => reg.enteringHighHands && reg.highHandWinner
  );

  const assignHighHandMutation = useMutation({
    mutationFn: async () => {
      const selectedReg = registrations.find(r => r.playerId === selectedPlayerId);
      if (!selectedReg) throw new Error("Player not found");

      // Update the registration to mark as high hand winner
      await apiRequest("PUT", `/api/registrations/${selectedReg.id}`, {
        highHandWinner: true,
        highHandAmount: highHandAmount,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tournaments", tournamentId, "registrations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tournaments", tournamentId, "activity"] });
      toast({
        title: "Success",
        description: "High hand winner assigned successfully",
      });
      onOpenChange(false);
      setSelectedPlayerId("");
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
                    <SelectItem key={reg.playerId} value={reg.playerId}>
                      {reg.player?.name || "Unknown Player"}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Only players who entered high hands and haven't won yet are shown
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="amount">High Hand Amount</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
              <Input
                id="amount"
                type="text"
                className="pl-8 bg-muted"
                value={parseFloat(highHandAmount).toFixed(2)}
                disabled
                readOnly
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Amount is set by tournament configuration
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              setSelectedPlayerId("");
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={() => assignHighHandMutation.mutate()}
            disabled={!selectedPlayerId || assignHighHandMutation.isPending}
          >
            {assignHighHandMutation.isPending ? "Assigning..." : "Assign High Hand"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
