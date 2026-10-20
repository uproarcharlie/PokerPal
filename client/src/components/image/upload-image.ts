/**
 * POST /api/images/:kind with upload progress (fetch cannot report it), cancellable with an
 * AbortSignal. Failures are the same ApiError every other request throws, with the server's sentence
 * (413 too large, 415 not a picture, 429 too many), and like every other request it gives up when
 * nothing has happened for SEND_TIMEOUT_MS (status 0), so a photo stalled on the venue's Wi-Fi frees
 * the form's Save and says why instead of hanging for minutes (P3REV5-CQ-15).
 */
import type { CropFractions, ImageKind } from "@shared/domain/images";
import type { ImageUploadResponse } from "@shared/api/images";
import {
  ApiError,
  apiErrorFromBody,
  NETWORK_ERROR_MESSAGE,
  reportApiError,
  SEND_TIMEOUT_MS,
  TIMEOUT_ERROR_MESSAGE,
} from "@/lib/api/http";

export interface UploadImageOptions {
  /** The part of the (upright) image to keep, as fractions; the server applies it, then the kind's aspect. */
  crop?: CropFractions;
  /** 0-1 as the body goes up. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

const EXTENSIONS: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

export function uploadImage(kind: ImageKind, image: Blob, { crop, onProgress, signal }: UploadImageOptions = {}): Promise<ImageUploadResponse> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("The upload was cancelled", "AbortError"));
      return;
    }
    const xhr = new XMLHttpRequest();
    // Restarted whenever the upload moves on: a slow upload that is still going is never cut off,
    // one that has stopped (or whose answer never comes) is.
    let stall: ReturnType<typeof setTimeout> | undefined;
    const waitForProgress = () => {
      clearTimeout(stall);
      stall = setTimeout(() => {
        reject(new ApiError({ status: 0, error: TIMEOUT_ERROR_MESSAGE }));
        xhr.abort();
      }, SEND_TIMEOUT_MS);
    };
    const settled = () => clearTimeout(stall);
    xhr.open("POST", `/api/images/${encodeURIComponent(kind)}`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (event) => {
      waitForProgress();
      if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      settled();
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as ImageUploadResponse);
        } catch {
          reject(new ApiError({ status: xhr.status, error: "The server's answer could not be read. Please try again." }));
        }
        return;
      }
      const error = apiErrorFromBody(xhr.status, xhr.responseText, xhr.statusText);
      reportApiError(error);
      reject(error);
    };
    xhr.onerror = () => {
      settled();
      reject(new ApiError({ status: 0, error: NETWORK_ERROR_MESSAGE }));
    };
    xhr.onabort = () => {
      settled();
      reject(new DOMException("The upload was cancelled", "AbortError"));
    };
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });

    const form = new FormData();
    const name = image instanceof File && image.name ? image.name : `image.${EXTENSIONS[image.type] ?? "jpg"}`;
    form.append("image", image, name);
    if (crop) form.append("crop", JSON.stringify(crop));
    xhr.send(form);
    waitForProgress();
  });
}
