/**
 * The QR sign-up's three steps (new or returning player; their picture and details, or a name search;
 * the high hands and the total), as state and handlers the page and its steps share. A new player's
 * step 2 comes in two parts: their picture first (a selfie, a photo or an avatar, or skipped), then their
 * name and number. The new player's form lives here, not in its step, so Back finds what was typed.
 */
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { PublicPlayer } from "@shared/api/public";
import { useToast } from "@/hooks/use-toast";
import { errorMessage, hasErrorCode } from "@/lib/api/http";
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

export function useRegistrationFlow(tournamentId: string) {
  const { toast } = useToast();
  const form = useForm<NewPlayerValues>({ resolver: formResolver(newPlayerSchema), defaultValues: EMPTY_NEW_PLAYER });
  const createPlayer = useCreatePlayer();
  const register = useRegisterForTournament(tournamentId);

  const [step, setStep] = useState<Step>(1);
  const [playerType, setPlayerType] = useState<PlayerType | null>(null);
  const [newPlayerStage, setNewPlayerStage] = useState<NewPlayerStage>("photo");
  // The server said this club asks every new player for a picture, whatever the page read about the club.
  const [photoDemanded, setPhotoDemanded] = useState(false);
  const [existingPlayer, setExistingPlayer] = useState<PublicPlayer | null>(null);
  const [signedUp, setSignedUp] = useState<SignedUp | null>(null);
  const [enteringHighHands, setEnteringHighHands] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  // The last sign-up refusal said above the form; one put on a field (a phone number already taken) is
  // not. Set in the same step as the field's error, so the two never both show, even for a moment.
  const [signUpFailure, setSignUpFailure] = useState<unknown>(null);

  const player = playerType === "new" ? (signedUp?.player ?? null) : existingPlayer;
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
    setNewPlayerStage("photo");
  };

  const submitNewPlayer = form.handleSubmit(async (values) => {
    const details = newPlayerSchema.parse(values);
    // Back and Continue with nothing changed: the player is already signed up (PUB-06).
    if (signedUp && sameDetails(signedUp.details, details)) {
      setStep(3);
      return;
    }
    setSignUpFailure(null);
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
      if (created.existing) {
        const photoNotUsed = Boolean(details.imageUrl) && details.imageUrl !== stored.imageUrl;
        toast({
          title: "Welcome back!",
          description: photoNotUsed
            ? `We found your player profile, ${created.name}. Your new photo was not saved: the TD can change it at the desk.`
            : `We found your player profile, ${created.name}.`,
        });
      }
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
  });

  const continueWithExisting = () => {
    if (existingPlayer) setStep(3);
    else selectionRequired("Please select a player.");
  };

  const back = () => {
    register.reset();
    createPlayer.reset();
    setSignUpFailure(null);
    if (view === "details") setNewPlayerStage("photo");
    else setStep(step === 3 ? 2 : 1);
  };

  const signUp = async (playerId: string) => {
    try {
      await register.mutateAsync({ playerId, enteringHighHands, ...(playerType === "new" && signedUp ? { signUpToken: signedUp.signUpToken } : {}) });
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
    creatingPlayer: createPlayer.isPending,
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
