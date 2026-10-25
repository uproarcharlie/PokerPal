import { memo, useId } from "react";
import type { PublicRegistration } from "@shared/api/public";
import { formatChips } from "@shared/domain/clock";
import { LoadingRows } from "@/components/shared/query-state";
import { ScrollRegion } from "@/components/shared/scroll-region";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useBusyRows } from "@/hooks/use-busy-rows";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api/http";
import { formatTime, plural } from "@/lib/format";
import { useRegistrations } from "@/features/tournaments/hooks";
import { playerName } from "@/features/tournaments/player-name";
import { useEarlyBirds } from "../staff-hooks";

/**
 * Whether the entry has not paid yet, as the club's staff get the list (ManagedRegistration): an online
 * sign-up who never came, until the desk takes their money.
 */
const unpaid = (registration: PublicRegistration) => "paymentConfirmed" in registration && registration.paymentConfirmed === false;

/**
 * The entries that registered by the start time and have no bonus yet: `paid`, the ones the bulk button
 * gives it to, and `unpaid`, left out (their 25,000 would count in the chips in play and the average
 * stack for players who may never come: TDN3-EARLYBIRD-UNPAID) until they pay or the TD ticks them.
 */
export function earlyRegistrations(registrations: readonly PublicRegistration[], startDateTime: string): { paid: PublicRegistration[]; unpaid: PublicRegistration[] } {
  const start = Date.parse(startDateTime);
  const early = registrations.filter(
    (registration) => !registration.earlyBird && registration.registrationTime !== null && Date.parse(registration.registrationTime) <= start,
  );
  return { paid: early.filter((registration) => !unpaid(registration)), unpaid: early.filter(unpaid) };
}

const byName = (a: PublicRegistration, b: PublicRegistration) => playerName(a).localeCompare(playerName(b));

interface EarlyBirdsCardProps {
  tournamentId: string;
  startDateTime: string;
  earlyBirdStack: number | null;
  timeZone: string;
}

/**
 * The early-bird bonus: extra chips (never money) for the players who were registered before the
 * start. Each tick gives or takes back one player's bonus at once; one button gives it to everyone
 * registered by the start time who has paid, and its toast can take that back in one tap.
 */
export const EarlyBirdsCard = memo(function EarlyBirdsCard({ tournamentId, startDateTime, earlyBirdStack, timeZone }: EarlyBirdsCardProps) {
  const { toast } = useToast();
  const registrations = useRegistrations(tournamentId);
  const earlyBirds = useEarlyBirds(tournamentId);
  const { busy, run } = useBusyRows();
  const id = useId();
  const list = [...(registrations.data ?? [])].sort(byName);
  const given = list.filter((registration) => registration.earlyBird).length;
  const early = earlyRegistrations(list, startDateTime);

  /**
   * Gives or takes back the bonus; the bulk button says how many it changed, and offers to take back
   * from exactly those (never from players who had it before); a single tick shows itself.
   */
  const set = (rowId: string, registrationIds: string[], earlyBird: boolean, { announce = false } = {}): void =>
    void run(rowId, () => earlyBirds.mutateAsync({ registrationIds, earlyBird })).then(
      (result) => {
        const count = result.changed.length;
        if (!announce) return;
        toast({
          title: earlyBird ? `Early-bird bonus given to ${plural(count, "player")}` : `Early-bird bonus taken back from ${plural(count, "player")}`,
          action: earlyBird && count > 0 ? { label: "Undo", onClick: () => set(rowId, result.changed, false, { announce: true }) } : undefined,
        });
      },
      (error: unknown) => toast({ title: "Could not change the early birds", description: errorMessage(error), variant: "destructive" }),
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Early birds</CardTitle>
        <CardDescription>
          {earlyBirdStack === null
            ? `${plural(given, "player")} with the bonus. Set the early-bird bonus in the structure to count its chips.`
            : `Early birds: ${String(given)} × ${formatChips(earlyBirdStack)}`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {registrations.isPending ? (
          <LoadingRows rows={2} />
        ) : registrations.isError && !registrations.data ? (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(registrations.error, "The players could not be loaded")}
          </p>
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody has registered yet.</p>
        ) : (
          <>
            <Button
              variant="outline"
              className="h-auto min-h-10 whitespace-normal text-left"
              busy={busy.has("before-start")}
              aria-disabled={early.paid.length === 0 || undefined}
              aria-describedby={early.unpaid.length > 0 ? `${id}-unpaid` : undefined}
              onClick={() => {
                if (early.paid.length > 0) set("before-start", early.paid.map((registration) => registration.id), true, { announce: true });
              }}
            >
              {early.paid.length === 0
                ? "Everyone registered before the start who has paid has the bonus"
                : `Give it to everyone registered before the start who has paid (${String(early.paid.length)})`}
            </Button>
            {early.unpaid.length > 0 ? (
              <p id={`${id}-unpaid`} className="text-sm text-muted-foreground">
                Left out: {plural(early.unpaid.length, "player")} registered before the start who {early.unpaid.length === 1 ? "has" : "have"} not paid. Tick them once they pay.
              </p>
            ) : null}
            <ScrollRegion label="Players" className="max-h-80 overflow-y-auto rounded-md border border-border">
              <ul role="list" className="divide-y divide-border">
                {list.map((registration) => {
                  const checkboxId = `${id}-${registration.id}`;
                  return (
                    <li key={registration.id} className="flex items-center gap-3 px-3 py-2">
                      <Checkbox
                        id={checkboxId}
                        checked={registration.earlyBird}
                        aria-busy={busy.has(registration.id) || undefined}
                        onCheckedChange={(checked) => {
                          if (!busy.has(registration.id)) set(registration.id, [registration.id], checked === true);
                        }}
                      />
                      <Label htmlFor={checkboxId} className="flex flex-1 justify-between gap-3 font-normal">
                        <span>
                          {playerName(registration)}
                          {unpaid(registration) ? <span className="ml-2 text-xs font-medium text-status-scheduled-foreground">not paid</span> : null}
                        </span>
                        {registration.registrationTime ? (
                          <span className="text-xs text-muted-foreground">registered {formatTime(registration.registrationTime, timeZone)}</span>
                        ) : null}
                      </Label>
                    </li>
                  );
                })}
              </ul>
            </ScrollRegion>
          </>
        )}
      </CardContent>
    </Card>
  );
});
