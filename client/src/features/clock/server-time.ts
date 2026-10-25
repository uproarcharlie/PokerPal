/**
 * The server's time as this device estimates it, so every screen ticks the clock from the same time
 * the server keeps (phase4-contracts §7): a TV whose own clock is two minutes out still shows the
 * level ending when the TD's phone does. Each answer that carries `serverNow` (the display, and every
 * clock change) is a sample: the server's time at about the middle of the round trip. The estimate
 * uses the sample with the shortest round trip of the last few, where that middle is surest, and
 * advances it on the device's monotonic clock, which a change of the device's own time never moves.
 *
 * A page that was hidden may have slept, and a monotonic clock can stop while it sleeps, so the
 * samples are dropped when the page is hidden or shown again; until the next answer the estimate
 * runs on the device's wall clock with the last offset seen.
 */

/** How many recent samples the estimate chooses from. */
export const SERVER_TIME_SAMPLES = 5;

interface Sample {
  roundTripMs: number;
  /** The server's time minus the monotonic clock, at the middle of the round trip. */
  serverMinusMonotonic: number;
}

export interface TimeSources {
  /** A clock that only moves forward (performance.now). */
  monotonic: () => number;
  /** The device's own time (Date.now). */
  wall: () => number;
}

export interface ServerTime {
  /** A timestamp to hand back to `record` as the moment a request was sent. */
  mark: () => number;
  /** A server answer with `serverNow`, for a request sent at `sentAt` (from `mark`) and answered just now. */
  record: (serverNow: number, sentAt: number) => void;
  /** The server's time now, as best known (the device's own time until the first answer). */
  now: () => number;
  /** Forgets the samples (the wall-clock offset is kept until the next answer). */
  reset: () => void;
}

const browserSources: TimeSources = { monotonic: () => performance.now(), wall: () => Date.now() };

export function createServerTime(sources: TimeSources = browserSources): ServerTime {
  let samples: Sample[] = [];
  let wallOffset = 0;

  const best = (): Sample | undefined =>
    samples.reduce<Sample | undefined>((chosen, sample) => (chosen === undefined || sample.roundTripMs < chosen.roundTripMs ? sample : chosen), undefined);

  return {
    mark: () => sources.monotonic(),
    record(serverNow, sentAt) {
      if (!Number.isFinite(serverNow)) return;
      const receivedAt = sources.monotonic();
      const roundTripMs = Math.max(0, receivedAt - sentAt);
      const middle = receivedAt - roundTripMs / 2;
      samples = [...samples, { roundTripMs, serverMinusMonotonic: serverNow - middle }].slice(-SERVER_TIME_SAMPLES);
      const chosen = best() as Sample;
      // The same estimate on the wall clock, for after a reset.
      wallOffset = chosen.serverMinusMonotonic + receivedAt - sources.wall();
    },
    now() {
      const chosen = best();
      return chosen ? sources.monotonic() + chosen.serverMinusMonotonic : sources.wall() + wallOffset;
    },
    reset() {
      samples = [];
    },
  };
}

/** The page's estimate: one server, so one estimate for every clock on the page. */
export const serverTime = createServerTime();

/** Runs a request whose answer carries `serverNow`, and records that answer as a sample. */
export async function withServerTime<T extends { serverNow: number }>(request: () => Promise<T>): Promise<T> {
  const sentAt = serverTime.mark();
  const answer = await request();
  serverTime.record(answer.serverNow, sentAt);
  return answer;
}
