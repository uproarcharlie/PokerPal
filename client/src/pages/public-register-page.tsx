import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { apiJson, isApiRequestError } from "@/lib/queryClient";
import { CheckCircle2, UserPlus, Users, Trophy, ArrowLeft, Lock } from "lucide-react";
import { ImageUpload } from "@/components/ui/image-upload";
import { PlayerSearch } from "@/components/player/player-search";
import { formatMoney, toCents } from "@shared/domain/money";
import { amountDueCents } from "@shared/domain/prize-pool";
import { CLOSED_STATUSES, type TournamentStatus } from "@shared/api/tournaments";
import type { Viewer } from "@shared/api/common";
import type { ErrorCode } from "@shared/api/errors";
import type { CreatePlayerResponse } from "@shared/api/players";
import type { PublicPlayer, PublicRegistration } from "@shared/api/public";

interface Club {
  id: string;
  name: string;
  slug: string;
  imageUrl?: string | null;
}

interface Tournament {
  id: string;
  name: string;
  clubId: string;
  status: TournamentStatus;
  buyInAmount: string;
  enableHighHand: boolean | null;
  highHandAmount: string | null;
  prizePoolLocked: boolean | null;
  maxPlayers: number;
  viewer?: Viewer;
}

const newPlayerSchema = z.object({
  name: z.string().min(1, "Name is required"),
  phone: z.string().min(1, "Phone number is required"),
  imageUrl: z.string().optional(),
});

type NewPlayerForm = z.infer<typeof newPlayerSchema>;

/** What a player sees when the server refuses a sign-up (POST /api/tournaments/:id/registrations). */
const REGISTRATION_PROBLEMS: Partial<Record<ErrorCode, string>> = {
  ALREADY_REGISTERED: "You're already registered for this tournament. See you at the table!",
  TOURNAMENT_FULL: "Sorry, this tournament is full. Please speak to the tournament director, who can seat extra players.",
  HIGH_HAND_AWARDED: 'Every high-hand prize has already been won tonight. Choose "No thanks" and try again.',
  TOURNAMENT_CLOSED: "Registration for this tournament has closed.",
  PRIZE_POOL_LOCKED: "Registration has closed: the prize pool is locked. Please speak to the tournament director.",
  HIGH_HAND_NOT_AVAILABLE: 'High hands isn\'t available for this tournament. Choose "No thanks" and try again.',
  PLAYER_NOT_FOUND: "We couldn't find that player. Go back and search again, or register as a new player.",
};

function registrationProblem(error: unknown): string {
  const known = isApiRequestError(error) && error.code ? REGISTRATION_PROBLEMS[error.code] : undefined;
  if (known) return known;
  return error instanceof Error && error.message ? error.message : "Please try again or contact the tournament director.";
}

/** Buy-in plus the high-hands entry, to the cent, as the payment desk will ask for it (the same rule: amountDueCents). */
function amountDue(tournament: Tournament, enteringHighHands: boolean): string {
  const entry = { buyIns: 1, rebuys: 0, addons: 0, enteringHighHands: enteringHighHands && tournament.enableHighHand === true };
  return formatMoney(amountDueCents(tournament, entry), { forceCents: true });
}

function ClubBadge({ club }: { club: Club }) {
  return (
    <Link href={`/club/${club.slug}`}>
      <div className="flex items-center justify-center gap-3 hover:opacity-80 transition-opacity cursor-pointer">
        {club.imageUrl ? (
          <img src={club.imageUrl} alt={club.name} className="w-16 h-16 rounded-lg object-cover border-2 border-primary/20" />
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
  );
}

export function PublicRegisterPage() {
  const { tournamentId } = useParams<{ tournamentId: string }>();
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [playerType, setPlayerType] = useState<"new" | "existing" | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<PublicPlayer | null>(null);
  // POST /api/players's proof that this visitor typed the player's details in, for signing up a player
  // who has not played at this club before (P2REV0-02).
  const [signUpToken, setSignUpToken] = useState<string | undefined>(undefined);
  const [enteringHighHands, setEnteringHighHands] = useState(false);
  const [registrationComplete, setRegistrationComplete] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [isImageUploading, setIsImageUploading] = useState(false);

  const form = useForm<NewPlayerForm>({
    resolver: zodResolver(newPlayerSchema),
    defaultValues: {
      name: "",
      phone: "",
      imageUrl: "",
    },
  });

  const { data: tournament, isLoading: tournamentLoading } = useQuery<Tournament>({
    queryKey: ["/api/tournaments", tournamentId],
  });

  const { data: club } = useQuery<Club>({
    queryKey: [`/api/clubs/${tournament?.clubId}`],
    enabled: !!tournament?.clubId,
  });

  // Who is already in, so a full tournament says so before anyone types their details or uploads a photo.
  const { data: signedUp } = useQuery<PublicRegistration[]>({
    queryKey: ["/api/tournaments", tournamentId, "registrations"],
  });

  const createPlayerMutation = useMutation({
    mutationFn: (data: NewPlayerForm) =>
      apiJson<CreatePlayerResponse>("POST", "/api/players", {
        name: data.name,
        phone: data.phone,
        imageUrl: data.imageUrl || undefined,
        // This tournament's club becomes a new player's home club, even if the sign-up stops here.
        tournamentId,
      }),
  });

  const registerMutation = useMutation({
    mutationFn: (data: { playerId: string; tournamentId: string; enteringHighHands: boolean; signUpToken?: string }) =>
      apiJson<PublicRegistration>("POST", `/api/tournaments/${data.tournamentId}/registrations`, {
        playerId: data.playerId,
        enteringHighHands: data.enteringHighHands,
        ...(data.signUpToken ? { signUpToken: data.signUpToken } : {}),
      }),
    onSuccess: () => {
      setProblem(null);
      setRegistrationComplete(true);
      toast({
        title: "Registration Successful!",
        description: "Please proceed to payment confirmation.",
      });
    },
    onError: (error) => setProblem(registrationProblem(error)),
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

  /** Shows a refused sign-up next to the field it is about, when it is about one. */
  const showCreatePlayerError = (error: unknown) => {
    if (isApiRequestError(error) && error.code === "PHONE_TAKEN") {
      form.setError("phone", { message: error.message });
      return;
    }
    if (isApiRequestError(error) && error.code === "VALIDATION" && Array.isArray(error.details)) {
      const issue = error.details[0] as { path?: unknown[]; message?: unknown } | undefined;
      const field = issue?.path?.[0];
      if ((field === "name" || field === "phone") && typeof issue?.message === "string") {
        form.setError(field, { message: issue.message });
        return;
      }
    }
    toast({
      title: "Unable to Create Player",
      description: error instanceof Error ? error.message : "Failed to create player. Please try again.",
      variant: "destructive",
    });
  };

  const handleStep2Next = async () => {
    if (playerType === "new") {
      const isValid = await form.trigger();
      if (!isValid) return;

      try {
        const player = await createPlayerMutation.mutateAsync(form.getValues());
        if (player.existing) {
          toast({ title: "Welcome back!", description: `We found your player profile, ${player.name}.` });
        }
        setSelectedPlayer({ id: player.id, name: player.name, imageUrl: player.imageUrl });
        setSignUpToken(player.signUpToken);
        setStep(3);
      } catch (error) {
        showCreatePlayerError(error);
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
      playerId: selectedPlayer.id,
      tournamentId,
      enteringHighHands,
      signUpToken: playerType === "new" ? signUpToken : undefined,
    });
  };

  const handleStartOver = () => {
    setStep(1);
    setPlayerType(null);
    setSelectedPlayer(null);
    setSignUpToken(undefined);
    setEnteringHighHands(false);
    setRegistrationComplete(false);
    setProblem(null);
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

  // The tournament's staff can still seat a player at a full table (the server does not hold them to maxPlayers).
  const full = tournament.viewer?.canManage !== true && (signedUp?.length ?? 0) >= tournament.maxPlayers;
  const closedMessage = CLOSED_STATUSES.includes(tournament.status)
    ? "Registration for this tournament has closed."
    : tournament.prizePoolLocked
      ? "Registration has closed: the prize pool is locked. Please speak to the tournament director."
      : full
        ? REGISTRATION_PROBLEMS.TOURNAMENT_FULL
        : null;

  if (closedMessage && !registrationComplete) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-4 text-center">
            {club && <ClubBadge club={club} />}
            <div className="pt-4">
              <Lock className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <CardTitle className="text-xl">{tournament.name}</CardTitle>
              <CardDescription className="mt-2" data-testid="registration-closed">
                {closedMessage}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <Link href={`/tournament/${tournamentId}`}>
              <Button variant="outline" className="w-full" size="lg">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Tournament
              </Button>
            </Link>
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
            {club && <ClubBadge club={club} />}
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
              <p className="text-3xl font-bold text-primary" data-testid="amount-due">
                {amountDue(tournament, enteringHighHands)}
              </p>
              <p className="text-xs text-muted-foreground">
                Buy-in: {formatMoney(toCents(tournament.buyInAmount), { forceCents: true })}
                {enteringHighHands && tournament.enableHighHand && (
                  <> + High Hands: {formatMoney(toCents(tournament.highHandAmount), { forceCents: true })}</>
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
          {club && <ClubBadge club={club} />}
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
                      name="imageUrl"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Your Photo (Optional)</FormLabel>
                          <FormControl>
                            <ImageUpload
                              onImageUpload={field.onChange}
                              currentImage={field.value}
                              kind="player_avatar"
                              placeholder="Take a photo or upload one"
                              onUploadingChange={setIsImageUploading}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
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
                  <Label>Find Your Name</Label>
                  <PlayerSearch tournamentId={tournament.id} selected={selectedPlayer} onSelect={setSelectedPlayer} />
                </div>
              )}
              <div className="flex space-x-2">
                <Button onClick={() => setStep(1)} variant="outline" className="flex-1" data-testid="step2-back">
                  Back
                </Button>
                <Button
                  onClick={handleStep2Next}
                  className="flex-1"
                  disabled={createPlayerMutation.isPending || isImageUploading}
                  data-testid="step2-next"
                >
                  {isImageUploading ? "Uploading photo..." : createPlayerMutation.isPending ? "Creating..." : "Continue"}
                </Button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              {selectedPlayer && (
                <p className="text-sm text-muted-foreground text-center" data-testid="registering-as">
                  Registering <span className="font-semibold text-foreground">{selectedPlayer.name}</span>
                </p>
              )}

              {tournament.enableHighHand && (
                <div className="space-y-4">
                  <Label className="text-base font-semibold">High Hands Entry</Label>
                  <p className="text-sm text-muted-foreground">
                    Enter the high hands competition for an additional {formatMoney(toCents(tournament.highHandAmount), { forceCents: true })}
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
                <p className="text-3xl font-bold">{amountDue(tournament, enteringHighHands)}</p>
              </div>

              {problem && (
                <Alert variant="destructive" data-testid="registration-problem">
                  <AlertDescription>{problem}</AlertDescription>
                </Alert>
              )}

              <div className="flex space-x-2">
                <Button
                  onClick={() => {
                    setProblem(null);
                    setStep(2);
                  }}
                  variant="outline"
                  className="flex-1"
                  data-testid="step3-back"
                >
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
