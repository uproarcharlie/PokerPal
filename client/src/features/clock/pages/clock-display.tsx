import { useParams, useSearch } from "wouter";
import { usePageMeta } from "@/app/page-meta";
import { lazyPage } from "@/app/lazy-page";
import { SCREEN_PARAM, VENUE_SCREEN } from "@/app/routes";
import { EmptyState, QueryState } from "@/components/shared/query-state";
import { PageSpinner } from "@/components/shared/page-spinner";
import { useMediaQuery } from "@/components/shared/use-media-query";
import { HANDHELD_QUERY, tvRefreshMs } from "../api";
import { useLiveClock } from "../hooks";
import { ClockScreen } from "../components/public/clock-screen";
import { ControlsBoundary } from "../components/public/controls-boundary";

/**
 * The club's staff run the clock from the TV's keyboard: that code is loaded only for them (a script of
 * its own), so the screen everyone else opens from a QR code carries none of it.
 */
const DisplayControls = lazyPage(() => import("../components/display-controls").then((module) => ({ default: module.DisplayControls })));

const STATE_CLASS = "flex min-h-dvh items-center justify-center bg-background px-4";

/**
 * The TV clock at /clock/:tournamentId, full screen at the venue: asked for every few seconds (a
 * player's phone showing it, far less often: tvRefreshMs) and ticking between answers on the server's
 * time, so every screen in the room shows the same second.
 */
export default function ClockDisplayPage() {
  const { tournamentId = "" } = useParams<{ tournamentId: string }>();
  const handheld = useMediaQuery(HANDHELD_QUERY);
  const venueScreen = new URLSearchParams(useSearch()).get(SCREEN_PARAM) === VENUE_SCREEN;
  const live = useLiveClock(tournamentId, { refetchMs: (display) => tvRefreshMs({ handheld, venueScreen, canControl: display?.viewer.canControl === true }) });
  usePageMeta({ title: live.display ? `Clock: ${live.display.tournament.name}` : "Tournament clock", noindex: true });
  const { derived } = live;

  return (
    <QueryState
      query={live.query}
      loading={<PageSpinner label="Loading the clock" className="min-h-dvh" />}
      notFound={<EmptyState title="Tournament not found" description="Check the link: this tournament may have been removed." />}
      errorTitle="The clock could not be loaded"
      stateClassName={STATE_CLASS}
    >
      {(display) => (
        <ClockScreen
          display={display}
          derived={derived}
          offline={live.offline}
          controls={
            display.viewer.canControl && derived
              ? (tools) => (
                  <ControlsBoundary>
                    <DisplayControls
                      tournamentId={display.tournament.id}
                      derived={derived}
                      undo={display.clock?.undo ?? null}
                      overlay={display.clock?.displaySettings.overlay ?? "none"}
                      tools={tools}
                    />
                  </ControlsBoundary>
                )
              : undefined
          }
        />
      )}
    </QueryState>
  );
}
