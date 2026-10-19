/**
 * (e) Someone who is not signed in calls the staff API directly (curl, a script, a copied link), against
 * real records of the production build. Every such call is answered 401 with the JSON error body, and
 * none of them changes anything.
 */
import sharp from "sharp";
import type { ApiErrorBody } from "../../shared/api/errors";
import type { PendingActionDto } from "../../shared/api/pending-actions";
import type { StaffPlayer } from "../../shared/api/players";
import type { ClubDto, PublicRegistration } from "../../shared/api/public";
import type { TournamentDetailDto } from "../../shared/api/tournaments";
import {
  createClub,
  createPlayer,
  createPointsSystem,
  createSeason,
  createTournament,
  expectJson,
  registerPlayer,
  signUp,
  uniqueToken,
} from "./support/api";
import { expect, test } from "./support/fixtures";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface StaffCall {
  method: Method;
  path: string;
  data?: unknown;
  multipart?: Record<string, string | { name: string; mimeType: string; buffer: Buffer }>;
}

test("anonymous calls to staff endpoints are refused with 401 and change nothing", async ({ request, openBrowser }) => {
  const token = uniqueToken();

  // A club owner's real records (`request` is signed in as them).
  const owner = await signUp(request, "Rae Owner");
  const club = await createClub(request, `Locked Club ${token}`);
  const season = await createSeason(request, club.id, `Season ${token}`);
  const points = await createPointsSystem(request, season.id, { name: "Points", allocations: [{ position: 1, points: 10 }] });
  const tournament = await createTournament(request, { clubId: club.id, seasonId: season.id, name: `Locked Game ${token}` });
  const [ivy, jon] = [await createPlayer(request, `Ivy ${token}`), await createPlayer(request, `Jon ${token}`)];
  const registration = await registerPlayer(request, tournament.id, ivy.id);
  await registerPlayer(request, tournament.id, jon.id);
  const action = await expectJson<PendingActionDto>(
    await request.post(`/api/tournaments/${tournament.id}/pending-actions`, {
      data: { playerId: jon.id, actionType: "knockout", targetPlayerId: ivy.id },
    }),
    201,
  );
  const photo = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#204080" } }).png().toBuffer();
  const image = { name: "logo.png", mimeType: "image/png", buffer: photo };

  const calls: StaffCall[] = [
    { method: "GET", path: "/api/auth/me" },
    { method: "PUT", path: "/api/auth/profile", data: { name: "Hacker", email: "hacker@example.test" } },
    { method: "POST", path: "/api/auth/change-password", data: { currentPassword: "x", newPassword: "Hacked-Pass-123" } },
    { method: "GET", path: "/api/admin/users" },
    { method: "PUT", path: `/api/admin/users/${owner.id}`, data: { role: "admin" } },
    { method: "POST", path: `/api/admin/users/${owner.id}/impersonate` },
    { method: "POST", path: "/api/admin/stop-impersonation" },
    { method: "GET", path: "/api/admin/audit-log" },
    { method: "GET", path: "/api/dashboard/stats" },
    { method: "GET", path: "/api/players" },
    { method: "PUT", path: `/api/players/${ivy.id}`, data: { name: "Renamed" } },
    { method: "POST", path: "/api/clubs", data: { name: "Squatter Club", slug: `squat-${token}` } },
    { method: "PUT", path: `/api/clubs/${club.id}`, data: { name: "Taken Over" } },
    { method: "DELETE", path: `/api/clubs/${club.id}` },
    { method: "GET", path: `/api/clubs/${club.id}/managers` },
    { method: "POST", path: `/api/clubs/${club.id}/invites`, data: { email: "hacker@example.test" } },
    { method: "DELETE", path: `/api/clubs/${club.id}/invites/${owner.id}` },
    { method: "POST", path: "/api/staff-invites/accept", data: { token: "a".repeat(43) } },
    { method: "DELETE", path: `/api/clubs/${club.id}/managers/${owner.id}` },
    { method: "PUT", path: `/api/clubs/${club.id}/owner`, data: { userId: owner.id } },
    { method: "POST", path: "/api/seasons", data: { clubId: club.id, name: "Rogue", startDate: "2026-01-01" } },
    { method: "PUT", path: `/api/seasons/${season.id}`, data: { name: "Rogue" } },
    { method: "DELETE", path: `/api/seasons/${season.id}` },
    { method: "POST", path: `/api/seasons/${season.id}/points-systems`, data: { name: "Rogue" } },
    { method: "DELETE", path: `/api/points-systems/${points.id}` },
    { method: "POST", path: `/api/points-systems/${points.id}/allocations`, data: { position: 2, points: 1000 } },
    {
      method: "POST",
      path: "/api/tournaments",
      data: { clubId: club.id, name: "Rogue", startDateTime: "2026-10-24T19:30", buyInAmount: "10", maxPlayers: 10 },
    },
    { method: "PUT", path: `/api/tournaments/${tournament.id}`, data: { status: "cancelled" } },
    { method: "DELETE", path: `/api/tournaments/${tournament.id}` },
    { method: "PUT", path: `/api/tournaments/${tournament.id}/prize-pool/adjustment`, data: { mode: "manual_pool", amount: "1000", reason: "x" } },
    { method: "PUT", path: `/api/tournaments/${tournament.id}/prize-pool/rates`, data: { rakeType: "percentage", rakeAmount: "90" } },
    { method: "POST", path: `/api/tournaments/${tournament.id}/finalize/preview`, data: {} },
    { method: "POST", path: `/api/tournaments/${tournament.id}/finalize`, data: { finishOrder: [registration.id], expectedPlanHash: "x" } },
    { method: "GET", path: `/api/tournaments/${tournament.id}/pending-registrations` },
    { method: "GET", path: `/api/tournaments/${tournament.id}/confirmed-registrations` },
    { method: "GET", path: `/api/tournaments/${tournament.id}/pending-actions` },
    { method: "PUT", path: `/api/registrations/${registration.id}`, data: { isEliminated: true } },
    { method: "POST", path: `/api/registrations/${registration.id}/counts`, data: { rebuys: 5 } },
    { method: "PATCH", path: `/api/registrations/${registration.id}/confirm-payment` },
    { method: "POST", path: `/api/pending-actions/${action.id}/confirm` },
    { method: "DELETE", path: `/api/pending-actions/${action.id}` },
    { method: "POST", path: "/api/images/club_logo", multipart: { image } },
    { method: "POST", path: "/api/upload", multipart: { image, entityType: "clubs" } },
  ];

  // A browser context that never signed in, and one sending a session cookie it made up.
  const anonymous = await openBrowser();
  const forged = await openBrowser({
    extraHTTPHeaders: { Cookie: "pokerpal.sid=s%3AforgedSessionId.forgedSignature" },
  });
  for (const [who, context] of [["anonymous", anonymous], ["forged cookie", forged]] as const) {
    for (const { method, path, data, multipart } of calls) {
      const response = await context.request.fetch(path, { method, data, multipart });
      const label = `${who}: ${method} ${path}`;
      expect.soft(response.status(), label).toBe(401);
      expect.soft(response.headers()["content-type"], label).toMatch(/^application\/json/);
      const body = (await response.json().catch(() => ({}))) as Partial<ApiErrorBody>;
      expect.soft(body.code, label).toBe("UNAUTHENTICATED");
      expect.soft(Object.keys(body).sort(), label).toEqual(["code", "error"]);
    }
  }

  // Nothing moved: the owner still sees every record as it was.
  const after = await expectJson<TournamentDetailDto>(await request.get(`/api/tournaments/${tournament.id}`), 200);
  expect(after).toMatchObject({ name: tournament.name, status: "registration", manualPrizePool: null, rakeType: "none" });
  const registrations = await expectJson<PublicRegistration[]>(await request.get(`/api/tournaments/${tournament.id}/registrations`), 200);
  expect(registrations.find((row) => row.id === registration.id)).toMatchObject({
    isEliminated: false,
    rebuys: 0,
    paymentConfirmed: false,
  });
  const pending = await expectJson<PendingActionDto[]>(await request.get(`/api/tournaments/${tournament.id}/pending-actions`), 200);
  expect(pending.map((row) => row.id)).toEqual([action.id]);
  await expectJson(await request.get(`/api/seasons/${season.id}`), 200);
  await expectJson(await request.get(`/api/points-systems/${points.id}`), 200);
  expect(await expectJson<ClubDto>(await request.get(`/api/clubs/${club.id}`), 200)).toMatchObject({ name: club.name });
  const players = await expectJson<StaffPlayer[]>(await request.get("/api/players"), 200);
  expect(players.find((player) => player.id === ivy.id)).toMatchObject({ name: ivy.name });
});
