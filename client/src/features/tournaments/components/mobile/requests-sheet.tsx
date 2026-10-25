import { useRef, type RefObject } from "react";
import { Link } from "wouter";
import { CheckCircle2 } from "lucide-react";
import { PhoneSheet, PhoneSheetBody, PhoneSheetHeader } from "@/components/shared/phone-sheet";
import { routes } from "@/app/routes";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { RequestList } from "../request-desk/request-list";

interface RequestsSheetProps {
  tournament: Pick<TournamentDetailDto, "id" | "rebuyAmount" | "addonAmount">;
  timeZone: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusTo?: RefObject<HTMLElement | null>;
}

/**
 * The request desk as a phone sheet (round5-contracts §8.1), from the header's badge or the quick
 * actions: the re-buys, add-ons and knockouts players asked for, each confirmed or dismissed with a thumb.
 */
export function RequestsSheet({ tournament, timeZone, open, onOpenChange, returnFocusTo }: RequestsSheetProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  return (
    <PhoneSheet side="bottom" open={open} onOpenChange={onOpenChange} returnFocusTo={returnFocusTo} initialFocus={heading}>
      <PhoneSheetHeader
        titleRef={heading}
        icon={<CheckCircle2 className="h-5 w-5 text-primary" aria-hidden="true" />}
        title="Player requests"
        description={
          <>
            Confirm each once it is paid for, or dismiss it.{" "}
            <Link href={routes.adminActions(tournament.id)} className="inline-flex min-h-11 items-center underline">
              Open the request desk
            </Link>
          </>
        }
      />
      <PhoneSheetBody>{open ? <RequestList tournament={tournament} timeZone={timeZone} /> : null}</PhoneSheetBody>
    </PhoneSheet>
  );
}
