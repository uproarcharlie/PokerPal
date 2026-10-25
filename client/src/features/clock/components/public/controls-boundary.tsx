import { Suspense, useEffect, type ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { SectionErrorBoundary } from "@/app/error-boundary";
import { Button } from "@/components/ui/button";
import { keepFocusOnMouseDown } from "./keep-focus";

/** How long the TV waits before it tries the staff's controls again on its own. */
export const CONTROLS_RETRY_MS = 15_000;

/**
 * Says the staff's controls did not load (their script did not arrive over the venue's Wi-Fi, or they
 * failed), tries again every CONTROLS_RETRY_MS, and offers Retry: nobody may be at the TV to reload it,
 * and without the controls Space and the arrows silently do nothing (TDN2-CONTROLS-CHUNK-SILENT).
 */
function ControlsFailed({ retry }: { retry: () => void }) {
  useEffect(() => {
    const timer = setTimeout(retry, CONTROLS_RETRY_MS);
    return () => clearTimeout(timer);
  }, [retry]);
  return (
    <div
      role="alert"
      className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-40 flex items-center gap-3 rounded-full border border-destructive bg-card py-1.5 pl-4 pr-1.5 text-sm font-semibold text-foreground shadow-lg"
    >
      The clock controls didn&apos;t load
      <Button variant="outline" size="sm" className="rounded-full" onMouseDown={keepFocusOnMouseDown} onClick={retry}>
        <RotateCcw aria-hidden="true" />
        Retry
      </Button>
    </div>
  );
}

/** The staff's controls on the TV, loaded on demand: nothing shows while they load, and a failure says so. */
export function ControlsBoundary({ children }: { children: ReactNode }) {
  return (
    <SectionErrorBoundary fallback={(retry) => <ControlsFailed retry={retry} />}>
      <Suspense fallback={null}>{children}</Suspense>
    </SectionErrorBoundary>
  );
}
