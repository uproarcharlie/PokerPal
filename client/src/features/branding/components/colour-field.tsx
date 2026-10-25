import { useId } from "react";
import { X } from "lucide-react";
import type { HexColor } from "@shared/domain/theme";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface ColourFieldProps {
  label: string;
  /** What the colour is used for, under the box. */
  hint: string;
  /** What the box holds, as typed. */
  text: string;
  /** The colour the swatch shows: the last one that read (or, for an empty optional colour, the one it falls back to). */
  swatch: HexColor;
  /** The box's example text: "#1E7BFF", or what an empty optional colour falls back to ("Same as the main colour"). */
  placeholder?: string;
  error?: string;
  /** An optional colour can be emptied (it then falls back to another). */
  onClear?: () => void;
  onChange: (text: string) => void;
  /** The person left the box. */
  onBlur: () => void;
}

/**
 * One colour: the device's own colour picker (a 44 px swatch) and the "#RRGGBB" box beside it, both
 * for the same value, so a colour can be picked by eye or pasted from the club's brand guide.
 */
export function ColourField({ label, hint, text, swatch, placeholder = "#1E7BFF", error, onClear, onChange, onBlur }: ColourFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2 sm:max-w-md">
        <input
          type="color"
          aria-label={`Pick the ${label.toLowerCase()}`}
          value={swatch.toLowerCase()}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          onBlur={onBlur}
          className="h-11 w-11 shrink-0 cursor-pointer rounded-md border border-control bg-card p-1"
        />
        <Input
          id={id}
          value={text}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={9}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${errorId} ${hintId}` : hintId}
          className={cn("h-11 min-w-0 flex-1 font-mono", error && "border-destructive")}
        />
        {onClear && text !== "" ? (
          <Button type="button" variant="outline" size="icon" className="h-11 w-11 shrink-0" aria-label={`Clear the ${label.toLowerCase()}`} onClick={onClear}>
            <X aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      <p id={hintId} className="text-sm text-muted-foreground">
        {hint}
      </p>
      {error ? (
        <p id={errorId} className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
