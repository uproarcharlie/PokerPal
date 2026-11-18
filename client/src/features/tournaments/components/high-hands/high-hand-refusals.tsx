import { useToast } from "@/hooks/use-toast";
import { errorMessage, hasErrorCode } from "@/lib/api/http";

/**
 * A 409 HIGH_HAND_LISTED (round 10): this page was loaded before the tournament listed its high hands,
 * so what it sent no longer applies. The toast says so and offers to reload; true when it was that.
 */
export function useOutOfDateToast(): (error: unknown) => boolean {
  const { toast } = useToast();
  return (error) => {
    if (!hasErrorCode(error, "HIGH_HAND_LISTED")) return false;
    toast({
      title: "This page is out of date",
      description: errorMessage(error),
      variant: "destructive",
      action: { label: "Reload", onClick: () => window.location.reload() },
    });
    return true;
  };
}

/** The re-pricing question's words: each price it re-prices (both kinds: the tournament's and the high hands'), else the server's sentence. */
export function RepricingDescription({ message, lines }: { message: string; lines: readonly string[] }) {
  if (lines.length === 0) return <>{message}</>;
  return (
    <>
      <span className="block">This re-prices what is already recorded:</span>
      <ul role="list" className="mt-2 list-disc space-y-1 pl-5" data-testid="repricing-lines">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <span className="mt-2 block">The prize pool, the high-hand pots and what players owe change with it.</span>
    </>
  );
}
