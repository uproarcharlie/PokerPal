import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { clubManagers, clubs, clubStaffInvites, users, type ClubStaffInvite } from "@shared/schema";
import type { Executor } from "../db";
import { accountForEmail } from "./users";

/** An account as staff management needs it: who they are and whether they may sign in. */
export interface StaffCandidate {
  id: string;
  name: string;
  email: string;
  /** NULL counts as inactive, as it does at sign-in. */
  isActive: boolean | null;
}

const candidateColumns = { id: users.id, name: users.name, email: users.email, isActive: users.isActive };

export async function findStaffCandidateById(ex: Executor, id: string): Promise<StaffCandidate | undefined> {
  const [user] = await ex.select(candidateColumns).from(users).where(eq(users.id, id)).limit(1);
  return user;
}

/** The account signing in with `email` (already lower-cased), by the same rule as sign-in (accountForEmail). */
export async function findStaffCandidateByEmail(ex: Executor, email: string): Promise<StaffCandidate | undefined> {
  const rule = accountForEmail(email);
  const [user] = await ex
    .select(candidateColumns)
    .from(users)
    .where(rule.where)
    .orderBy(...rule.order)
    .limit(1);
  return user;
}

export interface ManagerRow {
  user: { id: string; name: string; email: string };
  role: string;
  createdAt: Date;
}

/** The club's managers, first added first. */
export async function listManagers(ex: Executor, clubId: string): Promise<ManagerRow[]> {
  return ex
    .select({
      user: { id: users.id, name: users.name, email: users.email },
      role: clubManagers.role,
      createdAt: clubManagers.createdAt,
    })
    .from(clubManagers)
    .innerJoin(users, eq(users.id, clubManagers.userId))
    .where(eq(clubManagers.clubId, clubId))
    .orderBy(asc(clubManagers.createdAt), asc(clubManagers.id));
}

export async function isManager(ex: Executor, clubId: string, userId: string): Promise<boolean> {
  const [row] = await ex
    .select({ id: clubManagers.id })
    .from(clubManagers)
    .where(and(eq(clubManagers.clubId, clubId), eq(clubManagers.userId, userId)))
    .limit(1);
  return row !== undefined;
}

/** A concurrent add of the same person fails on uq_club_managers_club_user (409 ALREADY_MANAGER). */
export async function insertManager(
  ex: Executor,
  manager: { clubId: string; userId: string; createdBy: string | null },
): Promise<void> {
  await ex.insert(clubManagers).values({ ...manager, role: "manager" });
}

/** Whether a manager row was removed. */
export async function deleteManager(ex: Executor, clubId: string, userId: string): Promise<boolean> {
  const removed = await ex
    .delete(clubManagers)
    .where(and(eq(clubManagers.clubId, clubId), eq(clubManagers.userId, userId)))
    .returning({ id: clubManagers.id });
  return removed.length > 0;
}

export async function setClubOwner(ex: Executor, clubId: string, ownerId: string | null): Promise<void> {
  await ex.update(clubs).set({ ownerId }).where(eq(clubs.id, clubId));
}

// Staff invitations (SEC-P2REV-03)

/** An invitation that can still be accepted at `now`: not accepted, not revoked, not expired. */
const openAt = (now: Date) => and(isNull(clubStaffInvites.acceptedAt), isNull(clubStaffInvites.revokedAt), gt(clubStaffInvites.expiresAt, now));

export async function insertInvite(ex: Executor, invite: typeof clubStaffInvites.$inferInsert): Promise<ClubStaffInvite> {
  const [row] = await ex.insert(clubStaffInvites).values(invite).returning();
  return row;
}

/** The club's open invitations, oldest first. */
export async function listOpenInvites(ex: Executor, clubId: string, now: Date): Promise<ClubStaffInvite[]> {
  return ex
    .select()
    .from(clubStaffInvites)
    .where(and(eq(clubStaffInvites.clubId, clubId), openAt(now)))
    .orderBy(asc(clubStaffInvites.createdAt), asc(clubStaffInvites.id));
}

/** Revokes the club's open invitations for this address and role (an invitation sent again replaces them). */
export async function revokeOpenInvitesFor(ex: Executor, clubId: string, email: string, role: string, now: Date): Promise<void> {
  await ex
    .update(clubStaffInvites)
    .set({ revokedAt: now })
    .where(and(eq(clubStaffInvites.clubId, clubId), eq(clubStaffInvites.email, email), eq(clubStaffInvites.role, role), openAt(now)));
}

/** Revokes one open invitation of the club; undefined when there is none open with that id. */
export async function revokeInvite(ex: Executor, clubId: string, inviteId: string, now: Date): Promise<ClubStaffInvite | undefined> {
  const [row] = await ex
    .update(clubStaffInvites)
    .set({ revokedAt: now })
    .where(and(eq(clubStaffInvites.clubId, clubId), eq(clubStaffInvites.id, inviteId), openAt(now)))
    .returning();
  return row;
}

/** The invitation with this secret's hash, locked until the transaction ends, whatever its state. */
export async function lockInviteByTokenHash(ex: Executor, tokenHash: string): Promise<ClubStaffInvite | undefined> {
  const [row] = await ex.select().from(clubStaffInvites).where(eq(clubStaffInvites.tokenHash, tokenHash)).for("update");
  return row;
}

export async function markInviteAccepted(ex: Executor, inviteId: string, userId: string, now: Date): Promise<void> {
  await ex.update(clubStaffInvites).set({ acceptedBy: userId, acceptedAt: now }).where(eq(clubStaffInvites.id, inviteId));
}
