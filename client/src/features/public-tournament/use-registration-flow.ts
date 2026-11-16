/**
 * The QR sign-up's three steps (new or returning player; their picture and details, or a name search;
 * the high hands and the total), as state and handlers the page and its steps share. A new player's
 * step 2 comes in two parts: their picture first (a selfie, a photo or an avatar, or skipped), then their
 * name and, if they like, their mobile number (round 7, item 9). The new player's form lives here, not
 * in its step, so Back finds what was typed. The players with that name at the club are offered first
 * ("Already played here? That's me"), with or without a number, so a returning player is not made
 * twice: one who signed up by name only before has no number stored to be found by (R7FREV1-02). "No,
 * I'm new here" then signs up as before, matched by the number when one is typed.
 */
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { PublicPlayer } from "@shared/api/public";
import { useToast } from "@/hooks/use-toast";
import { errorMessage, hasErrorCode } from "@/lib/api/http";
import { useSameNameLookup } from "./components/player-search";
import { useCreatePlayer, useRegisterForTournament } from "./hooks";
import { registrationProblem, signUpProblem } from "./messages";
import { EMPTY_NEW_PLAYER, newPlayerSchema, sameDetails, type NewPlayerValues, type PlayerDetails } from "./registration";
import { formResolver, showServerFieldErrors } from "@/lib/forms";

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

export function useRegistrationFlow(tournamentId: string) {
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
  const [enteringHighHands, setEnteringHighHands] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  // The last sign-up refusal said above the form; one put on a field (a phone number already taken) is
  // not. Set in the same step as the field's error, so the two never both show, even for a moment.
  const [signUpFailure, setSignUpFailure] = useState<unknown>(null);

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

  const signUp = async (playerId: string) => {
    // A player the club's search found needs no token; one made (or matched) here brings POST /api/players's.
    const token = playerType === "new" && !claimed && signedUp ? { signUpToken: signedUp.signUpToken } : {};
    try {
      await register.mutateAsync({ playerId, enteringHighHands, ...token });
    } catch {
      return; // said on the step, from the mutation's error
    }
    toast({ title: "Registration Successful!", description: "Please proceed to payment confirmation." });
  };

  const completeRegistration = () => {
    if (player) void signUp(player.id);
  };

  const startOver = () => {
    setStep(1);
    setPlayerType(null);
    setNewPlayerStage("photo");
    setPhotoDemanded(false);
    setExistingPlayer(null);
    setSignedUp(null);
    setSameName(null);
    setClaimed(null);
    setEnteringHighHands(false);
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
    player,
    enteringHighHands,
    setEnteringHighHands,
    completeRegistration,
    registering: register.isPending,
    registrationError: register.error ? registrationProblem(register.error) : null,
    // Signed up: the mutation's own success, which Back and Start over reset (P3REV3-CQ-13).
    complete: register.isSuccess,
    /** The registration once signed up, with where auto-seat put the player (round 5). */
    registration: register.data ?? null,
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
