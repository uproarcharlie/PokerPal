import { useId, useRef, useState, type ChangeEvent } from "react";
import { Camera, ImageIcon, Loader2, Upload, X } from "lucide-react";
import { imageKindSpec, type ImageKind } from "@shared/domain/images";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CameraDialog } from "./camera-dialog";
import { CropDialog } from "./crop-dialog";
import { SmartImage } from "./smart-image";
import { useImageUpload } from "./use-image-upload";

const PREVIEW: Readonly<Record<ImageKind, { box: string; fit: string; width: number; height: number }>> = {
  player_avatar: { box: "h-32 w-32 rounded-full", fit: "object-cover", width: 128, height: 128 },
  club_logo: { box: "h-32 w-32 rounded-lg border border-border bg-card p-1", fit: "object-contain", width: 128, height: 128 },
  club_banner: { box: "aspect-[3/1] w-full max-w-md rounded-lg", fit: "object-cover", width: 448, height: 149 },
  tournament_banner: { box: "aspect-video w-full max-w-md rounded-lg", fit: "object-cover", width: 448, height: 252 },
};

export interface ImageFieldProps {
  /** What the picture is for: how it is cropped and sized. Only player_avatar may be uploaded signed out. */
  kind: ImageKind;
  /** The stored URL now (from the form); null or "" for none. */
  value: string | null | undefined;
  /** The new stored URL once an upload finishes, or null when the picture is removed. */
  onChange: (url: string | null) => void;
  /** True from picking a picture until its upload settles: keep the form's Save disabled meanwhile. */
  onUploadingChange?: (uploading: boolean) => void;
  /** Names the field; omit when the form already labels it. */
  label?: string;
  /** Help under the buttons. */
  description?: string;
  /** Offers "Take Photo" (the live camera). Default: for player photos. */
  camera?: boolean;
  /** The preview's alt text. */
  previewAlt?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Picks, frames and uploads one picture. The preview always comes from `value` (or the picture being
 * uploaded), never from a copy kept when the field first appeared, so it follows the form. A new pick
 * cancels an upload still running; the server's reason is shown under the field when one fails.
 */
export function ImageField({
  kind,
  value,
  onChange,
  onUploadingChange,
  label,
  description = "JPEG, PNG, WebP or GIF. Large photos are made smaller for you.",
  camera = kind === "player_avatar",
  previewAlt = "Upload preview",
  disabled = false,
  className,
}: ImageFieldProps) {
  const spec = imageKindSpec(kind);
  const preview = PREVIEW[kind];
  const labelId = useId();
  const descriptionId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const captureInput = useRef<HTMLInputElement>(null);
  // Where focus comes back to when the camera or the crop step closes, if what opened it has gone.
  const cameraButton = useRef<HTMLButtonElement>(null);
  const chooseButton = useRef<HTMLButtonElement>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const picture = useImageUpload({ kind, value, onChange, onUploadingChange });
  const { stage, error, shown } = picture;

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
    // Remove goes with the picture: focus stays in the field, on what picks a new one (P3REV-MA-FOCUS-AFTER-REMOVE).
    chooseButton.current?.focus();
    picture.replace(null);
  };

  const hasImage = shown !== null;
  // While a picture is being prepared the pick buttons wait, but stay focusable: disabling the button
  // the person just used threw their focus to the top of the page (MA-P3REV1-01).
  const preparing = stage.name === "preparing";

  return (
    <div
      role="group"
      aria-labelledby={label ? labelId : undefined}
      aria-describedby={descriptionId}
      className={cn("space-y-3", className)}
    >
      {label ? (
        <p id={labelId} className="text-sm font-medium text-foreground">
          {label}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className={cn("relative shrink-0 overflow-hidden bg-muted", preview.box)}>
          <SmartImage
            src={shown}
            alt={previewAlt}
            width={preview.width}
            height={preview.height}
            priority
            className={cn("h-full w-full", preview.fit)}
            fallback={
              <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                <ImageIcon className="h-10 w-10" aria-hidden="true" />
              </div>
            }
          />
          {stage.name === "preparing" || stage.name === "uploading" ? (
            <div className="absolute inset-0 flex items-center justify-center bg-background/60">
              <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          {camera ? (
            <Button ref={cameraButton} type="button" variant="outline" onClick={openCamera} disabled={disabled} busy={preparing}>
              <Camera className="mr-2 h-4 w-4" aria-hidden="true" />
              {hasImage ? "Retake" : "Take Photo"}
            </Button>
          ) : null}
          <Button ref={chooseButton} type="button" variant="outline" onClick={chooseFile} disabled={disabled} busy={preparing}>
            <Upload className="mr-2 h-4 w-4" aria-hidden="true" />
            {hasImage ? "Change" : "Upload"}
          </Button>
          {hasImage ? (
            <Button type="button" variant="outline" onClick={remove} disabled={disabled}>
              <X className="mr-2 h-4 w-4" aria-hidden="true" />
              Remove
            </Button>
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
          className="h-2 w-full max-w-md overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round(stage.progress * 100)}%` }} />
        </div>
      ) : null}

      <p id={descriptionId} className="text-xs text-muted-foreground">
        {description}
      </p>
      {error ? (
        <p role="alert" className="text-sm text-destructive" data-testid="image-upload-error">
          {error}
        </p>
      ) : null}

      <input ref={fileInput} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={onFileChosen} />
      {/* Opens the camera app on phones whose browser has no live camera API. */}
      <input
        ref={captureInput}
        type="file"
        accept="image/*"
        capture="user"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={onFileChosen}
      />

      {camera ? (
        <CameraDialog
          open={cameraOpen}
          onOpenChange={setCameraOpen}
          onCapture={(photo) => void picture.take(photo)}
          onChooseFile={chooseFile}
          returnFocusTo={cameraButton}
        />
      ) : null}
      {spec.aspect !== null ? (
        <CropDialog
          key={picture.crop.imageUrl ?? "closed"}
          {...picture.crop}
          aspect={spec.aspect}
          round={kind === "player_avatar"}
          returnFocusTo={chooseButton}
        />
      ) : null}
    </div>
  );
}
