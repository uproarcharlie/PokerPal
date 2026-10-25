import { useEffect, useRef, useState } from "react";
import { imageKindSpec, type CropFractions, type ImageKind } from "@shared/domain/images";
import { errorMessage, isAbortError } from "@/lib/api/http";
import { storedImageUrl } from "./image-sources";
import { cropForUpload, ImagePrepareError, prepareImage } from "./prepare-image";
import { uploadImage } from "./upload-image";

export const UPLOAD_FAILED_MESSAGE = "The picture could not be uploaded. Please try again.";

export type ImageUploadStage =
  | { name: "idle" }
  | { name: "preparing" }
  | { name: "cropping"; image: Blob; url: string }
  | { name: "uploading"; url: string; progress: number };

export interface ImageUploadOptions {
  kind: ImageKind;
  /** The stored URL now (from the form); null or "" for none. */
  value: string | null | undefined;
  /** The new stored URL once an upload finishes, or what `replace` sets. */
  onChange: (url: string | null) => void;
  /** True from picking a picture until its upload settles. */
  onUploadingChange?: (uploading: boolean) => void;
}

export interface ImageUpload {
  stage: ImageUploadStage;
  /** Why the last picture could not be used, said under the field. */
  error: string | null;
  /** What the preview shows: the picture being framed or uploaded, else the stored one (null for none). */
  shown: string | null;
  /** A picture is being read, framed or uploaded. */
  busy: boolean;
  /** Reads a picked file or a captured photo, frames it when its kind is cropped, and uploads it. */
  take: (file: File | Blob) => Promise<void>;
  /** Cancels whatever is under way and sets the picture to `url` at once: null removes it; a built-in avatar's path. */
  replace: (url: string | null) => void;
  /** The framing step's props: open while a picture waits to be framed. */
  crop: { imageUrl: string | null; onCancel: () => void; onConfirm: (crop: CropFractions | undefined) => void };
}

/**
 * Picking, framing and uploading one picture, for the fields that offer it (ImageField, PlayerPhotoField).
 * A new pick cancels an upload still running, and anything older that settles later is ignored; the
 * object URL on screen is revoked once nothing shows it, and on unmount, when the form is also told the
 * upload is over.
 */
export function useImageUpload({ kind, value, onChange, onUploadingChange }: ImageUploadOptions): ImageUpload {
  const spec = imageKindSpec(kind);
  const [stage, setStage] = useState<ImageUploadStage>({ name: "idle" });
  const [error, setError] = useState<string | null>(null);
  // The pick or upload still current; anything older that settles later is ignored.
  const attempt = useRef<AbortController | null>(null);
  // The object URL on screen, revoked once nothing shows it.
  const objectUrl = useRef<string | null>(null);

  const busy = stage.name !== "idle";
  // The latest callback, so telling the form never depends on the callback's identity.
  const reportUploading = useRef(onUploadingChange);
  useEffect(() => {
    reportUploading.current = onUploadingChange;
  });
  const busyRef = useRef(false);
  useEffect(() => {
    busyRef.current = busy;
    reportUploading.current?.(busy);
  }, [busy]);

  useEffect(
    () => () => {
      attempt.current?.abort();
      // No attempt is current any more, so a picture still being prepared makes no object URL that
      // nothing would revoke (P3REV-IMG-OBJURL-UNMOUNT).
      attempt.current = null;
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = null;
      if (busyRef.current) reportUploading.current?.(false);
    },
    [],
  );

  const showObjectUrl = (url: string | null) => {
    if (objectUrl.current && objectUrl.current !== url) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = url;
  };

  /** Cancels whatever is under way and returns the controller for a new attempt. */
  const restart = (): AbortController => {
    attempt.current?.abort();
    const controller = new AbortController();
    attempt.current = controller;
    return controller;
  };

  const finish = (controller: AbortController) => {
    if (attempt.current !== controller) return;
    attempt.current = null;
    showObjectUrl(null);
    setStage({ name: "idle" });
  };

  const upload = async (controller: AbortController, image: Blob, url: string, crop?: CropFractions) => {
    setStage({ name: "uploading", url, progress: 0 });
    try {
      const stored = await uploadImage(kind, image, {
        crop,
        signal: controller.signal,
        onProgress: (progress) => {
          if (attempt.current === controller) setStage({ name: "uploading", url, progress });
        },
      });
      if (attempt.current === controller) onChange(stored.url);
    } catch (cause) {
      if (attempt.current === controller && !isAbortError(cause)) setError(errorMessage(cause, UPLOAD_FAILED_MESSAGE));
    } finally {
      finish(controller);
    }
  };

  const take = async (file: File | Blob) => {
    const controller = restart();
    setError(null);
    setStage({ name: "preparing" });
    let image: Blob;
    try {
      const named = file instanceof File ? file : new File([file], "photo.jpg", { type: file.type || "image/jpeg" });
      image = await prepareImage(named, kind);
    } catch (cause) {
      if (attempt.current !== controller) return;
      setError(cause instanceof ImagePrepareError ? cause.message : UPLOAD_FAILED_MESSAGE);
      finish(controller);
      return;
    }
    if (attempt.current !== controller) return;
    const url = URL.createObjectURL(image);
    showObjectUrl(url);
    if (spec.aspect !== null) setStage({ name: "cropping", image, url });
    else await upload(controller, image, url);
  };

  const replace = (url: string | null) => {
    const controller = restart();
    setError(null);
    finish(controller);
    onChange(url);
  };

  const cancelCrop = () => {
    if (attempt.current) finish(attempt.current);
  };

  const confirmCrop = async (crop: CropFractions | undefined) => {
    if (stage.name !== "cropping" || !attempt.current) return;
    const controller = attempt.current;
    const { image, url } = stage;
    setStage({ name: "uploading", url, progress: 0 });
    // Only the framed part, at the size the server keeps; the whole picture and the frame where this
    // browser cannot redraw it.
    const framed = crop ? await cropForUpload(image, kind, crop) : null;
    if (attempt.current !== controller) return;
    if (!framed) {
      await upload(controller, image, url, crop);
      return;
    }
    // The preview shows what is being sent, the framed part, not the middle of the whole picture
    // (P3REV3-IMG-02); the whole picture's URL is let go.
    const framedUrl = URL.createObjectURL(framed);
    showObjectUrl(framedUrl);
    await upload(controller, framed, framedUrl);
  };

  const shown = stage.name === "uploading" || stage.name === "cropping" ? stage.url : storedImageUrl(value);

  return {
    stage,
    error,
    shown,
    busy,
    take,
    replace,
    crop: { imageUrl: stage.name === "cropping" ? stage.url : null, onCancel: cancelCrop, onConfirm: (crop) => void confirmCrop(crop) },
  };
}
