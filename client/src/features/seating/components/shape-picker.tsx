import { useId } from "react";
import { TABLE_SHAPE_LABELS, TABLE_SHAPES, tableLayout, type TableShape } from "@shared/domain/table-layout";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

/** A table's shape in miniature: its felt and six seats, as the plan draws it (shared/domain/table-layout). */
export function ShapeIcon({ shape, className }: { shape: TableShape; className?: string }) {
  const { felt, seats, width, height } = tableLayout(shape, 6);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className={cn("h-9 w-12", className)}>
      {felt.kind === "ellipse" ? (
        <ellipse cx={felt.cx} cy={felt.cy} rx={felt.rx} ry={felt.ry} strokeWidth={14} className="fill-primary/15 stroke-primary/60" />
      ) : (
        <rect x={felt.x} y={felt.y} width={felt.width} height={felt.height} rx={felt.radius} strokeWidth={14} className="fill-primary/15 stroke-primary/60" />
      )}
      {seats.map((seat) => (
        <circle key={seat.seatNumber} cx={seat.x} cy={seat.y} r={22} className="fill-foreground/70" />
      ))}
    </svg>
  );
}

interface ShapePickerProps {
  value: TableShape;
  onChange: (shape: TableShape) => void;
  /** The id of the label naming the choice ("Table shape"). */
  labelledBy: string;
  disabled?: boolean;
  testId?: string;
}

/** Oval, Rectangle or Round, each a 44 px+ tile with its drawing; the whole tile chooses it. */
export function ShapePicker({ value, onChange, labelledBy, disabled = false, testId }: ShapePickerProps) {
  const base = useId();
  return (
    <RadioGroup
      value={value}
      onValueChange={(next) => onChange(next as TableShape)}
      aria-labelledby={labelledBy}
      disabled={disabled}
      className="grid grid-cols-3 gap-2"
      data-testid={testId}
    >
      {TABLE_SHAPES.map((shape) => {
        const id = `${base}-${shape}`;
        return (
          <label
            key={shape}
            htmlFor={id}
            className={cn(
              "flex min-h-11 cursor-pointer flex-col items-center gap-1 rounded-lg border-2 px-2 py-2 text-sm font-medium text-foreground transition-colors",
              value === shape ? "border-primary bg-primary/5" : "border-border",
              disabled && "cursor-not-allowed opacity-60",
            )}
          >
            <ShapeIcon shape={shape} />
            <span className="flex items-center gap-2">
              <RadioGroupItem value={shape} id={id} />
              {TABLE_SHAPE_LABELS[shape]}
            </span>
          </label>
        );
      })}
    </RadioGroup>
  );
}
