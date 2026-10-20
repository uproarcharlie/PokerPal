import { useCallback, useState } from "react";

/**
 * The rows of a list whose own request is still on its way: each row's buttons wait for its own answer,
 * and every answer reaches its own row. A desk's rows share one mutation, and TanStack Query runs only
 * the latest call's `mutate(…, { onSuccess, onError })` callbacks: a TD who confirmed a second row
 * before the first answer came lost the first one's refusal, re-entry question and toast, and the
 * first row's buttons came back while it was still in flight (P3REV0-PARITY-03). `run` awaits the
 * call's own promise instead (`mutateAsync`), which settles for every call.
 */
export function useBusyRows() {
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());

  const run = useCallback(async <T>(rowId: string, request: () => Promise<T>): Promise<T> => {
    setBusy((current) => new Set(current).add(rowId));
    try {
      return await request();
    } finally {
      setBusy((current) => {
        const next = new Set(current);
        next.delete(rowId);
        return next;
      });
    }
  }, []);

  return { busy, run };
}
