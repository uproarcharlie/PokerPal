import { useState, useRef, useEffect } from "react";
import { Upload, X, ImageIcon, Camera, SwitchCamera } from "lucide-react";
import { Button } from "./button";
import { throwIfResNotOk } from "@/lib/queryClient";
import type { ImageUploadResponse } from "@shared/api/images";
import {
  HEIC_IMAGE_TYPES,
  HEIC_MESSAGE,
  MAX_IMAGE_UPLOAD_BYTES,
  UNSUPPORTED_TYPE_MESSAGE,
  type ImageKind,
} from "@shared/domain/images";

interface ImageUploadProps {
  onImageUpload: (url: string) => void;
  currentImage?: string | null;
  /** What the image is for: decides how the server crops and sizes it. Only player_avatar may be uploaded signed out. */
  kind: ImageKind;
  placeholder?: string;
  onUploadingChange?: (uploading: boolean) => void;
}

const HEIC_TYPES: ReadonlySet<string> = new Set(HEIC_IMAGE_TYPES);

/** POST /api/images/:kind; the stored URL, or an ApiRequestError carrying the server's sentence (413, 415, 429...). */
async function uploadImage(kind: ImageKind, file: File): Promise<string> {
  const formData = new FormData();
  formData.append("image", file);
  const response = await fetch(`/api/images/${kind}`, { method: "POST", body: formData, credentials: "include" });
  await throwIfResNotOk(response);
  const body = (await response.json()) as ImageUploadResponse;
  return body.url;
}

export function ImageUpload({ onImageUpload, currentImage, kind, placeholder, onUploadingChange }: ImageUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(currentImage || null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Live camera state
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [streamReady, setStreamReady] = useState(false);
  // The first frame has arrived: until then there is nothing to capture (videoWidth is 0).
  const [videoReady, setVideoReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const supportsCamera = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStreamReady(false);
    setVideoReady(false);
  };

  const startCamera = async (mode: "user" | "environment") => {
    setCameraError(null);
    try {
      stopStream();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode },
        audio: false,
      });
      streamRef.current = stream;
      setStreamReady(true);
    } catch (err) {
      console.error("Camera error:", err);
      setCameraError("Couldn't access the camera. Allow camera permission, or use Upload instead.");
    }
  };

  const openCamera = () => {
    // No getUserMedia (very old browser) → fall back to the native capture input,
    // which still opens the camera on mobile.
    if (!supportsCamera) {
      cameraInputRef.current?.click();
      return;
    }
    setCameraOpen(true);
    startCamera(facingMode);
  };

  const closeCamera = () => {
    stopStream();
    setCameraOpen(false);
    setCameraError(null);
  };

  const switchCamera = () => {
    const next = facingMode === "user" ? "environment" : "user";
    setFacingMode(next);
    startCamera(next);
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" });
        closeCamera();
        handleFile(file);
      },
      "image/jpeg",
      0.92,
    );
  };

  // Attach the stream to the <video> once both exist.
  useEffect(() => {
    if (cameraOpen && streamReady && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play?.().catch(() => {});
    }
  }, [cameraOpen, streamReady]);

  // Close on Escape while the camera is open.
  useEffect(() => {
    if (!cameraOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeCamera();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cameraOpen]);

  // Always stop the camera when unmounting.
  useEffect(() => () => stopStream(), []);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);

    // The server decides by the file's bytes; these only save a pointless upload.
    if (HEIC_TYPES.has(file.type.toLowerCase())) {
      setError(HEIC_MESSAGE);
      return;
    }
    if (!file.type.startsWith('image/')) {
      setError(UNSUPPORTED_TYPE_MESSAGE);
      return;
    }
    if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
      setError('File size must be less than 5MB');
      return;
    }

    // Show preview
    const reader = new FileReader();
    reader.onloadend = () => {
      setPreview(reader.result as string);
    };
    reader.readAsDataURL(file);

    // Upload to server
    setUploading(true);
    onUploadingChange?.(true);
    try {
      onImageUpload(await uploadImage(kind, file));
    } catch (uploadError) {
      setError(uploadError instanceof Error && uploadError.message ? uploadError.message : 'Failed to upload image');
      setPreview(currentImage || null);
    } finally {
      setUploading(false);
      onUploadingChange?.(false);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    handleFile(event.target.files?.[0]);
    // Reset so selecting/capturing the same file again still fires onChange
    event.target.value = '';
  };

  const handleRemove = () => {
    setError(null);
    setPreview(null);
    onImageUpload('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  };

  return (
    <div className="space-y-4">
      {/* Upload from files */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
        disabled={uploading}
        aria-label="Choose an image"
      />
      {/* Native capture fallback for browsers without getUserMedia */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="user"
        onChange={handleFileSelect}
        className="hidden"
        disabled={uploading}
      />

      {preview ? (
        <div className="relative group">
          <img
            src={preview}
            alt="Upload preview"
            className="w-full h-48 object-cover rounded-lg border-2 border-border"
          />
          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={openCamera}
              disabled={uploading}
            >
              <Camera className="w-4 h-4 mr-2" />
              Retake
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              <Upload className="w-4 h-4 mr-2" />
              Change
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleRemove}
              disabled={uploading}
            >
              <X className="w-4 h-4 mr-2" />
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="w-full h-48 border-2 border-dashed border-border rounded-lg hover:border-primary hover:bg-muted/50 transition-colors flex flex-col items-center justify-center gap-2 text-muted-foreground hover:text-foreground"
          >
            <ImageIcon className="w-12 h-12" />
            <div className="text-sm font-medium">
              {uploading ? 'Uploading...' : placeholder || 'Click to upload image'}
            </div>
            <div className="text-xs text-muted-foreground">
              PNG, JPG, GIF or WebP (max 5MB)
            </div>
          </button>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={openCamera}
              disabled={uploading}
            >
              <Camera className="w-4 h-4 mr-2" />
              Take Photo
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              <Upload className="w-4 h-4 mr-2" />
              Upload
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive" data-testid="image-upload-error">
          {error}
        </p>
      )}

      {/* Live camera overlay */}
      {cameraOpen && (
        <div
          className="fixed inset-0 z-[100] bg-black/90 flex flex-col items-center justify-center p-4"
          role="dialog"
          aria-label="Take a photo"
        >
          {cameraError ? (
            <div className="text-center text-white space-y-4 max-w-sm">
              <Camera className="w-10 h-10 mx-auto opacity-70" />
              <p className="text-sm">{cameraError}</p>
              <div className="flex gap-2 justify-center">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    closeCamera();
                    fileInputRef.current?.click();
                  }}
                >
                  <Upload className="w-4 h-4 mr-2" />
                  Upload instead
                </Button>
                <Button type="button" variant="outline" onClick={closeCamera}>
                  Close
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4 w-full max-w-lg">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                onLoadedData={() => setVideoReady(true)}
                className="w-full max-h-[70vh] rounded-lg bg-black object-contain"
              />
              <div className="flex items-center gap-3">
                <Button type="button" variant="outline" onClick={closeCamera}>
                  <X className="w-4 h-4 mr-2" />
                  Cancel
                </Button>
                <Button type="button" onClick={capturePhoto} disabled={!videoReady}>
                  <Camera className="w-4 h-4 mr-2" />
                  Capture
                </Button>
                <Button type="button" variant="outline" onClick={switchCamera} title="Switch camera">
                  <SwitchCamera className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
