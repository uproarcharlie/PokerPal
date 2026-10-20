import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MoneyText } from "@/components/shared/money-text";
import { SmartImage } from "@/components/image/smart-image";
import { formatDateTime } from "@/lib/format";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { offersAddons, offersHighHand, offersRebuys } from "@shared/domain/player-actions";

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 sm:flex-col sm:gap-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium text-foreground sm:text-left">{children}</dd>
    </div>
  );
}

/** When it starts (in the club's time zone), what it costs, and what it says about itself. */
export function TournamentInfoCard({ tournament, timeZone }: { tournament: TournamentDetailDto; timeZone: string }) {
  return (
    <Card>
      <CardHeader className="border-b border-border">
        <CardTitle>Tournament Info</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 p-4 md:p-6">
        {/* The image is its own 16:9 box: a missing or broken one leaves nothing behind (IMG-P3-04). */}
        <SmartImage
          src={tournament.imageUrl}
          alt=""
          width={448}
          height={252}
          className="aspect-video h-auto w-full max-w-md rounded-lg bg-muted object-cover"
        />
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <Fact label="Start Time">{formatDateTime(tournament.startDateTime, timeZone)}</Fact>
          <Fact label="Buy-in">
            <MoneyText amount={tournament.buyInAmount} forceCents />
          </Fact>
          {offersRebuys(tournament) ? (
            <Fact label="Re-buy">
              <MoneyText amount={tournament.rebuyAmount} forceCents />
            </Fact>
          ) : null}
          {offersAddons(tournament) ? (
            <Fact label="Add-on">
              <MoneyText amount={tournament.addonAmount} forceCents />
            </Fact>
          ) : null}
          <Fact label="Max Players">{tournament.maxPlayers}</Fact>
          {offersHighHand(tournament) ? (
            <Fact label="High Hand Entry Fee">
              <MoneyText amount={tournament.highHandAmount} forceCents />
            </Fact>
          ) : null}
        </dl>
        {tournament.description ? (
          <div className="border-t border-border pt-3 text-sm">
            <p className="mb-2 text-muted-foreground">Description</p>
            <p className="whitespace-pre-line font-medium text-foreground">{tournament.description}</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
