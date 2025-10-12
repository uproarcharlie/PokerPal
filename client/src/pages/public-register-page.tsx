import { useState } from "react";
import { useParams, useLocation, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { CheckCircle2, UserPlus, Users, Trophy, ArrowLeft } from "lucide-react";
import type { Tournament, Player } from "@shared/schema";

interface Club {
  id: string;
  name: string;
  imageUrl?: string;
  description?: string;
}

const newPlayerSchema = z.object({
  name: z.string().min(1, "Name is required"),
  phone: z.string().min(1, "Phone number is required"),
});

export function PublicRegisterPage() {
  const { tournamentId } = useParams<{ tournamentId: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [playerType, setPlayerType] = useState<"new" | "existing" | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<string>("");
  const [enteringHighHands, setEnteringHighHands] = useState(false);
  const [registrationComplete, setRegistrationComplete] = useState(false);

  const form = useForm({
    resolver: zodResolver(newPlayerSchema),
    defaultValues: {
      name: "",
      phone: "",
    },
  });

  const { data: tournament, isLoading: tournamentLoading } = useQuery<Tournament>({
    queryKey: ["/api/tournaments", tournamentId],
  });

  const { data: club, isLoading: clubLoading } = useQuery<Club>({
    queryKey: [`/api/clubs/${tournament?.clubId}`],
    enabled: !!tournament?.clubId,
  });

  const { data: players = [] } = useQuery<Player[]>({
    queryKey: ["/api/players"],
  });

  const createPlayerMutation = useMutation({
    mutationFn: async (data: { name: string; phone: string }) => {
      const response = await apiRequest("POST", "/api/players", data);
      const result = await response.json();
      
      if (response.status === 409) {
        throw new Error(result.message || "Phone number already registered");
      }
      
      if (!response.ok) {
        throw new Error(result.error || "Failed to create player");
      }
      
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/players"] });
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (data: { playerId: string; tournamentId: string; enteringHighHands: boolean }) => {
      const response = await apiRequest("POST", `/api/tournaments/${data.tournamentId}/registrations`, {
        playerId: data.playerId,
        enteringHighHands: data.enteringHighHands,
      });
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || "Failed to register for tournament");
      }
      
      return result;
    },
    onSuccess: () => {
      setRegistrationComplete(true);
      toast({
        title: "Registration Successful!",
        description: "Please proceed to payment confirmation.",
      });
    },
    onError: (error) => {
      const errorMessage = error instanceof Error ? error.message : "Please try again or contact support.";
      toast({
        title: "Registration Failed",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const handleStep1Next = () => {
    if (!playerType) {
      toast({
        title: "Selection Required",
        description: "Please choose if you're a new or existing player.",
        variant: "destructive",
      });
      return;
    }
    setStep(2);
  };

  const handleStep2Next = async () => {
    if (playerType === "new") {
      const isValid = await form.trigger();
      if (!isValid) return;

      const formData = form.getValues();
      try {
        const newPlayer = await createPlayerMutation.mutateAsync(formData);
        setSelectedPlayer(newPlayer.id);
        setStep(3);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Failed to create player. Please try again.";
        toast({
          title: "Unable to Create Player",
          description: errorMessage,
          variant: "destructive",
        });
      }
    } else {
      if (!selectedPlayer) {
        toast({
          title: "Selection Required",
          description: "Please select a player.",
          variant: "destructive",
        });
        return;
      }
      setStep(3);
    }
  };

  const handleFinalSubmit = () => {
    if (!selectedPlayer || !tournamentId) return;

    registerMutation.mutate({
      playerId: selectedPlayer,
      tournamentId,
      enteringHighHands,
    });
  };

  const handleStartOver = () => {
    setStep(1);
    setPlayerType(null);
    setSelectedPlayer("");
    setEnteringHighHands(false);
    setRegistrationComplete(false);
    form.reset();
  };

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

  if (registrationComplete) {
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
              <CardTitle className="text-2xl">Registration Complete!</CardTitle>
              <CardDescription className="mt-2">
                You're registered for {tournament.name}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-muted p-4 rounded-lg space-y-2">
              <p className="text-sm font-medium">Please proceed to the payment desk</p>
              <p className="text-3xl font-bold text-primary">
                $
                {(
                  parseFloat(tournament.buyInAmount) +
                  (enteringHighHands && tournament.enableHighHand
                    ? parseFloat(tournament.highHandAmount || "0")
                    : 0)
                ).toFixed(2)}
              </p>
              <p className="text-xs text-muted-foreground">
                Buy-in: ${parseFloat(tournament.buyInAmount).toFixed(2)}
                {enteringHighHands && tournament.enableHighHand && (
                  <> + High Hands: ${parseFloat(tournament.highHandAmount || "0").toFixed(2)}</>
                )}
              </p>
            </div>
            <div className="space-y-2">
              <Button onClick={handleStartOver} variant="outline" className="w-full" size="lg" data-testid="register-another">
                Register Another Player
              </Button>
              <Link href={`/tournament/${tournamentId}`}>
                <Button variant="ghost" className="w-full" size="lg">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to Tournament
                </Button>
              </Link>
            </div>
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
            <CardTitle className="text-xl">{tournament.name}</CardTitle>
            <CardDescription className="mt-1">Tournament Registration</CardDescription>
          </div>
          <div className="flex items-center justify-between pt-2">
            {[1, 2, 3].map((s) => (
              <div
                key={s}
                className={`flex-1 h-2 rounded ${
                  s <= step ? "bg-primary" : "bg-muted"
                } ${s !== 3 ? "mr-2" : ""}`}
              />
            ))}
          </div>
          <p className="text-sm text-muted-foreground text-center">
            Step {step} of 3
          </p>
        </CardHeader>
        <CardContent>
          {step === 1 && (
            <div className="space-y-4">
              <Label className="text-base font-semibold">Are you a new or existing player?</Label>
              <RadioGroup value={playerType || ""} onValueChange={(value) => setPlayerType(value as "new" | "existing")}>
                <div
                  className={`flex items-center space-x-3 p-4 rounded-lg border-2 cursor-pointer transition-colors ${
                    playerType === "new" ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                  }`}
                  onClick={() => setPlayerType("new")}
                >
                  <RadioGroupItem value="new" id="new" data-testid="player-type-new" />
                  <Label htmlFor="new" className="flex items-center cursor-pointer flex-1">
                    <UserPlus className="w-5 h-5 mr-2" />
                    <span className="font-medium">New Player</span>
                  </Label>
                </div>
                <div
                  className={`flex items-center space-x-3 p-4 rounded-lg border-2 cursor-pointer transition-colors ${
                    playerType === "existing" ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                  }`}
                  onClick={() => setPlayerType("existing")}
                >
                  <RadioGroupItem value="existing" id="existing" data-testid="player-type-existing" />
                  <Label htmlFor="existing" className="flex items-center cursor-pointer flex-1">
                    <Users className="w-5 h-5 mr-2" />
                    <span className="font-medium">Existing Player</span>
                  </Label>
                </div>
              </RadioGroup>
              <Button onClick={handleStep1Next} className="w-full" data-testid="step1-next">
                Continue
              </Button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              {playerType === "new" ? (
                <Form {...form}>
                  <form className="space-y-4">
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Full Name</FormLabel>
                          <FormControl>
                            <Input placeholder="John Doe" {...field} data-testid="player-name" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="phone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Phone Number</FormLabel>
                          <FormControl>
                            <Input placeholder="(555) 123-4567" {...field} data-testid="player-phone" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </form>
                </Form>
              ) : (
                <div className="space-y-2">
                  <Label>Select Your Name</Label>
                  <Select value={selectedPlayer} onValueChange={setSelectedPlayer}>
                    <SelectTrigger data-testid="player-select">
                      <SelectValue placeholder="Choose your name" />
                    </SelectTrigger>
                    <SelectContent>
                      {players.map((player) => (
                        <SelectItem key={player.id} value={player.id}>
                          {player.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="flex space-x-2">
                <Button onClick={() => setStep(1)} variant="outline" className="flex-1" data-testid="step2-back">
                  Back
                </Button>
                <Button
                  onClick={handleStep2Next}
                  className="flex-1"
                  disabled={createPlayerMutation.isPending}
                  data-testid="step2-next"
                >
                  {createPlayerMutation.isPending ? "Creating..." : "Continue"}
                </Button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              {tournament.enableHighHand && (
                <div className="space-y-4">
                  <Label className="text-base font-semibold">High Hands Entry</Label>
                  <p className="text-sm text-muted-foreground">
                    Enter the high hands competition for an additional ${parseFloat(tournament.highHandAmount || "0").toFixed(2)}
                  </p>
                  <RadioGroup
                    value={enteringHighHands ? "yes" : "no"}
                    onValueChange={(value) => setEnteringHighHands(value === "yes")}
                  >
                    <div
                      className={`flex items-center space-x-3 p-4 rounded-lg border-2 cursor-pointer transition-colors ${
                        enteringHighHands ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                      }`}
                      onClick={() => setEnteringHighHands(true)}
                    >
                      <RadioGroupItem value="yes" id="high-hands-yes" data-testid="high-hands-yes" />
                      <Label htmlFor="high-hands-yes" className="flex items-center cursor-pointer flex-1">
                        <Trophy className="w-5 h-5 mr-2" />
                        <span className="font-medium">Yes, I'm in!</span>
                      </Label>
                    </div>
                    <div
                      className={`flex items-center space-x-3 p-4 rounded-lg border-2 cursor-pointer transition-colors ${
                        !enteringHighHands ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                      }`}
                      onClick={() => setEnteringHighHands(false)}
                    >
                      <RadioGroupItem value="no" id="high-hands-no" data-testid="high-hands-no" />
                      <Label htmlFor="high-hands-no" className="flex items-center cursor-pointer flex-1">
                        <span className="font-medium">No thanks</span>
                      </Label>
                    </div>
                  </RadioGroup>
                </div>
              )}

              {!tournament.enableHighHand && (
                <div className="bg-muted p-4 rounded-lg">
                  <p className="text-sm text-muted-foreground text-center">
                    High hands competition is not available for this tournament
                  </p>
                </div>
              )}

              <div className="bg-muted p-4 rounded-lg">
                <p className="text-sm font-medium mb-2">Total Amount</p>
                <p className="text-3xl font-bold">
                  $
                  {(
                    parseFloat(tournament.buyInAmount) +
                    (enteringHighHands && tournament.enableHighHand
                      ? parseFloat(tournament.highHandAmount || "0")
                      : 0)
                  ).toFixed(2)}
                </p>
              </div>

              <div className="flex space-x-2">
                <Button onClick={() => setStep(2)} variant="outline" className="flex-1" data-testid="step3-back">
                  Back
                </Button>
                <Button
                  onClick={handleFinalSubmit}
                  className="flex-1"
                  disabled={registerMutation.isPending}
                  data-testid="complete-registration"
                >
                  {registerMutation.isPending ? "Registering..." : "Complete Registration"}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
