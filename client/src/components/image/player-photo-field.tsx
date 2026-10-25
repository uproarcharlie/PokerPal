import { useId, useRef, useState, type ChangeEvent } from "react";
import { Camera, Loader2, Smile, Upload, UserRound, X } from "lucide-react";
import { isBuiltInAvatarUrl } from "@shared/domain/avatars";
import { imageKindSpec } from "@shared/domain/images";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AvatarPickerDialog } from "./avatar-picker-dialog";
import { CameraDialog } from "./camera-dialog";
import { CropDialog } from "./crop-dialog";
import { SmartImage } from "./smart-image";
import { useImageUpload } from "./use-image-upload";

/** A player photo is framed square, in the circle it is shown in. */
const PHOTO_ASPECT = imageKindSpec("player_avatar").aspect ?? 1;

export interface PlayerPhotoFieldProps {
  /** The stored picture now (from the form): an upload, a built-in avatar's path, or null for none. */
  value: string | null | undefined;
  /** The new picture once an upload finishes or an avatar is picked, or null when it is removed. */
  onChange: (url: string | null) => void;
  /** True from picking a photo until its upload settles: keep the form's Continue or Save waiting meanwhile. */
  onUploadingChange?: (uploading: boolean) => void;
  /**
   * Who takes the picture: the player of themselves on their phone (the QR sign-up: "Take a selfie", the
   * front camera) or the club's staff of a player at the desk ("Take a photo", the back camera).
   */
  taker?: "player" | "staff";
  /** Names the field; omit when the page already says what it is for. */
  label?: string;
  /** The id of words already on screen that name the field ("Add your photo"), instead of `label`. */
  labelledBy?: string;
  /** Help under the buttons. */
  description?: string;
  /** The preview's alt text. */
  previewAlt?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * A player's picture, camera first (round 5, items 7 and 8): with none yet, a big "Take a selfie" (the
 * live camera; the phone's camera app where the browser has no live camera), then "Upload a photo
 * instead" and "Pick an avatar" (one of the built-in ones, nothing uploaded). With one, Retake / Change /
 * another avatar / Remove, in the same buttons so focus stays where it was. Photos are framed in the
 * circle they are shown in, then uploaded; when the camera cannot be opened the dialog says why and
 * offers the upload instead.
 */
export function PlayerPhotoField({
  value,
  onChange,
  onUploadingChange,
  taker = "player",
  label,
  labelledBy,
  description,
  previewAlt = "Upload preview",
  disabled = false,
  className,
}: PlayerPhotoFieldProps) {
  const selfie = taker === "player";
  const labelId = useId();
  const descriptionId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const captureInput = useRef<HTMLInputElement>(null);
  // Where focus comes back to when a dialog closes, if what opened it has gone.
  const cameraButton = useRef<HTMLButtonElement>(null);
  const chooseButton = useRef<HTMLButtonElement>(null);
  const avatarButton = useRef<HTMLButtonElement>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [avatarsOpen, setAvatarsOpen] = useState(false);
  const picture = useImageUpload({ kind: "player_avatar", value, onChange, onUploadingChange });
  const { stage, error, shown } = picture;

  const hasImage = shown !== null;
  const avatar = isBuiltInAvatarUrl(shown);
  const hasPhoto = hasImage && !avatar;
  // While a picture is being prepared the buttons wait, but stay focusable (MA-P3REV1-01).
  const preparing = stage.name === "preparing";

  const onFileChosen = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Cleared so choosing the same file again still counts as a change.
    event.target.value = "";
    if (file) void picture.take(file);
  };

  const chooseFile = () => fileInput.current?.click();

  const openCamera = () => {
    if (typeof navigator.mediaDevices?.getUserMedia === "function") setCameraOpen(true);
    else captureInput.current?.click();
  };

  const remove = () => {
    // Remove goes with the picture: focus stays in the field, on what picks a new one.
    chooseButton.current?.focus();
    picture.replace(null);
  };

  const cameraLabel = hasPhoto ? "Retake" : selfie ? "Take a selfie" : "Take a photo";
  const uploadLabel = hasPhoto ? "Change" : selfie && !hasImage ? "Upload a photo instead" : "Upload a photo";
  const avatarLabel = avatar ? "Change avatar" : "Pick an avatar";
  const secondary = hasImage ? "h-12" : "h-12 w-full";

  return (
    <div
      role="group"
      aria-labelledby={label ? labelId : labelledBy}
      aria-describedby={description ? descriptionId : undefined}
      className={cn("space-y-4", className)}
    >
      {label ? (
        <p id={labelId} className="text-sm font-medium text-foreground">
          {label}
        </p>
      ) : null}

      <div className="flex justify-center">
        <div className="relative h-36 w-36 shrink-0 overflow-hidden rounded-full bg-muted" data-testid="player-photo-preview">
          <SmartImage
            src={shown}
            alt={previewAlt}
            width={144}
            height={144}
            priority
            className="h-full w-full object-cover"
            fallback={
              <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                <UserRound className="h-16 w-16" aria-hidden="true" />
              </div>
            }
          />
          {stage.name === "preparing" || stage.name === "uploading" ? (
            <div className="absolute inset-0 flex items-center justify-center bg-background/60">
              <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
            </div>
          ) : null}
        </div>
      </div>

      {stage.name === "uploading" ? (
        <div
          role="progressbar"
          aria-label="Uploading the picture"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(stage.progress * 100)}
          className="mx-auto h-2 w-full max-w-xs overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round(stage.progress * 100)}%` }} />
        </div>
      ) : null}

      {/* One set of buttons in every state, so the one pressed keeps focus as its words change. */}
      <div className={hasImage ? "grid grid-cols-2 gap-2" : "flex flex-col gap-2"}>
        <Button
          ref={cameraButton}
          type="button"
          variant={hasImage ? "outline" : "default"}
          className={hasImage ? "h-12" : "h-14 w-full text-base [&_svg]:size-5"}
          onClick={openCamera}
          disabled={disabled}
          busy={preparing}
        >
          <Camera aria-hidden="true" />
          {cameraLabel}
        </Button>
        <Button ref={chooseButton} type="button" variant="outline" className={secondary} onClick={chooseFile} disabled={disabled} busy={preparing}>
          <Upload aria-hidden="true" />
          {uploadLabel}
        </Button>
        <Button ref={avatarButton} type="button" variant="outline" className={secondary} onClick={() => setAvatarsOpen(true)} disabled={disabled} busy={preparing}>
          <Smile aria-hidden="true" />
          {avatarLabel}
        </Button>
        {hasImage ? (
          <Button type="button" variant="outline" className="h-12" onClick={remove} disabled={disabled}>
            <X aria-hidden="true" />
            Remove
          </Button>
        ) : null}
      </div>

      {description ? (
        <p id={descriptionId} className="text-center text-sm text-muted-foreground">
          {description}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-center text-sm text-destructive" data-testid="image-upload-error">
          {error}
        </p>
      ) : null}

      <input ref={fileInput} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={onFileChosen} />
      {/* Opens the camera app on phones whose browser has no live camera API. */}
      <input
        ref={captureInput}
        type="file"
        accept="image/*"
        capture={selfie ? "user" : "environment"}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={onFileChosen}
      />

      <CameraDialog
        open={cameraOpen}
        onOpenChange={setCameraOpen}
        onCapture={(photo) => void picture.take(photo)}
        onChooseFile={chooseFile}
        title={selfie ? "Take a selfie" : "Take a photo"}
        facing={selfie ? "user" : "environment"}
        returnFocusTo={cameraButton}
      />
      <AvatarPickerDialog
        open={avatarsOpen}
        onOpenChange={setAvatarsOpen}
        value={shown}
        onPick={picture.replace}
        description={selfie ? "Tap one to use it as your picture. You can add a photo at the desk later." : "Tap one to use it as their picture."}
        returnFocusTo={avatarButton}
      />
      <CropDialog key={picture.crop.imageUrl ?? "closed"} {...picture.crop} aspect={PHOTO_ASPECT} round returnFocusTo={chooseButton} />
    </div>
  );
}
