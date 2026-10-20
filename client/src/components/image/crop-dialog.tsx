import { useId, useState, type CSSProperties, type RefObject } from "react";
import Cropper, { type Area, type Point } from "react-easy-crop";
import "react-easy-crop/react-easy-crop.css";
import type { CropFractions } from "@shared/domain/images";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";

interface CropDialogProps {
  /**
   * The picture to crop (an object URL the caller owns and revokes); null closes the dialog. Render
   * with `key={imageUrl}` so each picture starts uncropped and unzoomed.
   */
  imageUrl: string | null;
  /** Width / height of the part kept: 1 for a player photo, 3 for a club banner, 16/9 for a tournament. */
  aspect: number;
  round?: boolean;
  title?: string;
  /** Where focus goes on close when what opened the dialog is gone. */
  returnFocusTo?: RefObject<HTMLElement | null>;
  onCancel: () => void;
  /** The part to keep as fractions of the upright image; undefined when the cropper never measured it. */
  onConfirm: (crop: CropFractions | undefined) => void;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * The dialog fades in without the zoom and slide the other dialogs open with. The cropper measures its
 * box once, as the picture loads (within those 200 ms for a picture already in memory): a box still
 * scaled to 95% made it keep about 5% more of the picture than the frame showed, and the frame could
 * never reach the picture's edges (IMG-REV3-01).
 */
export const STEADY_ENTRY = {
  "--tw-enter-scale": "1",
  "--tw-enter-translate-x": "-50%",
  "--tw-enter-translate-y": "-50%",
} as CSSProperties;

/** react-easy-crop's area, in percent of the picture, as the fractions the upload endpoint takes. */
export function cropFractions(area: Area): CropFractions {
  const x = clamp01(area.x / 100);
  const y = clamp01(area.y / 100);
  return {
    x,
    y,
    width: Math.max(Number.EPSILON, Math.min(1 - x, area.width / 100)),
    height: Math.max(Number.EPSILON, Math.min(1 - y, area.height / 100)),
  };
}

/** Lets someone frame a picture to the shape it is shown in, before it is uploaded. */
export function CropDialog({
  imageUrl,
  aspect,
  round = false,
  title = "Position your picture",
  returnFocusTo,
  onCancel,
  onConfirm,
}: CropDialogProps) {
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | undefined>(undefined);
  const descriptionId = useId();

  return (
    <Dialog open={imageUrl !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-lg" style={STEADY_ENTRY} returnFocusTo={returnFocusTo} data-testid="crop-dialog">
        <DialogTitle>{title}</DialogTitle>
        {/* The description keeps Radix's own id, which the dialog is described by; the frame is described
            by the words inside it. Overriding the description's id left the dialog pointing at nothing
            (P3REV-IMG-CROP-DESC). */}
        <DialogDescription>
          <span id={descriptionId}>
            Drag to move it (or use the arrow keys) and the slider to zoom. Only the part inside the frame is kept.
          </span>
        </DialogDescription>
        {/* Sized to the screen too, so Use this stays on screen on a phone held sideways (MA-10). */}
        <div className="relative h-[min(18rem,45dvh)] w-full overflow-hidden rounded-md bg-muted sm:h-[min(20rem,45dvh)]">
          {imageUrl ? (
            <Cropper
              image={imageUrl}
              crop={crop}
              zoom={zoom}
              aspect={aspect}
              cropShape={round ? "round" : "rect"}
              showGrid={!round}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(percentages) => setArea(percentages)}
              disableAutomaticStylesInjection
              mediaProps={{ alt: "" }}
              // The frame is a keyboard control (the arrow keys move the picture): named for screen readers (MA-12).
              cropperProps={{ role: "group", "aria-label": "Picture frame", "aria-describedby": descriptionId }}
            />
          ) : null}
        </div>
        <label className="flex items-center gap-3 text-sm">
          <span className="shrink-0 text-muted-foreground">Zoom</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.05}
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
            className="w-full accent-primary"
          />
        </label>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={() => onConfirm(area ? cropFractions(area) : undefined)}>
            Use this
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
