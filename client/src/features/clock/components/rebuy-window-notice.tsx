import { AlertTriangle } from "lucide-react";
import type { LiveDisplayDto } from "@shared/api/live-display";
import type { ClockStructure } from "@shared/domain/clock";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useUpdateTournament } from "@/features/tournaments/staff-hooks";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api/http";
import { durationText, rebuyBreakEndMinutes } from "../structure-form";
import { rebuyWindowName } from "./public/display-stats";

interface RebuyWindowNoticeProps {
  tournament: LiveDisplayDto["tournament"];
  structure: Pick<ClockStructure, "levels">;
}

/**
 * Says when the TV's re-buy countdown (the tournament's re-buy period) would close re-buys at another
 * time than the structure's "Last re-buys / add-ons" break, and puts it right in one tap. A clock set
 * up from the Central Stars preset on this tab keeps the tournament's own period (the form's 60
 * minutes): the TV then said "Closed" an hour before the break that closes them (TDN3-REBUY-WINDOW-MISMATCH).
 */
export function RebuyWindowNotice({ tournament, structure }: RebuyWindowNoticeProps) {
  const { toast } = useToast();
  const update = useUpdateTournament(tournament.id);
  const sold = rebuyWindowName(tournament);
  const closesAt = rebuyBreakEndMinutes(structure.levels);
  if (sold === null || closesAt === null || tournament.rebuyPeriodMinutes === closesAt) return null;

  const period = tournament.rebuyPeriodMinutes;
  const countdown = period === null ? "shows no countdown for them (the tournament has no re-buy period)" : `closes them after ${durationText(period)}`;
  const align = () =>
    void update.mutateAsync({ rebuyPeriodMinutes: closesAt }).then(
      () => toast({ title: `${sold} now close at ${durationText(closesAt)}`, description: "The TV counts down to the end of the break." }),
      (error: unknown) => toast({ title: "Could not change the re-buy period", description: errorMessage(error), variant: "destructive" }),
    );

  return (
    <Alert role="note" data-testid="rebuy-window-notice">
      <AlertTriangle className="h-4 w-4" aria-hidden="true" />
      <AlertTitle>The TV closes {sold.toLowerCase()} at another time</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>
          The structure&apos;s &ldquo;Last re-buys / add-ons&rdquo; break ends {durationText(closesAt)} into the game, but the TV {countdown}.
        </p>
        <Button size="sm" variant="outline" className="h-auto min-h-11 whitespace-normal text-left" busy={update.isPending} onClick={align}>
          Close them with the break ({durationText(closesAt)})
        </Button>
      </AlertDescription>
    </Alert>
  );
}
