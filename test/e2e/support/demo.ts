/**
 * A club as it looks a few weeks into a season, built through the real API for the accessibility
 * checks (and anyone who wants to look at a full page): a logo, a description, an address and social
 * links; a season with a points system; a finished and finalized tournament (so the standings and
 * the season leaderboard have results), tonight's game in progress (re-buys, an add-on, knockouts and
 * players' requests still waiting) and next week's game open for sign-ups. Players have photos, or
 * none (their initials show).
 */
import type { APIRequestContext } from "@playwright/test";
import sharp from "sharp";
import type { ClubDto, PublicPointsSystem, PublicRegistration, PublicSeason } from "../../../shared/api/public";
import type { FinalizePreviewDto } from "../../../shared/api/finalize";
import type { ImageUploadResponse } from "../../../shared/api/images";
import type { StaffPlayer } from "../../../shared/api/players";
import type { TournamentDetailDto } from "../../../shared/api/tournaments";
import type { ImageKind } from "../../../shared/domain/images";
import { createPointsSystem, createTournament, expectJson, registerPlayer, uniquePhone, uniqueToken } from "./api";

/** The club's regulars; `photo` is the background and figure colour of a generated picture, or none (their initials show). */
const PLAYERS: readonly { name: string; photo: readonly [string, string] | null }[] = [
  { name: "Aroha Ngata", photo: ["#1e3a8a", "#93c5fd"] },
  { name: "Ben Whitfield", photo: ["#7c2d12", "#fdba74"] },
  { name: "Chloe Tan", photo: null },
  { name: "Dev Patel", photo: ["#14532d", "#86efac"] },
  { name: "Ella Fraser", photo: ["#581c87", "#d8b4fe"] },
  { name: "Finn O'Connor", photo: null },
  { name: "Grace Liu", photo: ["#0f766e", "#99f6e4"] },
  { name: "Hemi Walker", photo: ["#831843", "#f9a8d4"] },
  { name: "Isla McKenzie", photo: null },
  { name: "Jack Thompson", photo: ["#1f2937", "#d1d5db"] },
  { name: "Kiri Parata", photo: ["#713f12", "#fde68a"] },
  { name: "Liam Brooks", photo: ["#312e81", "#c7d2fe"] },
];

const SPADE = "M50 8C30 35 8 45 8 62c0 14 12 22 24 22 8 0 14-4 16-8-1 8-4 14-10 18h24c-6-4-9-10-10-18 2 4 8 8 16 8 12 0 24-8 24-22 0-17-22-27-42-54z";

/** The demo club's logo: a gold spade in a blue ring on navy (the Central Stars look). */
export function logoSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 100 100">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f2c14e"/><stop offset="1" stop-color="#b8862b"/></linearGradient></defs>
    <rect width="100" height="100" rx="22" fill="#0b1430"/>
    <circle cx="50" cy="50" r="40" fill="none" stroke="#3fa9ff" stroke-width="3"/>
    <path d="${SPADE}" transform="translate(20 18) scale(.6)" fill="url(#g)"/>
  </svg>`;
}

/** A player's picture: a figure in `figure`'s colour on `background`. */
export function photoSvg([background, figure]: readonly [string, string]): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 100 100">
    <rect width="100" height="100" fill="${background}"/>
    <circle cx="50" cy="40" r="19" fill="${figure}"/>
    <ellipse cx="50" cy="98" rx="36" ry="32" fill="${figure}"/>
  </svg>`;
}

/** Uploads `svg` (as a PNG) as `request`'s user, as the image kind asks; its stored URL. */
export async function uploadImage(request: APIRequestContext, kind: ImageKind, svg: string): Promise<string> {
  const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
  const response = await request.post(`/api/images/${kind}`, {
    multipart: { image: { name: `${kind}.png`, mimeType: "image/png", buffer } },
  });
  return (await expectJson<ImageUploadResponse>(response, 201)).url;
}

async function put<T>(request: APIRequestContext, url: string, data: object): Promise<T> {
  return expectJson<T>(await request.put(url, { data }), 200);
}

async function post<T>(request: APIRequestContext, url: string, data: object, status = 200): Promise<T> {
  return expectJson<T>(await request.post(url, { data }), status);
}

/** Knocks `loser` out, credited to `winner` (the server stamps the time, so call these in bust-out order). */
async function knockOut(request: APIRequestContext, loser: PublicRegistration, winner: PublicRegistration): Promise<void> {
  await put(request, `/api/registrations/${loser.id}`, { isEliminated: true, eliminatedBy: winner.playerId });
}

export interface DemoClub {
  club: ClubDto;
  season: PublicSeason;
  points: PublicPointsSystem;
  players: StaffPlayer[];
  /** Last week's game: completed and paid out. */
  finished: TournamentDetailDto;
  /** Tonight's game, in progress. */
  live: TournamentDetailDto;
  /** Next week's game, open for sign-ups. */
  upcoming: TournamentDetailDto;
}

interface DemoOptions {
  name?: string;
  /** Defaults to a unique one, so parallel tests each get their own club. */
  slug?: string;
  /**
   * The phone number of the club's nth regular. Players are matched by phone across every club, so the
   * default is unique within the run (and looks it); a lone club on a fresh database can have real-looking ones.
   */
  phoneOf?: (index: number) => string;
}

/** Builds the club as `request`'s user, who becomes its owner. */
export async function buildDemoClub(request: APIRequestContext, options: DemoOptions = {}): Promise<DemoClub> {
  const token = uniqueToken();
  const logo = await uploadImage(request, "club_logo", logoSvg());
  const club = await post<ClubDto>(
    request,
    "/api/clubs",
    {
      name: options.name ?? "Harbourside Poker Club",
      slug: options.slug ?? `harbourside-${token}`,
      description:
        "<p>Friendly no-limit hold'em in the heart of the city since 2019. Weekly league nights, a season leaderboard and a final table worth playing for.</p><p><strong>New players welcome</strong> — scan the QR code at the door to sign up.</p>",
      imageUrl: logo,
      timezone: "Pacific/Auckland",
      address: "12 Quay Street, Auckland CBD, Auckland 1010",
      websiteUrl: "https://example.com/harbourside",
      facebookUrl: "https://facebook.com/harbourside.poker",
      instagramUrl: "https://instagram.com/harbourside.poker",
      rakeLabel: "AP",
    },
    201,
  );
  const season = await post<PublicSeason>(
    request,
    "/api/seasons",
    { clubId: club.id, name: "Summer League 2026", startDate: "2026-09-01", endDate: "2026-12-20", isActive: true },
    201,
  );
  const points = await createPointsSystem(request, season.id, {
    name: "League points",
    participationPoints: 10,
    knockoutPoints: 5,
    allocations: [
      { position: 1, points: 100, description: "Winner" },
      { position: 2, points: 70 },
      { position: 3, points: 50 },
      { position: 4, points: 35 },
      { position: 5, points: 25 },
      { position: 6, points: 15 },
    ],
  });

  const players: StaffPlayer[] = [];
  const phoneOf = options.phoneOf ?? (() => uniquePhone());
  for (const [index, { name, photo }] of PLAYERS.map((player, index) => [index, player] as const)) {
    const imageUrl = photo ? await uploadImage(request, "player_avatar", photoSvg(photo)) : undefined;
    players.push(await post<StaffPlayer>(request, "/api/players", { name, phone: phoneOf(index), imageUrl, clubId: club.id }, 201));
  }

  const league = {
    clubId: club.id,
    seasonId: season.id,
    pointsSystemId: points.id,
    trackPoints: true,
    buyInAmount: "40.00",
    rebuyAmount: "40.00",
    maxRebuys: 1,
    addonAmount: "20.00",
    rakeType: "percentage" as const,
    rakeAmount: "10",
    payoutStructure: "standard" as const,
    maxPlayers: 27,
    useClubAddress: true,
  };
  const enter = async (tournament: TournamentDetailDto, entrants: readonly StaffPlayer[]) => {
    const entries: PublicRegistration[] = [];
    for (const player of entrants) {
      entries.push(await registerPlayer(request, tournament.id, player.id, { paymentConfirmed: true }));
    }
    return entries;
  };

  // Last week: ten players, two re-buys, then everyone out but the winner, and finalized.
  const finished = await createTournament(request, {
    ...league,
    name: "League Night 6",
    description: "Week six of the Summer League.",
    startDateTime: "2026-10-13T19:30:00+13:00",
  });
  const lastWeek = await enter(finished, players.slice(0, 10));
  await put(request, `/api/tournaments/${finished.id}`, { status: "in_progress" });
  for (const index of [3, 7]) await post(request, `/api/registrations/${lastWeek[index]!.id}/counts`, { rebuys: 1 });
  for (const [loser, winner] of [[9, 0], [8, 2], [7, 1], [6, 0], [5, 3], [4, 2], [3, 1], [2, 0], [1, 0]] as const) {
    await knockOut(request, lastWeek[loser]!, lastWeek[winner]!);
  }
  const preview = await post<FinalizePreviewDto>(request, `/api/tournaments/${finished.id}/finalize/preview`, {});
  await post(request, `/api/tournaments/${finished.id}/finalize`, { expectedPlanHash: preview.planHash });

  // Tonight: nine in, a re-buy and an add-on taken, three out, and two requests waiting for the TD.
  const live = await createTournament(request, {
    ...league,
    name: "Friday Night Deepstack",
    description: "Deep stacks, 20-minute levels. Re-buys until the first break, one add-on at the break.",
    startDateTime: "2026-10-20T19:00:00+13:00",
    enableHighHand: true,
    highHandAmount: "5.00",
  });
  const tonight = await enter(live, [...players.slice(0, 8), players[10]!]);
  await put(request, `/api/tournaments/${live.id}`, { status: "in_progress" });
  await post(request, `/api/registrations/${tonight[4]!.id}/counts`, { rebuys: 1 });
  await post(request, `/api/registrations/${tonight[1]!.id}/counts`, { addons: 1 });
  await knockOut(request, tonight[8]!, tonight[0]!);
  await knockOut(request, tonight[6]!, tonight[2]!);
  await knockOut(request, tonight[5]!, tonight[0]!);
  await post(request, `/api/tournaments/${live.id}/pending-actions`, { playerId: tonight[3]!.playerId, actionType: "rebuy" }, 201);
  await post(
    request,
    `/api/tournaments/${live.id}/pending-actions`,
    { playerId: tonight[1]!.playerId, actionType: "knockout", targetPlayerId: tonight[7]!.playerId },
    201,
  );

  // Next week: open for sign-ups, four in so far.
  const upcoming = await createTournament(request, {
    ...league,
    name: "League Night 7",
    description: "Week seven of the Summer League. Sign up at the door or scan the QR code.",
    startDateTime: "2026-10-27T19:30:00+13:00",
    status: "registration",
  });
  await enter(upcoming, [players[0]!, players[2]!, players[4]!, players[9]!]);

  return { club, season, points, players, finished, live, upcoming };
}
