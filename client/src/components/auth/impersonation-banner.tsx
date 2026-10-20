import { useState } from "react";
import { Eye, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";

/**
 * Shown on every page while an admin views the app as someone else, with the way back (SEC-13). It
 * floats over the page rather than taking space, so no layout changes while it is up. It keeps the
 * platform's warning colours on purpose: a club's theme must never disguise it.
 */
export function ImpersonationBanner() {
  const { user, impersonator, stopImpersonation } = useAuth();
  const [stopping, setStopping] = useState(false);

  if (!user || !impersonator) return null;

  const stop = async () => {
    setStopping(true);
    try {
      await stopImpersonation();
    } finally {
      setStopping(false);
    }
  };

  return (
    <div
      role="status"
      aria-label="Impersonation"
      className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-full border border-orange-500 bg-orange-50 py-2 pl-4 pr-2 text-sm text-orange-900 shadow-lg dark:bg-orange-950 dark:text-orange-100"
    >
      <Eye className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="truncate">
        Viewing as <strong>{user.name}</strong>
        <span className="hidden sm:inline"> (you are {impersonator.name})</span>
      </span>
      <Button size="sm" variant="outline" className="rounded-full" onClick={() => void stop()} busy={stopping}>
        {stopping ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        Exit
      </Button>
    </div>
  );
}
