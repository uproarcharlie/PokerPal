import { useEffect, useState } from "react";

/** The time now, as of the last tick every `periodMs`: for a label that changes with time ("2 minutes ago"). */
export function useNow(periodMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), periodMs);
    return () => clearInterval(timer);
  }, [periodMs]);
  return now;
}
