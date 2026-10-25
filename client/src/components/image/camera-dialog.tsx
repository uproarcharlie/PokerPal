import { useEffect, useRef, useState, type RefObject } from "react";
import { Camera, RotateCcw, SwitchCamera, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useCameraCapture, type FacingMode } from "./use-camera-capture";

interface CameraDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The photo, as a JPEG. */
  onCapture: (photo: Blob) => void;
  /** "Upload a photo instead", when the camera cannot be opened. */
  onChooseFile: () => void;
  /** The dialog's name: "Take a selfie" when the player is taking their own. */
  title?: string;
  /** The camera it opens with: the front one (a selfie) unless staff photograph someone else. */
  facing?: FacingMode;
  /** Where focus goes on close when what opened the dialog is gone. */
  returnFocusTo?: RefObject<HTMLElement | null>;
}

/**
 * A circle for the face over the camera's picture, the rest dimmed: drawn in the picture's own
 * coordinates and fitted as the video is (contain), so it sits on the picture whatever its shape. Its
 * width is the picture's short side, nearly: what the square crop step starts from.
 */
function FaceGuide({ width, height }: { width: number; height: number }) {
  const radius = Math.min(width, height) * 0.45;
  const [cx, cy] = [width / 2, height / 2];
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      className="pointer-events-none absolute inset-0 h-full w-full"
      data-testid="face-guide"
    >
      <path
        fillRule="evenodd"
        fill="rgb(0 0 0 / 0.35)"
        d={`M0 0H${width}V${height}H0Z M${cx - radius} ${cy}a${radius} ${radius} 0 1 0 ${2 * radius} 0a${radius} ${radius} 0 1 0 ${-2 * radius} 0Z`}
      />
      <circle cx={cx} cy={cy} r={radius} fill="none" stroke="white" strokeOpacity={0.85} strokeWidth={Math.min(width, height) * 0.012} />
    </svg>
  );
}

/**
 * The live camera in a dialog of its own, the whole screen on a phone, opening the front camera (unless
 * told otherwise) with a mirrored preview and a circle to put a face in (what the square, round-framed
 * player photo keeps).
 * When the camera cannot be opened it says why and offers an upload instead. Escape and the close
 * button close only this dialog, never a form sheet it was opened from (Radix stacks the layers).
 */
export function CameraDialog({
  open,
  onOpenChange,
  onCapture,
  onChooseFile,
  title = "Take a photo",
  facing = "user",
  returnFocusTo,
}: CameraDialogProps) {
  const camera = useCameraCapture();
  const { start, stop, stream } = camera;
  const videoRef = useRef<HTMLVideoElement>(null);
  // The first frame has arrived, at this size: until then there is nothing to capture (videoWidth is 0).
  const [readyStream, setReadyStream] = useState<MediaStream | null>(null);
  const [frame, setFrame] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    start(facing);
    return stop;
  }, [open, facing, start, stop]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    if (stream) video.play?.().catch(() => {});
  }, [stream]);

  const ready = stream !== null && readyStream === stream;

  const capture = async () => {
    const video = videoRef.current;
    if (!video) return;
    const photo = await camera.capture(video);
    if (!photo) return;
    onOpenChange(false);
    onCapture(photo);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-dvh max-h-dvh max-w-none flex-col gap-4 rounded-none border-0 bg-black p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-white sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:max-w-xl sm:rounded-lg sm:border sm:p-6"
        returnFocusTo={returnFocusTo}
      >
        <DialogTitle className="pr-10 text-white">{title}</DialogTitle>
        <DialogDescription className="sr-only">
          {camera.facingMode === "user" ? "Put your face in the circle, then press Capture." : "Point the camera, then press Capture."}
        </DialogDescription>
        {camera.error ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 py-6 text-center">
            <Camera className="h-10 w-10 opacity-70" aria-hidden="true" />
            <p role="alert" className="max-w-sm text-base">
              {camera.error}
            </p>
            <div className="flex w-full max-w-sm flex-col gap-2">
              <Button
                type="button"
                className="h-12"
                onClick={() => {
                  onOpenChange(false);
                  onChooseFile();
                }}
              >
                <Upload aria-hidden="true" />
                Upload a photo instead
              </Button>
              <Button type="button" variant="outline" className="h-12 text-foreground" onClick={() => start(camera.facingMode)}>
                <RotateCcw aria-hidden="true" />
                Try again
              </Button>
              <Button type="button" variant="ghost" className="h-12 text-white hover:text-foreground" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          <>
            {/* On a phone the picture fills the space above the buttons; in the dialog it sets its own height. */}
            <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg bg-black sm:flex-none">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                onLoadedData={(event) => {
                  setReadyStream(stream);
                  setFrame({ width: event.currentTarget.videoWidth, height: event.currentTarget.videoHeight });
                }}
                className={cn(
                  "absolute inset-0 h-full w-full object-contain sm:static sm:h-auto sm:max-h-[65dvh]",
                  camera.facingMode === "user" && "-scale-x-100",
                )}
              />
              {ready && frame && camera.facingMode === "user" ? <FaceGuide {...frame} /> : null}
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <Button type="button" variant="outline" className="h-12 text-foreground" onClick={() => onOpenChange(false)}>
                <X aria-hidden="true" />
                Cancel
              </Button>
              <Button type="button" className="h-14 flex-1 text-base [&_svg]:size-5" onClick={() => void capture()} disabled={!ready}>
                <Camera aria-hidden="true" />
                Capture
              </Button>
              <Button type="button" variant="outline" className="h-12 w-12 text-foreground" onClick={camera.switchCamera} aria-label="Switch camera">
                <SwitchCamera aria-hidden="true" />
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
