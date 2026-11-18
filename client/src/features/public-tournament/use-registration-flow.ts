/**
 * The QR sign-up's three steps (new or returning player; their picture and details, or a name search;
 * the high hands they enter, round 10: each one ticked on its own, and the total), as state and handlers the page and its steps share. A new player's
 * step 2 comes in two parts: their picture first (a selfie, a photo or an avatar, or skipped), then their
 * name and, if they like, their mobile number (round 7, item 9). The new player's form lives here, not
 * in its step, so Back finds what was typed. The players with that name at the club are offered first
 * ("Already played here? That's me"), with or without a number, so a returning player is not made
 * twice: one who signed up by name only before has no number stored to be found by (R7FREV1-02). "No,
 * I'm new here" then signs up as before, matched by the number when one is typed. A sign-up with a bank
 * transfer to make is kept in the tab (saved-sign-up), so coming back to the page from the banking app
 * shows its confirmation again (R8REV1-PHONE-02), until "Register Another Player".
 */
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import type { PublicPlayer } from "@shared/api/public";
import type { RegistrationCreatedDto } from "@shared/api/registrations";
import { useToast } from "@/hooks/use-toast";
import { useRegistrations } from "@/features/tournaments/hooks";
import { errorMessage, hasErrorCode } from "@/lib/api/http";
import { useSameNameLookup } from "./components/player-search";
import { useCreatePlayer, useRegisterForTournament } from "./hooks";
import { registrationProblem, signUpProblem } from "./messages";
import { EMPTY_NEW_PLAYER, newPlayerSchema, sameDetails, type NewPlayerValues, type PlayerDetails } from "./registration";
import { formResolver, showServerFieldErrors } from "@/lib/forms";
import { forgetSignUp, readSavedSignUp, saveSignUp, transferToMake } from "./saved-sign-up";
import { waitingListPlaceOf } from "./waiting-list";

/** The sign-up toast's word on paying: as the confirmation below it says (round 8: by transfer, or not yet). */
function howToPayNote(created: RegistrationCreatedDto): string {
  if (waitingListPlaceOf(created) !== null || created.paymentInstructions?.waitingList) return "You're on the waiting list: don't pay yet.";
  if (transferToMake(created)) return "Pay by bank transfer, or at the door.";
  return "Please proceed to payment confirmation.";
}

export type PlayerType = "new" | "existing";
export type Step = 1 | 2 | 3;
/** A new player's step 2: their picture, then their name and number. */
export type NewPlayerStage = "photo" | "details";
/** What is on screen, for moving focus to each new part as it replaces the last. */
export type RegistrationView = "type" | NewPlayerStage | "search" | "confirm";

/** A new player the server has made (or matched), and the details that made them. */
interface SignedUp {
  details: PlayerDetails;
  player: PublicPlayer;
  /** POST /api/players's proof that this visitor typed the player in, for a player new to the club (P2REV0-02). */
  signUpToken: string;
}

/** The players with the name a new player typed, offered before a new one is made. */
interface SameName {
  details: PlayerDetails;
  players: PublicPlayer[];
}

interface RegistrationFlowOptions {
  /** The tournament is over (completed or cancelled): a sign-up kept from before is not shown again. */
  closed?: boolean;
}

export function useRegistrationFlow(tournamentId: string, { closed = false }: RegistrationFlowOptions = {}) {
  const { toast } = useToast();
  const form = useForm<NewPlayerValues>({ resolver: formResolver(newPlayerSchema), defaultValues: EMPTY_NEW_PLAYER });
  const createPlayer = useCreatePlayer();
  const lookUpSameName = useSameNameLookup(tournamentId);
  const register = useRegisterForTournament(tournamentId);

  const [step, setStep] = useState<Step>(1);
  const [playerType, setPlayerType] = useState<PlayerType | null>(null);
  const [newPlayerStage, setNewPlayerStage] = useState<NewPlayerStage>("photo");
  // The server said this club asks every new player for a picture, whatever the page read about the club.
  const [photoDemanded, setPhotoDemanded] = useState(false);
  const [existingPlayer, setExistingPlayer] = useState<PublicPlayer | null>(null);
  const [signedUp, setSignedUp] = useState<SignedUp | null>(null);
  const [sameName, setSameName] = useState<SameName | null>(null);
  const [checkingName, setCheckingName] = useState(false);
  // "That's me": the club's player with the name typed, signed up as themselves (no new player made).
  const [claimed, setClaimed] = useState<PublicPlayer | null>(null);
  // The high hands the player enters (round 10: each by its id, "legacy" for a tournament's one high hand of before).
  const [highHandIds, setHighHandIds] = useState<string[]>([]);
  const [photoUploading, setPhotoUploading] = useState(false);
  // The last sign-up refusal said above the form; one put on a field (a phone number already taken) is
  // not. Set in the same step as the field's error, so the two never both show, even for a moment.
  const [signUpFailure, setSignUpFailure] = useState<unknown>(null);
  // The sign-up this tab made before the page was reloaded, with a transfer still to make (R8REV1-PHONE-02).
  const [saved, setSaved] = useState(() => readSavedSignUp(tournamentId));
  // Shown again while it stands: not once the tournament is over, nor once the club has taken the entry off.
  const { data: entries } = useRegistrations(tournamentId);
  const restored = saved && !closed && (entries === undefined || entries.some((entry) => entry.id === saved.registration.id)) ? saved : null;
  const signedUpBefore = register.isSuccess ? null : restored;

  // One that no longer stands is not kept for the next visit either.
  const stale = saved !== null && restored === null;
  useEffect(() => {
    if (stale) forgetSignUp(tournamentId);
  }, [stale, tournamentId]);

  const player = playerType === "new" ? (claimed ?? signedUp?.player ?? null) : existingPlayer;
  const view: RegistrationView = step === 1 ? "type" : step === 3 ? "confirm" : playerType === "new" ? newPlayerStage : "search";

  const selectionRequired = (description: string) => {
    toast({ title: "Selection Required", description, variant: "destructive" });
  };

  const continueFromType = () => {
    if (playerType) setStep(2);
    else selectionRequired("Please choose if you're a new or existing player.");
  };

  /** From the picture to the name and number: with a picture, or skipping it where the club allows. */
  const continueFromPhoto = () => setNewPlayerStage("details");
  /** Back to the picture from the name and number. */
  const changePhoto = () => {
    setSignUpFailure(null);
    setSameName(null);
    setNewPlayerStage("photo");
  };

  /** The players the club's name search finds with this name; none when it cannot be asked (the sign-up goes on). */
  const playersNamed = async (name: string): Promise<PublicPlayer[]> => {
    setCheckingName(true);
    try {
      return await lookUpSameName(name);
    } catch {
      return [];
    } finally {
      setCheckingName(false);
    }
  };

  /** A returning player found by their details; a new photo is not saved over the one they have (P3REV3-IMG-01). */
  const welcomeBack = (name: string, photoNotUsed: boolean) => {
    toast({
      title: "Welcome back!",
      description: photoNotUsed
        ? `We found your player profile, ${name}. Your new photo was not saved: the TD can change it at the desk.`
        : `We found your player profile, ${name}.`,
    });
  };

  /** Makes the new player (or finds the stored one with the same name and number), then on to the total. */
  const signUpNewPlayer = async (details: PlayerDetails) => {
    try {
      // This tournament's club becomes a new player's home club, even if the sign-up stops here.
      const created = await createPlayer.mutateAsync({
        name: details.name,
        phone: details.phone,
        ...(details.imageUrl ? { imageUrl: details.imageUrl } : {}),
        tournamentId,
      });
      // What the server stored: a player it already had keeps their own photo, never the one sent now, so the
      // form shows that one and a later Back and Continue compares against it (P3REV3-IMG-01).
      const stored = { ...details, imageUrl: created.imageUrl ?? null };
      if (created.existing) welcomeBack(created.name, Boolean(details.imageUrl) && details.imageUrl !== stored.imageUrl);
      form.setValue("imageUrl", stored.imageUrl);
      setSignedUp({ details: stored, player: { id: created.id, name: created.name, imageUrl: created.imageUrl }, signUpToken: created.signUpToken });
      setStep(3);
    } catch (error) {
      // The club asks every new player for a picture (its setting may have changed since the page loaded).
      if (hasErrorCode(error, "PHOTO_REQUIRED")) {
        form.setError("imageUrl", { type: "server", message: errorMessage(error) });
        setPhotoDemanded(true);
        setNewPlayerStage("photo");
        return;
      }
      if (!showServerFieldErrors(form.setError, error, { fields: ["name", "phone"], codes: { PHONE_TAKEN: "phone" } })) setSignUpFailure(error);
    }
  };

  const submitNewPlayer = form.handleSubmit(async (values) => {
    const details = newPlayerSchema.parse(values);
    // Back and Continue with nothing changed: the player is already signed up (PUB-06).
    if (signedUp && sameDetails(signedUp.details, details)) {
      setStep(3);
      return;
    }
    setSignUpFailure(null);
    setSameName(null);
    // Someone at the club with this name may be them, even with a number typed: they may have signed up without one before.
    const players = await playersNamed(details.name);
    if (players.length > 0) {
      setSameName({ details, players });
      return;
    }
    await signUpNewPlayer(details);
  });

  /** "That's me": signs up the club's player with this name, who keeps their own picture. */
  const claimPlayer = (chosen: PublicPlayer) => {
    const photo = sameName?.details.imageUrl ?? null;
    setSameName(null);
    setClaimed(chosen);
    welcomeBack(chosen.name, photo !== null && photo !== chosen.imageUrl);
    setStep(3);
  };

  /** "No, I'm new here": none of the players with this name, so a new one is made after all. */
  const notClaimed = () => {
    if (!sameName) return;
    setSameName(null);
    void signUpNewPlayer(sameName.details);
  };

  const continueWithExisting = () => {
    if (existingPlayer) setStep(3);
    else selectionRequired("Please select a player.");
  };

  const back = () => {
    register.reset();
    createPlayer.reset();
    setSignUpFailure(null);
    setSameName(null);
    setClaimed(null);
    if (view === "details") setNewPlayerStage("photo");
    else setStep(step === 3 ? 2 : 1);
  };

  const signUp = async (chosen: PublicPlayer) => {
    // A player the club's search found needs no token; one made (or matched) here brings POST /api/players's.
    const token = playerType === "new" && !claimed && signedUp ? { signUpToken: signedUp.signUpToken } : {};
    let created: RegistrationCreatedDto;
    try {
      // The high hands ticked (round 10), with the flag a sign-up has always sent: none ticked is the flag alone.
      const highHands = highHandIds.length > 0 ? { enteringHighHands: true, highHandIds } : { enteringHighHands: false };
      created = await register.mutateAsync({ playerId: chosen.id, ...highHands, ...token });
    } catch {
      return; // said on the step, from the mutation's error
    }
    saveSignUp(tournamentId, { player: chosen, registration: created, highHandIds });
    toast({ title: "Registration Successful!", description: howToPayNote(created) });
  };

  const completeRegistration = () => {
    if (player) void signUp(player);
  };

  const startOver = () => {
    forgetSignUp(tournamentId);
    setSaved(null);
    setStep(1);
    setPlayerType(null);
    setNewPlayerStage("photo");
    setPhotoDemanded(false);
    setExistingPlayer(null);
    setSignedUp(null);
    setSameName(null);
    setClaimed(null);
    setHighHandIds([]);
    register.reset();
    createPlayer.reset();
    setSignUpFailure(null);
    form.reset(EMPTY_NEW_PLAYER);
  };

  const signUpError = signUpFailure === null ? null : signUpProblem(signUpFailure);

  return {
    step,
    view,
    playerType,
    choosePlayerType: setPlayerType,
    continueFromType,
    continueFromPhoto,
    changePhoto,
    form,
    submitNewPlayer,
    creatingPlayer: createPlayer.isPending || checkingName,
    /** The players with the name typed, offered before a new player is made (round 7, item 9; R7FREV1-02). */
    sameName,
    claimPlayer,
    notClaimed,
    signUpError,
    photoUploading,
    setPhotoUploading,
    existingPlayer,
    chooseExistingPlayer: setExistingPlayer,
    continueWithExisting,
    player: signedUpBefore?.player ?? player,
    highHandIds: signedUpBefore?.highHandIds ?? highHandIds,
    setHighHandIds,
    completeRegistration,
    registering: register.isPending,
    registrationError: register.error ? registrationProblem(register.error) : null,
    // Signed up: the mutation's own success, which Back and Start over reset (P3REV3-CQ-13), or a
    // sign-up this tab made before the page was reloaded (R8REV1-PHONE-02).
    complete: register.isSuccess || signedUpBefore !== null,
    /** The registration once signed up, with where auto-seat put the player (round 5) and how to pay (round 8). */
    registration: register.data ?? signedUpBefore?.registration ?? null,
    /**
     * The player has been made (or found) with the photo as it stands: it can no longer change here, as
     * sending it again would find that player and drop the new photo (P3REV3-IMG-01).
     */
    photoLocked: signedUp !== null,
    /** The sign-up was refused for want of a picture (PHOTO_REQUIRED): "Skip for now" is no longer offered. */
    photoDemanded,
    back,
    startOver,
  };
}

export type RegistrationFlow = ReturnType<typeof useRegistrationFlow>;
