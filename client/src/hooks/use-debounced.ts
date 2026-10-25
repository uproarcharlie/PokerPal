import { useEffect, useState } from "react";

/**
 * `value` once it has stayed the same for `ms`: a search sent once the typing pauses, a deal previewed
 * once the TD stops typing. One copy for every screen (R5REV3-CQ-09).
 */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}
