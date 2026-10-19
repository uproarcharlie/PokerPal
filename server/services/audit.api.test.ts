import type { Request } from "express";
import { beforeEach, describe, expect, it } from "vitest";
import { auditLog } from "@shared/schema";
import { resetDb, testDb } from "@test/helpers";
import { recordAudit } from "./audit";

beforeEach(resetDb);

/** Just the request fields recordAudit reads. */
function fakeRequest(fields: { userId?: string; impersonatorId?: string; ip?: string }): Request {
  return {
    user: fields.userId ? { id: fields.userId, email: "x@y", name: "X", role: "admin" } : undefined,
    impersonatorId: fields.impersonatorId,
    ip: fields.ip ?? "203.0.113.5",
    socket: {},
    get: () => undefined,
  } as unknown as Request;
}

describe("recordAudit", () => {
  it("records who did what to which record, and from where", async () => {
    await recordAudit(fakeRequest({ userId: "u-admin" }), {
      action: "user.update",
      targetType: "user",
      targetId: "u-1",
      data: { before: { role: "admin" }, after: { role: "full_member" } },
    });

    const [row] = await testDb().select().from(auditLog);
    expect(row).toMatchObject({
      actorUserId: "u-admin",
      action: "user.update",
      targetType: "user",
      targetId: "u-1",
      data: { before: { role: "admin" }, after: { role: "full_member" } },
      ip: "203.0.113.5",
    });
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it("names the impersonating admin as the actor, and the impersonated user in the data", async () => {
    await recordAudit(fakeRequest({ userId: "u-owner", impersonatorId: "u-admin" }), {
      action: "prize_pool.adjust",
      targetType: "tournament",
      targetId: "t-1",
      data: {
        mode: "ap_override",
        amountCents: 2_000,
        reason: null,
        previous: { manualPrizePool: null, rakeOverride: null, reason: null },
        netCentsBefore: 40_000,
        netCentsAfter: 42_000,
      },
    });

    const [row] = await testDb().select().from(auditLog);
    expect(row).toMatchObject({ actorUserId: "u-admin", data: { mode: "ap_override", amountCents: 2_000, asUserId: "u-owner" } });
  });

  it("writes inside the caller's transaction, so a rollback removes it", async () => {
    await expect(
      testDb().transaction(async (tx) => {
        await recordAudit(
          fakeRequest({ userId: "u-admin" }),
          { action: "club.delete", targetType: "club", targetId: "c-1", data: { name: "Gone", slug: "gone", imageUrl: null, tournamentImageUrls: [] } },
          tx,
        );
        throw new Error("the change failed");
      }),
    ).rejects.toThrow("the change failed");

    expect(await testDb().select().from(auditLog)).toEqual([]);
  });
});
