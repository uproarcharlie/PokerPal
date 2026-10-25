import { useId } from "react";
import { useWatch } from "react-hook-form";
import { UserRound } from "lucide-react";
import type { ClubDto } from "@shared/api/public";
import { isBuiltInAvatarUrl } from "@shared/domain/avatars";
import { PlayerAvatar } from "@/components/image/player-avatar";
import { PlayerPhotoField } from "@/components/image/player-photo-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import type { RegistrationFlow } from "../use-registration-flow";
import { PrivacyNotice } from "./privacy-notice";

const QUESTION = "text-base font-semibold text-foreground";

interface NewPlayerStepProps {
  flow: RegistrationFlow;
  /** The tournament's club: whether it asks every new player for a picture (the server holds them to it either way). */
  club: ClubDto | undefined;
}

/** Step 2 for a first-timer: their picture first, then their name and phone number. */
export function NewPlayerStep({ flow, club }: NewPlayerStepProps) {
  return <Form {...flow.form}>{flow.view === "details" ? <DetailsStage flow={flow} /> : <PhotoStage flow={flow} club={club} />}</Form>;
}

/**
 * The picture, camera first: a selfie, a photo from the phone or one of the avatars. "Skip for now"
 * unless the club asks every new player for one. Once the player is made or found the picture is
 * locked: sending another would find that player and drop it (P3REV3-IMG-01).
 */
function PhotoStage({ flow, club }: NewPlayerStepProps) {
  const { form, photoUploading, photoLocked } = flow;
  const imageUrl = useWatch({ control: form.control, name: "imageUrl" });
  const required = club?.requireSignupPhoto === true || flow.photoDemanded;
  const hasPicture = Boolean(imageUrl);
  const questionId = useId();
  return (
    <div className="space-y-5">
      <div className="space-y-1 text-center">
        <p id={questionId} className={QUESTION}>
          Add your photo
        </p>
        <p className="text-sm text-muted-foreground">
          {photoLocked
            ? "Saved with your sign-up. The TD can change your photo at the desk."
            : "So the TD and the other players know who you are, on the standings and at your table."}
        </p>
      </div>
      <FormField
        control={form.control}
        name="imageUrl"
        render={({ field }) => (
          <FormItem>
            <PlayerPhotoField
              labelledBy={questionId}
              value={field.value}
              onChange={(url) => {
                form.clearErrors("imageUrl");
                field.onChange(url);
              }}
              onUploadingChange={flow.setPhotoUploading}
              disabled={photoLocked}
            />
            <FormMessage className="text-center" />
          </FormItem>
        )}
      />
      {required && !hasPicture && !photoLocked ? (
        <p className="text-center text-sm text-muted-foreground" data-testid="photo-required">
          {club ? club.name : "This club"} asks every new player for a photo or an avatar.
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="button" variant="outline" className="h-11 flex-1" onClick={flow.back} data-testid="photo-back">
          Back
        </Button>
        {/* Once the player is saved there is nothing to skip: their picture (or none) is theirs. */}
        {hasPicture || photoUploading || photoLocked ? (
          <Button type="button" className="h-11 flex-1" onClick={flow.continueFromPhoto} disabled={photoUploading} data-testid="photo-next">
            {photoUploading ? "Uploading photo..." : "Continue"}
          </Button>
        ) : required ? null : (
          <Button type="button" variant="ghost" className="h-11 flex-1 text-muted-foreground" onClick={flow.continueFromPhoto} data-testid="photo-skip">
            Skip for now
          </Button>
        )}
      </div>
    </div>
  );
}

/** Their picture as chosen (with a way back to change it), their name and phone number, then the sign-up. */
function DetailsStage({ flow }: { flow: RegistrationFlow }) {
  const { form, photoUploading, creatingPlayer, photoLocked } = flow;
  const [imageUrl, name] = useWatch({ control: form.control, name: ["imageUrl", "name"] });
  const picture = imageUrl ? (isBuiltInAvatarUrl(imageUrl) ? "Your avatar" : "Your photo") : "No photo";
  return (
    <form onSubmit={(event) => void flow.submitNewPlayer(event)} className="space-y-4" noValidate>
      <div className="flex items-center gap-3 rounded-lg border border-border p-3" data-testid="photo-summary">
        {imageUrl ? (
          <PlayerAvatar name={name} imageUrl={imageUrl} size="lg" />
        ) : (
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <UserRound className="h-8 w-8" aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium text-foreground">{picture}</p>
          <p className="text-muted-foreground">
            {photoLocked ? "Saved with your sign-up" : imageUrl ? "Shown next to your name" : "Your initials are shown instead"}
          </p>
        </div>
        {photoLocked ? null : (
          <Button
            type="button"
            variant="outline"
            className="h-11 shrink-0 px-3"
            onClick={flow.changePhoto}
            aria-label={imageUrl ? "Change your picture" : "Add a picture"}
            data-testid="change-photo"
          >
            {imageUrl ? "Change" : "Add"}
          </Button>
        )}
      </div>
      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Full Name</FormLabel>
            <FormControl>
              <Input placeholder="e.g. Sam Taylor" autoComplete="name" className="h-11" {...field} data-testid="player-name" />
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
              <Input
                type="tel"
                inputMode="tel"
                placeholder="e.g. 021 123 4567"
                autoComplete="tel"
                className="h-11"
                {...field}
                data-testid="player-phone"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <PrivacyNotice />
      {flow.signUpError ? (
        <Alert variant="destructive" data-testid="sign-up-problem">
          <AlertDescription>{flow.signUpError}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex gap-2">
        <Button type="button" variant="outline" className="h-11 flex-1" onClick={flow.back} data-testid="step2-back">
          Back
        </Button>
        <Button type="submit" className="h-11 flex-1" disabled={photoUploading} busy={creatingPlayer} data-testid="step2-next">
          {photoUploading ? "Uploading photo..." : creatingPlayer ? "Creating..." : "Continue"}
        </Button>
      </div>
    </form>
  );
}
