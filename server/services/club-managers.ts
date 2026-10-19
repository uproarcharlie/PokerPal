import { createHash, randomBytes } from "node:crypto";
import type { Request } from "express";
import {
  STAFF_INVITE_TTL_DAYS,
  type AcceptStaffInviteResponse,
  type ClubStaffDto,
  type CreateStaffInviteInput,
  type CreateStaffInviteResponse,
  type SetClubOwnerInput,
  type StaffInviteDto,
  type StaffInviteRole,
  type StaffUser,
} from "@shared/api/clubs";
import type { ClubStaffInvite } from "@shared/schema";
import { db, type Executor } from "../db";
import { actingUserId, currentUser, isAdmin } from "../http/authz";
import { conflict, forbidden, HttpError, notFound } from "../http/errors";
import * as clubsRepo from "../repositories/clubs";
import * as staffRepo from "../repositories/club-managers";
import { recordAudit } from "./audit";

/**
 * A club's staff: its owner (clubs.owner_id) and its managers (club_managers). Only the owner or an
 * admin changes the managers; only an admin changes the owner. Every change is audited.
 *
 * Nobody becomes staff because of an email address alone: nothing proves an account owns the address
 * it signed up with (or changed to), so whoever claimed an address first would get the role
 * (SEC-P2REV-03). The owner (or an admin) creates an invitation for the address instead and sends its
 * secret link to the person; the role is granted only when that link is opened by the account that
 * signs in with the address. The secret is shown once and only its hash is stored, so the link is
 * the proof: an account holding the address without the link gets nothing, and someone holding the
 * link without the address gets nothing either.
 */

const userNotFound = () => new HttpError(404, "USER_NOT_FOUND", "No such account");

const staffUser = ({ id, name, email }: StaffUser): StaffUser => ({ id, name, email });

const toInviteDto = (invite: ClubStaffInvite): StaffInviteDto => ({
  id: invite.id,
  email: invite.email,
  role: invite.role as StaffInviteRole,
  createdAt: invite.createdAt.toISOString(),
  expiresAt: invite.expiresAt.toISOString(),
});

export async function getStaff(clubId: string, ex: Executor = db): Promise<ClubStaffDto> {
  const club = await clubsRepo.getClub(ex, clubId);
  if (!club) throw notFound("Club not found");
  const [owner, managers, invites] = await Promise.all([
    club.ownerId ? staffRepo.findStaffCandidateById(ex, club.ownerId) : undefined,
    staffRepo.listManagers(ex, clubId),
    staffRepo.listOpenInvites(ex, clubId, new Date()),
  ]);
  return {
    clubId,
    owner: owner ? staffUser(owner) : null,
    managers: managers.map((manager) => ({
      user: manager.user,
      role: "manager",
      createdAt: manager.createdAt.toISOString(),
    })),
    invites: invites.map(toInviteDto),
  };
}

/** 409 USER_INACTIVE for an account that cannot sign in: it could never use the role. */
function assertActive(user: staffRepo.StaffCandidate): void {
  if (!user.isActive) throw conflict("USER_INACTIVE", "That account is deactivated");
}

/** The sha256 of an invitation's secret: all that is stored of it. */
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Owner invitations hand the club over, so only an admin issues or withdraws them. */
function assertMayHandle(req: Request, role: StaffInviteRole): void {
  if (role === "owner" && !isAdmin(req.user)) throw forbidden("Only a platform admin can invite a new owner");
}

/**
 * POST /api/clubs/:id/invites: an invitation for `email` to become a manager (or, from an admin, the
 * owner), valid for STAFF_INVITE_TTL_DAYS. Refused when that address already signs in to the owner's
 * account (409 IS_OWNER) or, for a manager invitation, to one of its managers (409 ALREADY_MANAGER).
 * No account needs to exist yet; an open invitation for the same address and role is replaced.
 */
export async function createInvite(req: Request, clubId: string, input: CreateStaffInviteInput): Promise<CreateStaffInviteResponse> {
  assertMayHandle(req, input.role);
  return db.transaction(async (tx) => {
    // Locking the club queues concurrent staff changes.
    const club = await clubsRepo.lockClub(tx, clubId);
    if (!club) throw notFound("Club not found");
    const holder = await staffRepo.findStaffCandidateByEmail(tx, input.email);
    if (holder && club.ownerId === holder.id) throw conflict("IS_OWNER", "That address belongs to the club's owner");
    if (holder && input.role === "manager" && (await staffRepo.isManager(tx, clubId, holder.id))) {
      throw conflict("ALREADY_MANAGER", "That address belongs to one of the club's managers");
    }

    const now = new Date();
    await staffRepo.revokeOpenInvitesFor(tx, clubId, input.email, input.role, now);
    const token = randomBytes(32).toString("base64url");
    const invite = await staffRepo.insertInvite(tx, {
      clubId,
      role: input.role,
      email: input.email,
      tokenHash: hashToken(token),
      createdBy: actingUserId(req),
      createdAt: now,
      expiresAt: new Date(now.getTime() + STAFF_INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
    });
    await recordAudit(
      req,
      {
        action: "club.invite_created",
        targetType: "club",
        targetId: clubId,
        data: { inviteId: invite.id, role: invite.role, email: invite.email, expiresAt: invite.expiresAt.toISOString() },
      },
      tx,
    );
    return { staff: await getStaff(clubId, tx), invite: toInviteDto(invite), token };
  });
}

/** DELETE /api/clubs/:id/invites/:inviteId: 404 when the club has no open invitation with that id. */
export async function revokeInvite(req: Request, clubId: string, inviteId: string): Promise<ClubStaffDto> {
  return db.transaction(async (tx) => {
    if (!(await clubsRepo.lockClub(tx, clubId))) throw notFound("Club not found");
    const open = (await staffRepo.listOpenInvites(tx, clubId, new Date())).find((invite) => invite.id === inviteId);
    if (!open) throw notFound("That invitation is not open");
    assertMayHandle(req, open.role as StaffInviteRole);
    const revoked = await staffRepo.revokeInvite(tx, clubId, inviteId, new Date());
    if (!revoked) throw notFound("That invitation is not open");
    await recordAudit(
      req,
      { action: "club.invite_revoked", targetType: "club", targetId: clubId, data: { inviteId, role: revoked.role, email: revoked.email } },
      tx,
    );
    return getStaff(clubId, tx);
  });
}

const inviteInvalid = () =>
  new HttpError(404, "INVITE_INVALID", "This invitation link is not valid any more: ask the club for a new one");

/**
 * POST /api/staff-invites/accept: the signed-in user takes the role an open invitation offers, if it
 * was made for the address they sign in with (403 INVITE_FOR_ANOTHER_ACCOUNT otherwise; the address
 * is not revealed). Unknown, revoked or used by someone else: 404 INVITE_INVALID; expired: 409
 * INVITE_EXPIRED. Accepting again an invitation this user already accepted answers the same. A
 * manager invitation for the club's owner is 409 IS_OWNER. An owner invitation makes them the owner
 * (the previous owner is no longer staff) and drops their manager row. One transaction, audited.
 */
export async function acceptInvite(req: Request, token: string): Promise<AcceptStaffInviteResponse> {
  const user = currentUser(req);
  return db.transaction(async (tx) => {
    const invite = await staffRepo.lockInviteByTokenHash(tx, hashToken(token));
    if (!invite || invite.revokedAt) throw inviteInvalid();
    const club = await clubsRepo.lockClub(tx, invite.clubId);
    if (!club) throw inviteInvalid();
    const role = invite.role as StaffInviteRole;
    const result = { clubId: club.id, clubName: club.name, role };
    if (invite.acceptedAt) {
      if (invite.acceptedBy === user.id) return result;
      throw inviteInvalid();
    }
    const now = new Date();
    if (invite.expiresAt.getTime() <= now.getTime()) {
      throw conflict("INVITE_EXPIRED", "This invitation has expired: ask the club for a new one");
    }
    const holder = await staffRepo.findStaffCandidateByEmail(tx, invite.email);
    if (!holder || holder.id !== user.id) {
      throw new HttpError(
        403,
        "INVITE_FOR_ANOTHER_ACCOUNT",
        "This invitation is for another email address: sign in with the account that uses the address it was sent to",
      );
    }

    if (role === "owner") {
      if (club.ownerId !== user.id) {
        await staffRepo.setClubOwner(tx, club.id, user.id);
        await staffRepo.deleteManager(tx, club.id, user.id);
        await recordAudit(
          req,
          {
            action: "club.owner_set",
            targetType: "club",
            targetId: club.id,
            data: { previousOwnerId: club.ownerId, ownerId: user.id, inviteId: invite.id },
          },
          tx,
        );
      }
    } else {
      if (club.ownerId === user.id) throw conflict("IS_OWNER", "You own this club, so you already manage it");
      if (!(await staffRepo.isManager(tx, club.id, user.id))) {
        // Who added them is whoever sent the invitation; the audit row's actor is the person accepting it.
        await staffRepo.insertManager(tx, { clubId: club.id, userId: user.id, createdBy: invite.createdBy });
        await recordAudit(
          req,
          { action: "club.manager_added", targetType: "club", targetId: club.id, data: { userId: user.id, inviteId: invite.id } },
          tx,
        );
      }
    }
    await staffRepo.markInviteAccepted(tx, invite.id, user.id, now);
    return result;
  });
}

/** DELETE /api/clubs/:id/managers/:userId: 404 when that person is not one of its managers. */
export async function removeManager(req: Request, clubId: string, userId: string): Promise<ClubStaffDto> {
  return db.transaction(async (tx) => {
    if (!(await clubsRepo.lockClub(tx, clubId))) throw notFound("Club not found");
    if (!(await staffRepo.deleteManager(tx, clubId, userId))) throw notFound("That person is not a manager of this club");
    await recordAudit(req, { action: "club.manager_removed", targetType: "club", targetId: clubId, data: { userId } }, tx);
    return getStaff(clubId, tx);
  });
}

/**
 * PUT /api/clubs/:id/owner (admins): a new owner by user id (an account the admin picked), or none
 * (`userId: null`). The new owner's manager row, if any, goes in the same transaction: owning
 * implies managing. To hand a club to someone by their email address, send an owner invitation.
 */
export async function setOwner(req: Request, clubId: string, input: SetClubOwnerInput): Promise<ClubStaffDto> {
  return db.transaction(async (tx) => {
    const club = await clubsRepo.lockClub(tx, clubId);
    if (!club) throw notFound("Club not found");

    let ownerId: string | null = null;
    if (input.userId !== null) {
      const user = await staffRepo.findStaffCandidateById(tx, input.userId);
      if (!user) throw userNotFound();
      assertActive(user);
      ownerId = user.id;
    }

    if (ownerId !== club.ownerId) {
      await staffRepo.setClubOwner(tx, clubId, ownerId);
      if (ownerId) await staffRepo.deleteManager(tx, clubId, ownerId);
      await recordAudit(
        req,
        { action: "club.owner_set", targetType: "club", targetId: clubId, data: { previousOwnerId: club.ownerId, ownerId } },
        tx,
      );
    }
    return getStaff(clubId, tx);
  });
}
