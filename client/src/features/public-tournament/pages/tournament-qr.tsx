import { useParams } from "wouter";
import { QRCodeSVG } from "qrcode.react";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { absoluteUrl, routes } from "@/app/routes";
import { usePageMeta } from "@/app/page-meta";
import { ClubHeader } from "@/components/shared/club-header";
import { CopyLinkButton } from "@/components/shared/copy-link-button";
import { MoneyText } from "@/components/shared/money-text";
import { CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { clubTimeZone, formatDay } from "@/lib/format";
import { QueryState } from "@/components/shared/query-state";
import { useClub } from "@/features/clubs/hooks";
import { useTournament } from "@/features/tournaments/hooks";
import { CenteredCard, TOURNAMENT_PAGE_STATES } from "../components/page-shell";
import { offersHighHand } from "@shared/domain/player-actions";

/** The QR code at full size: drawn at this many pixels and scaled down to fit a phone (PUB-31). */
const QR_SIZE = 400;

function QrPoster({ tournament }: { tournament: TournamentDetailDto }) {
  const { data: club } = useClub(tournament.clubId);
  const registrationUrl = absoluteUrl(routes.publicRegister(tournament.id));
  const highHand = offersHighHand(tournament);

  return (
    <CenteredCard wide>
      <CardHeader className="space-y-4 text-center">
        {club ? <ClubHeader club={club} logoSize="xl" /> : null}
        <div className="pt-2">
          <h1 className="text-2xl font-semibold text-foreground">{tournament.name}</h1>
          <CardDescription className="mt-1 text-base">{formatDay(tournament.startDateTime, clubTimeZone(club))}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* A QR code is dark on light whatever the theme: scanners need the contrast. */}
        <div className="mx-auto w-full max-w-[400px] rounded-lg bg-white p-4 shadow-inner sm:p-8">
          <QRCodeSVG
            value={registrationUrl}
            size={QR_SIZE}
            level="H"
            marginSize={4}
            title={`Scan to register for ${tournament.name}`}
            style={{ width: "100%", height: "auto" }}
          />
        </div>

        <div className="space-y-2 text-center">
          <p className="text-xl font-bold text-primary">Scan to Register</p>
          <p className="text-sm text-muted-foreground">Players can scan this QR code to register for the tournament</p>
        </div>

        <dl className="grid grid-cols-2 gap-4">
          <div className="rounded-lg bg-muted/50 p-4 text-center">
            <dt className="mb-1 text-sm text-muted-foreground">Buy-in</dt>
            <dd className="text-2xl font-bold text-primary sm:text-3xl">
              <MoneyText amount={tournament.buyInAmount} forceCents />
            </dd>
          </div>
          {highHand ? (
            <div className="rounded-lg bg-muted/50 p-4 text-center">
              <dt className="mb-1 text-sm text-muted-foreground">High hand entry</dt>
              <dd className="text-2xl font-bold text-accent-text sm:text-3xl">
                <MoneyText amount={tournament.highHandAmount} forceCents />
              </dd>
            </div>
          ) : null}
        </dl>

        <div className="space-y-3 rounded-lg border border-border bg-muted p-4">
          <p className="text-xs font-semibold text-muted-foreground">Registration URL</p>
          <code className="block break-all text-xs text-foreground/80">{registrationUrl}</code>
          <CopyLinkButton value={registrationUrl} size="sm" />
        </div>
      </CardContent>
    </CenteredCard>
  );
}

/** The poster a TD puts up at the venue: scanning it opens the tournament's sign-up page. */
export default function TournamentQrPage() {
  const { tournamentId = "" } = useParams<{ tournamentId: string }>();
  const tournament = useTournament(tournamentId);
  usePageMeta({ title: tournament.data ? `QR code: ${tournament.data.name}` : "QR code", noindex: true });

  return (
    <QueryState query={tournament} {...TOURNAMENT_PAGE_STATES}>
      {(loaded) => <QrPoster tournament={loaded} />}
    </QueryState>
  );
}
