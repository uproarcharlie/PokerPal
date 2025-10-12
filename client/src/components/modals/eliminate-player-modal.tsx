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
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { UserX } from "lucide-react";

interface Player {
  id: string;
  name: string;
  email?: string;
}

interface TournamentRegistration {
  id: string;
  playerId: string;
  isEliminated: boolean;
  player: Player | null;
}

interface EliminatePlayerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  registration: TournamentRegistration;
  tournamentId: string;
  allRegistrations: TournamentRegistration[];
}

export function EliminatePlayerModal({
  open,
  onOpenChange,
  registration,
  tournamentId,
  allRegistrations,
}: EliminatePlayerModalProps) {
  const { toast } = useToast();
  const [eliminatedBy, setEliminatedBy] = useState<string>("");

  const eliminatePlayerMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("PUT", `/api/registrations/${registration.id}`, {
        isEliminated: true,
        eliminationTime: new Date().toISOString(),
        eliminatedBy: eliminatedBy || null,
      });
      return response.json();
    },
    onSuccess: async () => {
      // If a player was assigned the knockout, update their knockout count
      if (eliminatedBy) {
        const knockoutRegistration = allRegistrations.find(r => r.playerId === eliminatedBy);
        if (knockoutRegistration) {
          await apiRequest("PUT", `/api/registrations/${knockoutRegistration.id}`, {
            knockouts: (knockoutRegistration as any).knockouts ? (knockoutRegistration as any).knockouts + 1 : 1,
          });
        }
      }

      queryClient.invalidateQueries({ queryKey: ["/api/tournaments", tournamentId, "registrations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tournaments", tournamentId, "activity"] });
      toast({
        title: "Success",
        description: "Player eliminated successfully",
      });
      onOpenChange(false);
      setEliminatedBy("");
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to eliminate player",
        variant: "destructive",
      });
    },
  });

  // Get active players (excluding the player being eliminated)
  const activePlayers = allRegistrations.filter(
    (reg) => !reg.isEliminated && reg.playerId !== registration.playerId
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserX className="w-5 h-5 text-destructive" />
            Eliminate Player
          </DialogTitle>
          <DialogDescription>
            Eliminate {registration.player?.name || "this player"} from the tournament.
            Optionally assign the knockout to another player.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="eliminatedBy">Knocked out by (optional)</Label>
            <Select value={eliminatedBy} onValueChange={setEliminatedBy}>
              <SelectTrigger id="eliminatedBy">
                <SelectValue placeholder="Select player (optional)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">None</SelectItem>
                {activePlayers.map((reg) => (
                  <SelectItem key={reg.playerId} value={reg.playerId}>
                    {reg.player?.name || "Unknown Player"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Select the player who knocked them out to track knockout statistics
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              setEliminatedBy("");
            }}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => eliminatePlayerMutation.mutate()}
            disabled={eliminatePlayerMutation.isPending}
          >
            {eliminatePlayerMutation.isPending ? "Eliminating..." : "Eliminate Player"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
