import { useState } from "react";
import { useLocation, useSearch } from "wouter";

/**
 * A list page's create dialog, which a club page's link can open with that club chosen
 * (`?create=<clubId>`, from `routes.tournaments(clubId)` / `routes.seasons(clubId)`). Once the dialog
 * closes the link has done its job: it leaves the address, so a reload or Back starts from the plain
 * list at `listPath`.
 */
export function useCreateFromLink(listPath: string) {
  const [, navigate] = useLocation();
  const clubId = new URLSearchParams(useSearch()).get("create") || undefined;
  const [open, setOpenState] = useState(clubId !== undefined);
  const setOpen = (next: boolean) => {
    setOpenState(next);
    if (!next && clubId) navigate(listPath, { replace: true });
  };
  return { clubId, open, setOpen };
}
