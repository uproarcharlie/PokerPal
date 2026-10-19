/**
 * A club's staff (server/routes/club-managers.ts, SEC-26): the owner or an admin lists managers,
 * invites new ones (a role is granted only when the invited person opens the link signed in to the
 * account that uses the invited address: SEC-P2REV-03) and removes them; only an admin sets or
 * invites the owner. Managers can run the club (see the clubs, seasons and points tests) but not
 * change its staff. Every change is audited.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import session from "express-session";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { STAFF_INVITE_TTL_DAYS } from "@shared/api/clubs";
import { auditLog, clubManagers, clubs, clubStaffInvites, users } from "@shared/schema";
import { createApp } from "../../server/app";
import { loadEnv } from "../../server/config/env";
import { createClub, createUser, FACTORY_PASSWORD } from "../factories";
import { createClubManager } from "../factories/club-managers";
import { anon, getApp, loginAs, resetDb, signIn, testDb, UNKNOWN_ID } from "../helpers";
import { clubWithStaff } from "../helpers/club-staff";

beforeEach(resetDb);

const managerIds = async (clubId: string) =>
  (await testDb().select().from(clubManagers).where(eq(clubManagers.clubId, clubId))).map((row) => row.userId).sort();

const ownerOf = async (clubId: string) => (await testDb().select().from(clubs).where(eq(clubs.id, clubId)))[0].ownerId;

const auditRows = (action: string, clubId: string) =>
  testDb().select().from(auditLog).where(and(eq(auditLog.action, action), eq(auditLog.targetId, clubId)));

const staffUser = (user: { id: string; name: string; email: string }) => ({ id: user.id, name: user.name, email: user.email });

describe("GET /api/clubs/:id/managers", () => {
  it("shows the owner and the managers, first added first, to the owner and to admins", async () => {
    const { club, owner, manager, deactivated, admin } = await clubWithStaff();

    for (const who of [owner, admin]) {
      const response = await who.agent.get(`/api/clubs/${club.id}/managers`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        clubId: club.id,
        owner: staffUser(owner.user),
        managers: [
          { user: staffUser(manager.user), role: "manager", createdAt: expect.any(String) },
          { user: staffUser(deactivated.user), role: "manager", createdAt: expect.any(String) },
        ],
        invites: [],
      });
    }
  });

  it("is refused to anonymous visitors, deactivated accounts, strangers and managers", async () => {
    const { club, manager, stranger, deactivated } = await clubWithStaff();

    expect((await (await anon()).get(`/api/clubs/${club.id}/managers`)).status).toBe(401);
    expect((await deactivated.agent.get(`/api/clubs/${club.id}/managers`)).status).toBe(401);
    for (const who of [stranger, manager]) {
      const response = await who.agent.get(`/api/clubs/${club.id}/managers`);

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: "Only the club's owner or an admin can do that", code: "FORBIDDEN" });
    }
  });

  it("answers 404 for an unknown club, and shows a club with no owner", async () => {
    const { agent } = await signIn({ role: "admin" });
    const ownerless = await createClub();

    expect((await agent.get(`/api/clubs/${UNKNOWN_ID}/managers`)).status).toBe(404);
    expect((await agent.get(`/api/clubs/${ownerless.id}/managers`)).body).toEqual({ clubId: ownerless.id, owner: null, managers: [], invites: [] });
  });
});

/** Invites `email` to the club as `inviter` (the owner unless given), and returns the link's secret. */
async function invite(inviter: request.Agent, clubId: string, email: string, role?: "manager" | "owner"): Promise<string> {
  const response = await inviter.post(`/api/clubs/${clubId}/invites`).send({ email, ...(role ? { role } : {}) });
  expect(response.status).toBe(201);
  return response.body.token as string;
}

const accept = (agent: request.Agent, token: string) => agent.post("/api/staff-invites/accept").send({ token });

const invitesOf = (clubId: string) => testDb().select().from(clubStaffInvites).where(eq(clubStaffInvites.clubId, clubId));

describe("POST /api/clubs/:id/invites: staff by invitation, never by email alone (SEC-P2REV-03)", () => {
  it("makes an invitation for the address, granting nothing yet, and stores only a hash of the link's secret", async () => {
    const { club, owner } = await clubWithStaff();
    const before = await managerIds(club.id);

    const response = await owner.agent.post(`/api/clubs/${club.id}/invites`).send({ email: " Sam@Example.TEST " });

    expect(response.status).toBe(201);
    const { token, invite: created, staff } = response.body;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created).toEqual({ id: expect.any(String), email: "sam@example.test", role: "manager", createdAt: expect.any(String), expiresAt: expect.any(String) });
    expect(Date.parse(created.expiresAt) - Date.parse(created.createdAt)).toBe(STAFF_INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
    expect(staff.invites).toEqual([created]);
    expect(JSON.stringify(staff)).not.toContain(token);
    const [row] = await invitesOf(club.id);
    expect(row).toMatchObject({ tokenHash: createHash("sha256").update(token).digest("hex"), createdBy: owner.user.id });
    expect(JSON.stringify(row)).not.toContain(token);
    expect(await managerIds(club.id)).toEqual(before);
    expect(await auditRows("club.invite_created", club.id)).toEqual([
      expect.objectContaining({ actorUserId: owner.user.id, data: { inviteId: created.id, role: "manager", email: "sam@example.test", expiresAt: created.expiresAt } }),
    ]);
  });

  it("gives an account that claimed the address first nothing: the role needs the link sent to the person", async () => {
    const { club, owner } = await clubWithStaff();
    // Someone who overheard "I'll add sam@" signs up with it before Sam does.
    const squatter = await signIn({ email: "sam@example.test" });
    await invite(owner.agent, club.id, "sam@example.test");

    const guessed = await accept(squatter.agent, randomBytes(32).toString("base64url"));

    expect([guessed.status, guessed.body.code]).toEqual([404, "INVITE_INVALID"]);
    expect(await managerIds(club.id)).not.toContain(squatter.user.id);
    expect((await squatter.agent.put(`/api/clubs/${club.id}`).send({ address: "Mine now" })).status).toBe(403);
  });

  it("is accepted by the account that signs in with the address: staff rights at once, audited, the invitation used up", async () => {
    const { club, owner } = await clubWithStaff();
    const sam = await signIn({ email: "sam@example.test" });
    const token = await invite(owner.agent, club.id, "SAM@example.test");
    expect((await sam.agent.put(`/api/clubs/${club.id}`).send({ address: "Too early" })).status).toBe(403);

    const response = await accept(sam.agent, token);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ clubId: club.id, clubName: club.name, role: "manager" });
    expect((await sam.agent.put(`/api/clubs/${club.id}`).send({ address: "Now allowed" })).status).toBe(200);
    expect((await sam.agent.get(`/api/clubs/${club.id}`)).body.viewer).toEqual({ canManage: true, canOwn: false });
    const [row] = await testDb().select().from(clubManagers).where(and(eq(clubManagers.clubId, club.id), eq(clubManagers.userId, sam.user.id)));
    expect(row).toMatchObject({ role: "manager", createdBy: owner.user.id });
    const [used] = await invitesOf(club.id);
    expect(await auditRows("club.manager_added", club.id)).toEqual([
      expect.objectContaining({ actorUserId: sam.user.id, data: { userId: sam.user.id, inviteId: used.id } }),
    ]);
    expect(used).toMatchObject({ acceptedBy: sam.user.id, acceptedAt: expect.any(Date) });
    expect((await owner.agent.get(`/api/clubs/${club.id}/managers`)).body.invites).toEqual([]);

    // Opening the link again changes nothing; nobody else can use it.
    expect((await accept(sam.agent, token)).body).toEqual(response.body);
    const other = await signIn();
    expect((await accept(other.agent, token)).body.code).toBe("INVITE_INVALID");
    expect(await auditRows("club.manager_added", club.id)).toHaveLength(1);
  });

  it("is refused to an account that does not use the invited address, without naming the address, and stays open for the right one", async () => {
    const { club, owner } = await clubWithStaff();
    const token = await invite(owner.agent, club.id, "sam@example.test");
    const forwardedTo = await signIn({ email: "friend@example.test" });

    const refused = await accept(forwardedTo.agent, token);

    expect(refused.status).toBe(403);
    expect(refused.body).toEqual({
      error: "This invitation is for another email address: sign in with the account that uses the address it was sent to",
      code: "INVITE_FOR_ANOTHER_ACCOUNT",
    });
    expect(await managerIds(club.id)).not.toContain(forwardedTo.user.id);
    const sam = await signIn({ email: "sam@example.test" });
    expect((await accept(sam.agent, token)).status).toBe(200);
  });

  it("follows the sign-in rule for legacy addresses that differ only in case (P2REV4-CQ-10)", async () => {
    const { club, owner } = await clubWithStaff();
    const createdAt = new Date("2025-01-01T00:00:00Z");
    const twins = [await createUser({ email: "Twin@Example.test", createdAt }), await createUser({ email: "twin@EXAMPLE.test", createdAt })];
    const first = [...twins].sort((a, b) => a.id.localeCompare(b.id))[0];
    const second = twins.find((twin) => twin.id !== first.id)!;
    const token = await invite(owner.agent, club.id, "twin@example.test");

    // Sign-in with the address, in any case, always reaches the same twin: that is the one the invitation is for.
    const signedIn = await loginAs({ email: second.email });
    expect(signedIn.user.id).toBe(first.id);

    expect((await accept(signedIn.agent, token)).status).toBe(200);
    expect(await managerIds(club.id)).toContain(first.id);
    expect(await managerIds(club.id)).not.toContain(second.id);
  });

  it("expires after its time, and a second invitation for the address replaces the first", async () => {
    const { club, owner } = await clubWithStaff();
    const sam = await signIn({ email: "sam@example.test" });
    const old = await invite(owner.agent, club.id, "sam@example.test");
    const resent = await invite(owner.agent, club.id, "sam@example.test");

    expect((await accept(sam.agent, old)).body.code).toBe("INVITE_INVALID");
    expect((await owner.agent.get(`/api/clubs/${club.id}/managers`)).body.invites).toHaveLength(1);

    await testDb().update(clubStaffInvites).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(clubStaffInvites.clubId, club.id));
    const expired = await accept(sam.agent, resent);
    expect([expired.status, expired.body.code]).toEqual([409, "INVITE_EXPIRED"]);
    expect((await owner.agent.get(`/api/clubs/${club.id}/managers`)).body.invites).toEqual([]);
    expect(await managerIds(club.id)).not.toContain(sam.user.id);
  });

  it("explains each refusal: the owner's address, a manager's, the owner accepting a manager invitation", async () => {
    const { club, owner, manager } = await clubWithStaff();

    const ownAddress = await owner.agent.post(`/api/clubs/${club.id}/invites`).send({ email: owner.user.email });
    const managerAddress = await owner.agent.post(`/api/clubs/${club.id}/invites`).send({ email: manager.user.email.toUpperCase() });

    expect([ownAddress.status, ownAddress.body.code]).toEqual([409, "IS_OWNER"]);
    expect([managerAddress.status, managerAddress.body.code]).toEqual([409, "ALREADY_MANAGER"]);
    // An invitation made before the account became the owner is refused when the owner opens it.
    const token = await invite(owner.agent, club.id, "future@example.test");
    const future = await signIn({ email: "future@example.test" });
    const { admin } = await clubWithStaff();
    expect((await admin.agent.put(`/api/clubs/${club.id}/owner`).send({ userId: future.user.id })).status).toBe(200);
    expect((await accept(future.agent, token)).body.code).toBe("IS_OWNER");
  });

  it("is for the owner and admins: managers and strangers are refused, an owner invitation is an admin's, and the body is checked", async () => {
    const { club, owner, manager, stranger } = await clubWithStaff();
    const path = `/api/clubs/${club.id}/invites`;

    expect((await (await anon()).post(path).send({ email: "a@example.test" })).status).toBe(401);
    expect((await manager.agent.post(path).send({ email: "a@example.test" })).status).toBe(403);
    expect((await stranger.agent.post(path).send({ email: "a@example.test" })).status).toBe(403);
    const ownerInvite = await owner.agent.post(path).send({ email: "a@example.test", role: "owner" });
    expect(ownerInvite.status).toBe(403);
    expect(ownerInvite.body).toEqual({ error: "Only a platform admin can invite a new owner", code: "FORBIDDEN" });
    const invalid = await owner.agent.post(path).send({});
    expect(invalid.status).toBe(400);
    expect(invalid.body.details).toEqual([expect.objectContaining({ path: ["email"] })]);
    expect(await invitesOf(club.id)).toEqual([]);
  });

  it("lets an admin hand a club to a new owner by invitation: accepted, the previous owner is no longer staff (Central Stars)", async () => {
    const { club, owner, manager, admin } = await clubWithStaff();
    const token = await invite(admin.agent, club.id, manager.user.email, "owner");

    const response = await accept(manager.agent, token);

    expect(response.body).toEqual({ clubId: club.id, clubName: club.name, role: "owner" });
    expect(await ownerOf(club.id)).toBe(manager.user.id);
    expect(await managerIds(club.id)).not.toContain(manager.user.id);
    expect((await owner.agent.put(`/api/clubs/${club.id}`).send({ address: "Former owner" })).status).toBe(403);
    const [used] = await invitesOf(club.id);
    expect(await auditRows("club.owner_set", club.id)).toEqual([
      expect.objectContaining({ actorUserId: manager.user.id, data: { previousOwnerId: owner.user.id, ownerId: manager.user.id, inviteId: used.id } }),
    ]);
  });

  it("limits how many staff changes one account makes (SEC-P2-05)", async () => {
    const owner = await createUser();
    const club = await createClub({ ownerId: owner.id });
    const app = await createApp({
      env: loadEnv(process.env),
      sessionStore: new session.MemoryStore(),
      rateLimits: { enabled: true, limits: { staffChange: 2 } },
    });
    const agent = request.agent(app);
    expect((await agent.post("/api/auth/login").send({ email: owner.email, password: FACTORY_PASSWORD })).status).toBe(200);

    const statuses = [];
    for (const email of ["a@example.test", "b@example.test", "c@example.test"]) {
      statuses.push((await agent.post(`/api/clubs/${club.id}/invites`).send({ email })).status);
    }

    expect(statuses).toEqual([201, 201, 429]);
    expect(await invitesOf(club.id)).toHaveLength(2);
  });
});

describe("DELETE /api/clubs/:id/invites/:inviteId", () => {
  it("withdraws an open invitation, whose link then stops working, and audits it", async () => {
    const { club, owner } = await clubWithStaff();
    const sam = await signIn({ email: "sam@example.test" });
    const token = await invite(owner.agent, club.id, "sam@example.test");
    const [open] = await invitesOf(club.id);

    const response = await owner.agent.delete(`/api/clubs/${club.id}/invites/${open.id}`);

    expect(response.status).toBe(200);
    expect(response.body.invites).toEqual([]);
    expect((await accept(sam.agent, token)).body.code).toBe("INVITE_INVALID");
    expect(await auditRows("club.invite_revoked", club.id)).toEqual([
      expect.objectContaining({ actorUserId: owner.user.id, data: { inviteId: open.id, role: "manager", email: "sam@example.test" } }),
    ]);
    expect((await owner.agent.delete(`/api/clubs/${club.id}/invites/${open.id}`)).status).toBe(404);
  });

  it("leaves an admin's owner invitation to admins, and is refused to managers", async () => {
    const { club, owner, manager, admin } = await clubWithStaff();
    await invite(admin.agent, club.id, "next.owner@example.test", "owner");
    const [open] = await invitesOf(club.id);

    expect((await owner.agent.delete(`/api/clubs/${club.id}/invites/${open.id}`)).status).toBe(403);
    expect((await manager.agent.delete(`/api/clubs/${club.id}/invites/${open.id}`)).status).toBe(403);
    expect((await admin.agent.delete(`/api/clubs/${club.id}/invites/${open.id}`)).status).toBe(200);
  });
});

describe("POST /api/staff-invites/accept", () => {
  it("needs a signed-in, active account and a well-formed secret", async () => {
    const { club, owner } = await clubWithStaff();
    const leaving = await signIn();
    const token = await invite(owner.agent, club.id, leaving.user.email);
    await testDb().update(users).set({ isActive: false }).where(eq(users.id, leaving.user.id));

    expect((await accept(request.agent(await getApp()), token)).status).toBe(401);
    expect((await accept(leaving.agent, token)).status).toBe(401);
    expect(await managerIds(club.id)).not.toContain(leaving.user.id);
    const malformed = await owner.agent.post("/api/staff-invites/accept").send({ token: "x" });
    expect([malformed.status, malformed.body.code]).toEqual([400, "VALIDATION"]);
  });
});

describe("DELETE /api/clubs/:id/managers/:userId", () => {
  it("removes the manager, who loses the club's staff rights at once, and audits it", async () => {
    const { club, owner, manager } = await clubWithStaff();

    const response = await owner.agent.delete(`/api/clubs/${club.id}/managers/${manager.user.id}`);

    expect(response.status).toBe(200);
    expect(response.body.managers.map((m: { user: { id: string } }) => m.user.id)).not.toContain(manager.user.id);
    expect((await manager.agent.put(`/api/clubs/${club.id}`).send({ address: "Too late" })).status).toBe(403);
    expect(await auditRows("club.manager_removed", club.id)).toEqual([
      expect.objectContaining({ actorUserId: owner.user.id, data: { userId: manager.user.id } }),
    ]);
  });

  it("answers 404 for someone who is not a manager of this club, and changes nothing", async () => {
    const { club, owner, stranger } = await clubWithStaff();
    const other = await createClub();
    await createClubManager({ clubId: other.id, userId: stranger.user.id });
    const before = await managerIds(club.id);

    const response = await owner.agent.delete(`/api/clubs/${club.id}/managers/${stranger.user.id}`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "That person is not a manager of this club", code: "NOT_FOUND" });
    expect(await managerIds(club.id)).toEqual(before);
    expect(await managerIds(other.id)).toEqual([stranger.user.id]);
  });

  it("is refused to managers, even for themselves", async () => {
    const { club, manager } = await clubWithStaff();

    const response = await manager.agent.delete(`/api/clubs/${club.id}/managers/${manager.user.id}`);

    expect(response.status).toBe(403);
    expect(await managerIds(club.id)).toContain(manager.user.id);
  });

  it("answers 400 for a malformed user id", async () => {
    const { club, owner } = await clubWithStaff();

    const response = await owner.agent.delete(`/api/clubs/${club.id}/managers/not%20an%20id`);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION");
  });
});

describe("PUT /api/clubs/:id/owner", () => {
  it("lets an admin give an ownerless club an owner they picked by user id, and audits it; never by email (SEC-P2REV-03)", async () => {
    const { agent, user: admin } = await signIn({ role: "admin" });
    const club = await createClub({ ownerId: null });
    const future = await createUser({ email: "owner@example.test" });

    const byEmail = await agent.put(`/api/clubs/${club.id}/owner`).send({ email: "owner@example.test" });
    const response = await agent.put(`/api/clubs/${club.id}/owner`).send({ userId: future.id });

    expect(byEmail.status).toBe(400);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ clubId: club.id, owner: staffUser(future), managers: [], invites: [] });
    expect(await ownerOf(club.id)).toBe(future.id);
    expect(await auditRows("club.owner_set", club.id)).toEqual([
      expect.objectContaining({ actorUserId: admin.id, data: { previousOwnerId: null, ownerId: future.id } }),
    ]);
  });

  it("makes a manager the owner by user id, removing their manager row, and can leave a club without an owner", async () => {
    const { club, owner, manager, admin } = await clubWithStaff();

    const promoted = await admin.agent.put(`/api/clubs/${club.id}/owner`).send({ userId: manager.user.id });

    expect(promoted.status).toBe(200);
    expect(promoted.body.owner).toEqual(staffUser(manager.user));
    expect(await managerIds(club.id)).not.toContain(manager.user.id);
    expect((await owner.agent.put(`/api/clubs/${club.id}`).send({ address: "Former owner" })).status).toBe(403);

    const cleared = await admin.agent.put(`/api/clubs/${club.id}/owner`).send({ userId: null });

    expect(cleared.status).toBe(200);
    expect(cleared.body.owner).toBeNull();
    expect(await ownerOf(club.id)).toBeNull();
    expect((await auditRows("club.owner_set", club.id)).map((row) => row.data)).toEqual(
      expect.arrayContaining([
        { previousOwnerId: owner.user.id, ownerId: manager.user.id },
        { previousOwnerId: manager.user.id, ownerId: null },
      ]),
    );
  });

  it("is for admins only: owners and managers are refused", async () => {
    const { club, owner, manager, stranger } = await clubWithStaff();

    expect((await (await anon()).put(`/api/clubs/${club.id}/owner`).send({ userId: stranger.user.id })).status).toBe(401);
    for (const who of [owner, manager]) {
      const response = await who.agent.put(`/api/clubs/${club.id}/owner`).send({ userId: stranger.user.id });

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: "Admin access required", code: "FORBIDDEN" });
    }
    expect(await ownerOf(club.id)).toBe(owner.user.id);
  });

  it("answers 404 for an unknown club or account, 409 for a deactivated one, 400 for a body naming an email", async () => {
    const { agent } = await signIn({ role: "admin" });
    const club = await createClub({ ownerId: null });
    const disabled = await createUser();
    await testDb().update(users).set({ isActive: false }).where(eq(users.id, disabled.id));

    const unknownClub = await agent.put(`/api/clubs/${UNKNOWN_ID}/owner`).send({ userId: null });
    const unknownId = await agent.put(`/api/clubs/${club.id}/owner`).send({ userId: UNKNOWN_ID });
    const inactive = await agent.put(`/api/clubs/${club.id}/owner`).send({ userId: disabled.id });
    const both = await agent.put(`/api/clubs/${club.id}/owner`).send({ email: disabled.email, userId: disabled.id });

    expect([unknownClub.status, unknownClub.body.code]).toEqual([404, "NOT_FOUND"]);
    expect([unknownId.status, unknownId.body.code]).toEqual([404, "USER_NOT_FOUND"]);
    expect([inactive.status, inactive.body.code]).toEqual([409, "USER_INACTIVE"]);
    expect(both.status).toBe(400);
    expect(await ownerOf(club.id)).toBeNull();
  });
});
