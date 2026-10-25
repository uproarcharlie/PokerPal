import { useForm } from "react-hook-form";
import { z } from "zod";
import { CLOCK_LIMITS, formatClock } from "@shared/domain/clock";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { errorMessage, hasErrorCode } from "@/lib/api/http";
import { formResolver } from "@/lib/forms";

/** "12" (minutes), "12:30" or "1:02:30" in seconds; null for anything else. */
export function parseClockTime(text: string): number | null {
  const parts = text.trim().split(":");
  if (parts.length > 3 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null;
  const numbers = parts.map(Number);
  if (numbers.length === 1) return numbers[0] * 60;
  const [seconds, minutes, hours = 0] = numbers.reverse();
  if (seconds > 59 || (parts.length === 3 && minutes > 59)) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

const MAX_SECONDS = CLOCK_LIMITS.maxRemainingMs / 1000;

const setTimeSchema = z.object({
  time: z
    .string()
    .trim()
    .min(1, "Required")
    .transform((text, ctx) => {
      const seconds = parseClockTime(text);
      if (seconds === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Type minutes, or minutes and seconds, e.g. 12:30" });
        return z.NEVER;
      }
      return seconds;
    })
    .pipe(z.number().max(MAX_SECONDS, `At most ${formatClock(CLOCK_LIMITS.maxRemainingMs)}`)),
});

/** The level the dialog sets the time of: the one on screen when it opened. */
export interface SetTimeLevel {
  levelIndex: number;
  /** "Level 3", for the title. */
  levelName: string;
}

interface SetTimeDialogProps {
  /** Open for this level; null closes it. */
  level: SetTimeLevel | null;
  onClose: () => void;
  remainingMs: number;
  busy: boolean;
  /** Sets the time left of `level`; rejects with the server's refusal (LEVEL_CHANGED once that level has ended). */
  onSet: (remainingSeconds: number) => Promise<void>;
}

/**
 * Sets exactly how long a level has left (after a dispute, or a clock started late). It sets the level
 * that was on screen when it opened: when that level ends while the TD types, nothing is changed, the
 * dialog says so and names the level now on screen, and setting again applies to that one.
 */
export function SetTimeDialog({ level, onClose, ...props }: SetTimeDialogProps) {
  return (
    <Dialog open={level !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">{level ? <SetTimeForm {...props} level={level} onDone={onClose} /> : null}</DialogContent>
    </Dialog>
  );
}

const LEVEL_MOVED = "The clock moved on to another level, so the time was not set. Check the level above and set it again.";

function SetTimeForm({ level, remainingMs, busy, onSet, onDone }: Omit<SetTimeDialogProps, "level" | "onClose"> & { level: SetTimeLevel; onDone: () => void }) {
  const form = useForm<{ time: string }>({ resolver: formResolver(setTimeSchema), defaultValues: { time: formatClock(remainingMs) } });
  const submit = form.handleSubmit(async (values) => {
    try {
      await onSet(setTimeSchema.parse(values).time);
    } catch (error) {
      form.setError("time", { message: hasErrorCode(error, "LEVEL_CHANGED") ? LEVEL_MOVED : errorMessage(error) });
      return;
    }
    onDone();
  });
  return (
    <Form {...form}>
      <form onSubmit={submit} noValidate>
        <DialogHeader>
          <DialogTitle>Set the time left</DialogTitle>
          <DialogDescription>How long {level.levelName} has left. The clock carries on as it was (running or paused).</DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <FormField
            control={form.control}
            name="time"
            render={({ field }) => (
              <FormItem required>
                <FormLabel>Time left</FormLabel>
                <FormControl>
                  <Input autoComplete="off" {...field} />
                </FormControl>
                <FormDescription>Minutes and seconds, e.g. 12:30</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" busy={busy}>
            Set time
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
