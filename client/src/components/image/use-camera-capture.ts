import { useCallback, useEffect, useRef, useState } from "react";

export type FacingMode = "user" | "environment";

export const CAMERA_ERROR_MESSAGE = "Couldn't open the camera. You can upload a photo instead.";
export const CAMERA_BLOCKED_MESSAGE =
  "Camera access is blocked for this page. Upload a photo instead, or allow the camera in your browser's settings and try again.";
export const NO_CAMERA_MESSAGE = "No camera was found on this device. Upload a photo instead.";
export const CAMERA_BUSY_MESSAGE = "The camera is being used by another app. Close it and try again, or upload a photo instead.";

/** What to tell someone whose camera did not open, by the browser's reason (getUserMedia's DOMException name). */
export function cameraErrorMessage(cause: unknown): string {
  const name = cause instanceof Error || cause instanceof DOMException ? cause.name : "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return CAMERA_BLOCKED_MESSAGE;
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") return NO_CAMERA_MESSAGE;
  if (name === "NotReadableError" || name === "TrackStartError") return CAMERA_BUSY_MESSAGE;
  return CAMERA_ERROR_MESSAGE;
}

export interface CameraCapture {
  /** Whether this browser can open a live camera at all (else use a capture file input). */
  supported: boolean;
  stream: MediaStream | null;
  error: string | null;
  facingMode: FacingMode;
  /** Asks for the camera (the front one unless `facingMode` says otherwise). */
  start: (facingMode?: FacingMode) => void;
  /** Releases the camera: every track stopped, any request still waiting ignored. */
  stop: () => void;
  /** Front to back camera, or back. */
  switchCamera: () => void;
  /**
   * The frame on `video` now, as a JPEG, as the camera sees it. The front camera's preview is mirrored
   * on screen only: the photo kept is never flipped, so writing in it reads the right way round on the
   * standings (P3REV-IMG-MIRRORED-SELFIE).
   */
  capture: (video: HTMLVideoElement) => Promise<Blob | null>;
}

function stopTracks(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

/**
 * The live camera for "Take Photo". The camera light goes off whenever the photo is taken, the dialog
 * closes or the page goes away, including when the dialog closes before the browser has answered the
 * permission request (that late stream is stopped at once instead of left running).
 */
export function useCameraCapture(): CameraCapture {
  const supported = typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function";
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<FacingMode>("user");
  const streamRef = useRef<MediaStream | null>(null);
  const attemptRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    attemptRef.current?.abort();
    attemptRef.current = null;
    stopTracks(streamRef.current);
    streamRef.current = null;
    setStream(null);
  }, []);

  const start = useCallback(
    (mode: FacingMode = "user") => {
      stop();
      setError(null);
      setFacingMode(mode);
      if (!supported) {
        setError(CAMERA_ERROR_MESSAGE);
        return;
      }
      const attempt = new AbortController();
      attemptRef.current = attempt;
      navigator.mediaDevices
        .getUserMedia({ video: { facingMode: mode, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
        .then((granted) => {
          if (attempt.signal.aborted) {
            stopTracks(granted);
            return;
          }
          streamRef.current = granted;
          setStream(granted);
        })
        .catch((cause: unknown) => {
          if (!attempt.signal.aborted) setError(cameraErrorMessage(cause));
        });
    },
    [stop, supported],
  );

  const switchCamera = useCallback(() => start(facingMode === "user" ? "environment" : "user"), [facingMode, start]);

  const capture = useCallback(
    (video: HTMLVideoElement): Promise<Blob | null> => {
      if (!video.videoWidth || !video.videoHeight) return Promise.resolve(null);
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext("2d");
      if (!context) return Promise.resolve(null);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    },
    [],
  );

  useEffect(() => stop, [stop]);

  return { supported, stream, error, facingMode, start, stop, switchCamera, capture };
}
