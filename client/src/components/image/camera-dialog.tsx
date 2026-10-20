import { useEffect, useRef, useState, type RefObject } from "react";
import { Camera, SwitchCamera, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useCameraCapture } from "./use-camera-capture";

interface CameraDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The photo, as a JPEG. */
  onCapture: (photo: Blob) => void;
  /** "Upload instead", when the camera cannot be opened. */
  onChooseFile: () => void;
  /** Where focus goes on close when what opened the dialog is gone. */
  returnFocusTo?: RefObject<HTMLElement | null>;
}

/**
 * The live camera in a dialog of its own. Escape and the close button close only this dialog, never a
 * form sheet it was opened from (Radix stacks the layers).
 */
export function CameraDialog({ open, onOpenChange, onCapture, onChooseFile, returnFocusTo }: CameraDialogProps) {
  const camera = useCameraCapture();
  const { start, stop, stream } = camera;
  const videoRef = useRef<HTMLVideoElement>(null);
  // The first frame has arrived: until then there is nothing to capture (videoWidth is 0).
  const [readyStream, setReadyStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    if (!open) return;
    start("user");
    return stop;
  }, [open, start, stop]);

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
      <DialogContent className="max-w-lg bg-black text-white sm:max-w-xl" returnFocusTo={returnFocusTo}>
        <DialogTitle className="text-white">Take a photo</DialogTitle>
        <DialogDescription className="sr-only">Point the camera, then press Capture.</DialogDescription>
        {camera.error ? (
          <div className="space-y-4 py-6 text-center">
            <Camera className="mx-auto h-10 w-10 opacity-70" aria-hidden="true" />
            <p role="alert" className="text-sm">
              {camera.error}
            </p>
            <div className="flex justify-center gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  onOpenChange(false);
                  onChooseFile();
                }}
              >
                <Upload className="mr-2 h-4 w-4" aria-hidden="true" />
                Upload instead
              </Button>
              <Button type="button" variant="outline" className="text-foreground" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              onLoadedData={() => setReadyStream(stream)}
              className={cn("max-h-[65dvh] w-full rounded-lg bg-black object-contain", camera.facingMode === "user" && "-scale-x-100")}
            />
            <div className="flex items-center gap-3">
              <Button type="button" variant="outline" className="text-foreground" onClick={() => onOpenChange(false)}>
                <X className="mr-2 h-4 w-4" aria-hidden="true" />
                Cancel
              </Button>
              <Button type="button" onClick={() => void capture()} disabled={!ready}>
                <Camera className="mr-2 h-4 w-4" aria-hidden="true" />
                Capture
              </Button>
              <Button type="button" variant="outline" className="text-foreground" onClick={camera.switchCamera} aria-label="Switch camera">
                <SwitchCamera className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
