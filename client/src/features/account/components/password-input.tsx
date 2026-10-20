import { forwardRef, useState, type ComponentProps } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * A password box with a show/hide switch. Every prop goes to the <input> (so a FormControl's id and
 * aria-* land on it, and its label names it); the switch is named by hidden text rather than an
 * aria-label, so it never answers to the field's own label ("Password").
 */
export const PasswordInput = forwardRef<HTMLInputElement, Omit<ComponentProps<"input">, "type">>(function PasswordInput(
  { className, disabled, ...props },
  ref,
) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input ref={ref} type={shown ? "text" : "password"} className={cn("pr-11", className)} disabled={disabled} {...props} />
      <button
        type="button"
        onClick={() => setShown((current) => !current)}
        aria-pressed={shown}
        disabled={disabled}
        className="absolute right-0 top-0 flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        {shown ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
        <span className="sr-only">Show password</span>
      </button>
    </div>
  );
});
