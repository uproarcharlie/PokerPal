import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { ShoppingCart, RefreshCw, Skull, CheckCircle2, ArrowLeft, User, Trophy } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";

interface Tournament {
  id: string;
  name: string;
  buyInAmount: string;
  rebuyAmount?: string;
  addonAmount?: string;
  maxRebuys?: number;
  rebuyPeriodMinutes?: number;
  status: string;
  clubId: string;
}

interface Club {
  id: string;
  name: string;
  imageUrl?: string;
  description?: string;
}

interface Player {
  id: string;
  name: string;
  imageUrl?: string;
}

interface TournamentRegistration {
  id: string;
  tournamentId: string;
  playerId: string;
  buyIns: number;
  rebuys: number;
  addons: number;
  isEliminated: boolean;
  eliminationTime?: string;
  player: Player;
}

export default function PlayerActions() {
  const { tournamentId } = useParams();
  const { toast } = useToast();
  const [actionType, setActionType] = useState<"rebuy" | "addon" | "knockout" | null>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string>("");
  const [knockoutTargetId, setKnockoutTargetId] = useState<string>("");
  const [actionComplete, setActionComplete] = useState(false);

  const { data: tournament, isLoading: tournamentLoading } = useQuery<Tournament>({
    queryKey: [`/api/tournaments/${tournamentId}`],
  });

  const { data: club } = useQuery<Club>({
    queryKey: [`/api/clubs/${tournament?.clubId}`],
    enabled: !!tournament?.clubId,
  });

  const { data: registrations = [] } = useQuery<TournamentRegistration[]>({
    queryKey: [`/api/tournaments/${tournamentId}/registrations`],
    enabled: !!tournamentId,
  });

  const createActionMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPlayerId) throw new Error("Please select a player");
      if (actionType === "knockout" && !knockoutTargetId) throw new Error("Please select target player");

      const response = await apiRequest("POST", `/api/tournaments/${tournamentId}/pending-actions`, {
        playerId: selectedPlayerId,
        actionType,
        targetPlayerId: actionType === "knockout" ? knockoutTargetId : null,
        timestamp: new Date().toISOString(),
      });
      return await response.json();
    },
    onSuccess: () => {
      setActionComplete(true);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleAction = () => {
    createActionMutation.mutate();
  };

  const handleStartOver = () => {
    setActionType(null);
    setSelectedPlayerId("");
    setKnockoutTargetId("");
    setActionComplete(false);
  };

  const activePlayers = registrations.filter(r => !r.isEliminated);
  const selectedPlayerReg = registrations.find(r => r.playerId === selectedPlayerId);

  if (tournamentLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">Loading tournament...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!tournament) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <p className="text-center text-destructive">Tournament not found</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (actionComplete) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-4 text-center">
            {club && (
              <Link href={`/club/${club.id}`}>
                <div className="flex items-center justify-center gap-3 hover:opacity-80 transition-opacity cursor-pointer">
                  {club.imageUrl ? (
                    <img
                      src={club.imageUrl}
                      alt={club.name}
                      className="w-16 h-16 rounded-lg object-cover border-2 border-primary/20"
                    />
                  ) : (
                    <div className="w-16 h-16 bg-gradient-to-br from-primary to-accent rounded-lg flex items-center justify-center text-white text-xl font-bold border-2 border-primary/20">
                      {club.name.substring(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div className="text-left">
                    <p className="text-2xl font-bold text-primary">{club.name}</p>
                    <p className="text-xs text-muted-foreground">Poker Club</p>
                  </div>
                </div>
              </Link>
            )}
            <div className="pt-4">
              <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
              <CardTitle className="text-2xl">Action Submitted!</CardTitle>
              <CardDescription className="mt-2">
                {actionType === "rebuy" && "Re-buy request submitted"}
                {actionType === "addon" && "Add-on request submitted"}
                {actionType === "knockout" && "Knockout submitted"}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-muted p-4 rounded-lg space-y-2">
              <p className="text-sm font-medium">Please proceed to the payment desk for confirmation</p>
              {(actionType === "rebuy" || actionType === "addon") && selectedPlayerReg && (
                <>
                  <p className="text-3xl font-bold text-primary">
                    ${actionType === "rebuy" ? tournament.rebuyAmount : tournament.addonAmount}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {actionType === "rebuy" ? "Re-buy" : "Add-on"} for {selectedPlayerReg.player.name}
                  </p>
                </>
              )}
            </div>
            <Button onClick={handleStartOver} className="w-full" size="lg">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Actions
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!actionType) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-4">
            {club && (
              <Link href={`/club/${club.id}`}>
                <div className="flex items-center justify-center gap-3 hover:opacity-80 transition-opacity cursor-pointer">
                  {club.imageUrl ? (
                    <img
                      src={club.imageUrl}
                      alt={club.name}
                      className="w-16 h-16 rounded-lg object-cover border-2 border-primary/20"
                    />
                  ) : (
                    <div className="w-16 h-16 bg-gradient-to-br from-primary to-accent rounded-lg flex items-center justify-center text-white text-xl font-bold border-2 border-primary/20">
                      {club.name.substring(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div className="text-left">
                    <p className="text-2xl font-bold text-primary">{club.name}</p>
                    <p className="text-xs text-muted-foreground">Poker Club</p>
                  </div>
                </div>
              </Link>
            )}
            <div className="text-center pt-2">
              <CardTitle className="text-xl">{tournament.name}</CardTitle>
              <CardDescription className="mt-1">Select an action</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {tournament.rebuyAmount && (
              <Button
                variant="outline"
                className="w-full h-auto py-6 flex flex-col items-center gap-2"
                onClick={() => setActionType("rebuy")}
              >
                <RefreshCw className="w-8 h-8" />
                <div>
                  <p className="font-semibold">Re-buy</p>
                  <p className="text-sm text-muted-foreground">${tournament.rebuyAmount}</p>
                </div>
              </Button>
            )}

            {tournament.addonAmount && (
              <Button
                variant="outline"
                className="w-full h-auto py-6 flex flex-col items-center gap-2"
                onClick={() => setActionType("addon")}
              >
                <ShoppingCart className="w-8 h-8" />
                <div>
                  <p className="font-semibold">Add-on</p>
                  <p className="text-sm text-muted-foreground">${tournament.addonAmount}</p>
                </div>
              </Button>
            )}

            <Button
              variant="outline"
              className="w-full h-auto py-6 flex flex-col items-center gap-2"
              onClick={() => setActionType("knockout")}
            >
              <Skull className="w-8 h-8" />
              <div>
                <p className="font-semibold">Register Knockout</p>
                <p className="text-sm text-muted-foreground">Record an elimination</p>
              </div>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-4">
          {club && (
            <Link href={`/club/${club.id}`}>
              <div className="flex items-center justify-center gap-3 hover:opacity-80 transition-opacity cursor-pointer">
                {club.imageUrl ? (
                  <img
                    src={club.imageUrl}
                    alt={club.name}
                    className="w-16 h-16 rounded-lg object-cover border-2 border-primary/20"
                  />
                ) : (
                  <div className="w-16 h-16 bg-gradient-to-br from-primary to-accent rounded-lg flex items-center justify-center text-white text-xl font-bold border-2 border-primary/20">
                    {club.name.substring(0, 2).toUpperCase()}
                  </div>
                )}
                <div className="text-left">
                  <p className="text-2xl font-bold text-primary">{club.name}</p>
                  <p className="text-xs text-muted-foreground">Poker Club</p>
                </div>
              </div>
            </Link>
          )}
          <div className="text-center pt-2">
            <CardTitle className="flex items-center gap-2 justify-center text-xl">
              {actionType === "rebuy" && <><RefreshCw className="w-5 h-5" /> Re-buy</>}
              {actionType === "addon" && <><ShoppingCart className="w-5 h-5" /> Add-on</>}
              {actionType === "knockout" && <><Skull className="w-5 h-5" /> Register Knockout</>}
            </CardTitle>
            <CardDescription className="mt-1">
              {actionType === "rebuy" && `$${tournament.rebuyAmount} - Select player to add re-buy`}
              {actionType === "addon" && `$${tournament.addonAmount} - Select player to purchase add-on`}
              {actionType === "knockout" && "Select players involved in elimination"}
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="mx-auto"
            onClick={handleStartOver}
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>
              {actionType === "knockout" ? "Player Who Made Knockout" : "Select Player"}
            </Label>
            <Select value={selectedPlayerId} onValueChange={setSelectedPlayerId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a player..." />
              </SelectTrigger>
              <SelectContent>
                {activePlayers.map((reg) => (
                  <SelectItem key={reg.id} value={reg.playerId} className="py-4">
                    <div className="flex items-center gap-2">
                      <Avatar className="w-6 h-6">
                        <AvatarImage src={reg.player.imageUrl} alt={reg.player.name} />
                        <AvatarFallback>
                          <User className="w-3 h-3" />
                        </AvatarFallback>
                      </Avatar>
                      <span>
                        {reg.player.name}
                        {actionType === "rebuy" && ` (${reg.rebuys || 0} rebuys)`}
                        {actionType === "addon" && ` (${reg.addons || 0} addons)`}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {actionType === "knockout" && (
            <div className="space-y-2">
              <Label>Player Who Was Knocked Out</Label>
              <Select value={knockoutTargetId} onValueChange={setKnockoutTargetId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a player..." />
                </SelectTrigger>
                <SelectContent>
                  {activePlayers
                    .filter(r => r.playerId !== selectedPlayerId)
                    .map((reg) => (
                      <SelectItem key={reg.id} value={reg.playerId} className="py-4">
                        <div className="flex items-center gap-2">
                          <Avatar className="w-6 h-6">
                            <AvatarImage src={reg.player.imageUrl} alt={reg.player.name} />
                            <AvatarFallback>
                              <User className="w-3 h-3" />
                            </AvatarFallback>
                          </Avatar>
                          <span>{reg.player.name}</span>
                        </div>
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <Button
            onClick={handleAction}
            disabled={
              !selectedPlayerId ||
              (actionType === "knockout" && !knockoutTargetId) ||
              createActionMutation.isPending
            }
            className="w-full"
            size="lg"
            variant={actionType === "knockout" ? "destructive" : "default"}
          >
            {actionType === "rebuy" && "Submit Re-buy"}
            {actionType === "addon" && "Submit Add-on"}
            {actionType === "knockout" && "Submit Knockout"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
