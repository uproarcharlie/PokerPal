/**
 * Payments by bank transfer (round 8; the owner: "the club might want to add a bank account to receive
 * payment ahead of time … a toggle to give the bank details after registering so that they can
 * transfer"). The club's bank details are its staff's alone (GET and PUT /api/clubs/:id/payments); a
 * tournament may show them after sign-up only while the club has them; the sign-up's own answer then
 * says what to transfer (the buy-in only: the high hand is paid at the door; nothing for a free entry),
 * with the player's name as the reference, and tells a waiting-list player not to pay yet. Staff record
 * how each entry paid (paidBy). No public read carries any of it (also public-pii.api.test.ts).
 */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { BankDetailsChangeDto, ClubPaymentsDto } from "@shared/api/clubs";
import { BANK_DETAIL_KEYS, findForbiddenKeys, findTakingsKeys } from "@shared/api/public";
import type { NothingToTransferDto, PaymentInstructionsDto, RegistrationCreatedDto } from "@shared/api/registrations";
import { activityLog, auditLog, clubs, tournamentRegistrations, type Club } from "@shared/schema";
import { createClub, createPlayer, createRegistration, createTournament, type NewTournament } from "../factories";
import { anon, resetDb, testDb, UNKNOWN_ID } from "../helpers";
import { clubWithStaff, type ClubStaffAgents } from "../helpers/club-staff";
import { signUpTokenFor } from "../helpers/sign-up";

beforeEach(resetDb);

const BANK_DETAILS = {
  accountName: "Central Stars Poker Club",
  accountNumber: "12-3456-7890123-00",
  bankName: "ASB",
  instructions: "Pay by 5pm on the day",
};

type Agent = ClubStaffAgents["owner"]["agent"];

const clubRow = async (id: string): Promise<Club> => (await testDb().select().from(clubs).where(eq(clubs.id, id)))[0];
const registrationRow = async (id: string) =>
  (await testDb().select().from(tournamentRegistrations).where(eq(tournamentRegistrations.id, id)))[0];

const putPayments = (agent: Agent, clubId: string, bankDetails: unknown) => agent.put(`/api/clubs/${clubId}/payments`).send({ bankDetails });

const ALL_FIELDS = ["accountName", "accountNumber", "bankName", "instructions"];
/** The Payments tab's line for a change: when (just now, as ISO 8601), who, and what. */
const changeBy = (by: string | null, change: BankDetailsChangeDto["change"], fields: string[]) => ({
  at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/),
  by,
  change,
  fields,
});
const added = (by: string) => changeBy(by, "added", ALL_FIELDS);

/** A club whose staff set its bank details, and a $50 game (with a $5 high hand) that shows them after sign-up. */
async function transferGame(overrides: Partial<NewTournament> = {}) {
  const staff = await clubWithStaff();
  expect((await putPayments(staff.owner.agent, staff.club.id, BANK_DETAILS)).status).toBe(200);
  const tournament = await createTournament({
    clubId: staff.club.id,
    name: "Wed Night",
    status: "registration",
    startDateTime: new Date("2026-11-18T06:30:00Z"),
    buyInAmount: "50.00",
    enableHighHand: true,
    highHandAmount: "5.00",
    showBankTransfer: true,
    ...overrides,
  });
  return { staff, tournament, td: staff.manager.agent };
}

/** The QR page's sign-up of a player whose details the visitor typed in (with POST /api/players's token). */
async function qrSignUp(tournamentId: string, name: string, body: Record<string, unknown> = {}) {
  const player = await createPlayer({ name });
  const response = await (await anon())
    .post(`/api/tournaments/${tournamentId}/registrations`)
    .send({ playerId: player.id, signUpToken: signUpTokenFor(player.id), ...body });
  return { player, response, body: response.body as RegistrationCreatedDto };
}

const instructions = (overrides: Partial<PaymentInstructionsDto> = {}): PaymentInstructionsDto => ({
  ...BANK_DETAILS,
  amountDueCents: 5_000,
  particulars: "Wed Night",
  reference: "Tama Rangi",
  highHandAtDoorCents: 0,
  waitingList: false,
  ...overrides,
});

describe("GET and PUT /api/clubs/:id/payments (the club's bank details)", () => {
  it("has none for a new club, and never lets the answer be cached", async () => {
    const { club, owner } = await clubWithStaff();

    const response = await owner.agent.get(`/api/clubs/${club.id}/payments`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ clubId: club.id, bankDetails: null, changes: [] } satisfies ClubPaymentsDto);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("stores what a manager sets, trimmed, with the account number as the banks write it", async () => {
    const { club, manager, owner } = await clubWithStaff();

    const response = await putPayments(manager.agent, club.id, {
      accountName: "  Central Stars Poker Club ",
      accountNumber: " 12 3456 7890123 00 ",
      bankName: " ASB ",
      instructions: "  Pay by 5pm on the day ",
    });

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual({ clubId: club.id, bankDetails: BANK_DETAILS, changes: [added(manager.user.name)] });
    expect(await clubRow(club.id)).toMatchObject({
      bankAccountName: "Central Stars Poker Club",
      bankAccountNumber: "12-3456-7890123-00",
      bankName: "ASB",
      bankInstructions: "Pay by 5pm on the day",
    });
    expect((await owner.agent.get(`/api/clubs/${club.id}/payments`)).body).toEqual({ clubId: club.id, bankDetails: BANK_DETAILS, changes: [added(manager.user.name)] });
  });

  it.each([
    ["dashes", "01-0123-0123456-00", "01-0123-0123456-00"],
    ["a three-digit suffix", "38-9000-1234567-001", "38-9000-1234567-001"],
    ["spaces", "02 0100 0123456 000", "02-0100-0123456-000"],
    ["no separators, 15 digits", "123456789012300", "12-3456-7890123-00"],
    ["no separators, 16 digits", "1234567890123001", "12-3456-7890123-001"],
    ["mixed spacing", "12 - 3456 - 7890123 - 00", "12-3456-7890123-00"],
  ])("accepts an account number with %s", async (_, typed, stored) => {
    const { club, owner } = await clubWithStaff();

    const response = await putPayments(owner.agent, club.id, { accountName: "Club", accountNumber: typed });

    expect(response.status).toBe(200);
    expect(response.body.bankDetails).toEqual({ accountName: "Club", accountNumber: stored, bankName: null, instructions: null });
  });

  it.each([
    ["too few digits", "12-3456-789012-00"],
    ["too many digits", "12-3456-7890123-0001"],
    ["parts of the wrong length", "123-456-7890123-00"],
    ["a suffix of one digit", "12-3456-78901234-0"],
    ["letters", "12-3456-789O123-00"],
    ["a blank", "   "],
    ["an IBAN", "GB82 WEST 1234 5698 7654 32"],
  ])("refuses an account number with %s, on its field", async (_, accountNumber) => {
    const { club, owner } = await clubWithStaff();

    const response = await putPayments(owner.agent, club.id, { accountName: "Club", accountNumber });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: "VALIDATION", error: "Invalid bank details" });
    expect(response.body.details).toEqual([expect.objectContaining({ path: ["bankDetails", "accountNumber"] })]);
    expect((await clubRow(club.id)).bankAccountNumber).toBeNull();
  });

  it("refuses details without an account name, an over-long note, and a body that is not { bankDetails }", async () => {
    const { club, owner } = await clubWithStaff();

    const noName = await putPayments(owner.agent, club.id, { accountName: " ", accountNumber: BANK_DETAILS.accountNumber });
    const longNote = await putPayments(owner.agent, club.id, { ...BANK_DETAILS, instructions: "x".repeat(301) });
    const flat = await owner.agent.put(`/api/clubs/${club.id}/payments`).send(BANK_DETAILS);

    expect(noName.status).toBe(400);
    expect(noName.body.details).toEqual([expect.objectContaining({ path: ["bankDetails", "accountName"] })]);
    expect(longNote.status).toBe(400);
    expect(longNote.body.details).toEqual([expect.objectContaining({ path: ["bankDetails", "instructions"] })]);
    expect(flat.status).toBe(400);
    expect((await clubRow(club.id)).bankAccountName).toBeNull();
  });

  it("replaces the details whole (a bank or note left out is removed), and removes them with null", async () => {
    const { club, owner } = await clubWithStaff();
    await putPayments(owner.agent, club.id, BANK_DETAILS);

    const replaced = await putPayments(owner.agent, club.id, { accountName: "New Name", accountNumber: "01-0001-0000001-00" });
    expect(replaced.body.bankDetails).toEqual({ accountName: "New Name", accountNumber: "01-0001-0000001-00", bankName: null, instructions: null });

    const removed = await putPayments(owner.agent, club.id, null);
    expect(removed.status).toBe(200);
    expect(removed.body).toMatchObject({ clubId: club.id, bankDetails: null });
    expect(await clubRow(club.id)).toMatchObject({ bankAccountName: null, bankAccountNumber: null, bankName: null, bankInstructions: null });
  });

  it("records each change in the audit log, before and after, with who made it; a save that changes nothing is not recorded", async () => {
    const { club, owner, manager } = await clubWithStaff();
    const audited = () =>
      testDb()
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.action, "club.bank_details"), eq(auditLog.targetId, club.id)))
        .orderBy(auditLog.createdAt);
    const changed = { ...BANK_DETAILS, accountNumber: "01-0001-0000001-00" };

    await putPayments(owner.agent, club.id, BANK_DETAILS);
    await putPayments(owner.agent, club.id, BANK_DETAILS);
    await putPayments(manager.agent, club.id, changed);
    await putPayments(manager.agent, club.id, null);
    await putPayments(manager.agent, club.id, null);

    expect(await audited()).toEqual([
      expect.objectContaining({ actorUserId: owner.user.id, targetType: "club", data: { before: null, after: BANK_DETAILS } }),
      expect.objectContaining({ actorUserId: manager.user.id, data: { before: BANK_DETAILS, after: changed } }),
      expect.objectContaining({ actorUserId: manager.user.id, data: { before: changed, after: null } }),
    ]);
  });

  it("tell the club's staff who changed the details and when, newest first: the owner sees a manager's new account number (R8REV0-PRIV-03)", async () => {
    const { club, owner, manager, admin } = await clubWithStaff();
    const startedAt = Date.now();
    const redirected = { ...BANK_DETAILS, accountNumber: "01-0001-0000001-00" };

    await putPayments(owner.agent, club.id, BANK_DETAILS);
    await putPayments(manager.agent, club.id, redirected);
    await putPayments(manager.agent, club.id, redirected);
    const removed = await putPayments(admin.agent, club.id, null);

    const expected = [changeBy(admin.user.name, "removed", ALL_FIELDS), changeBy(manager.user.name, "changed", ["accountNumber"]), added(owner.user.name)];
    expect(removed.body.changes).toEqual(expected);
    const read = await owner.agent.get(`/api/clubs/${club.id}/payments`);
    expect(read.body).toEqual({ clubId: club.id, bankDetails: null, changes: expected });
    const times = (read.body as ClubPaymentsDto).changes.map((change) => Date.parse(change.at));
    expect(times.every((time) => time >= startedAt - 1_000 && time <= Date.now() + 1_000)).toBe(true);
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    // A change says which parts differ, not what they were or became.
    for (const accountNumber of [BANK_DETAILS.accountNumber, redirected.accountNumber]) expect(JSON.stringify(read.body.changes)).not.toContain(accountNumber);
  });

  it("send the latest five changes only, and no name for an account that is gone", async () => {
    const { club, owner, manager } = await clubWithStaff();
    for (const bankName of ["ASB", "ANZ", "BNZ", "Kiwibank", "Westpac", "TSB"]) await putPayments(manager.agent, club.id, { ...BANK_DETAILS, bankName });
    await testDb().update(auditLog).set({ actorUserId: UNKNOWN_ID }).where(eq(auditLog.targetId, club.id));

    const { body } = await owner.agent.get(`/api/clubs/${club.id}/payments`);

    expect(body.bankDetails.bankName).toBe("TSB");
    expect(body.changes).toEqual(Array.from({ length: 5 }, () => changeBy(null, "changed", ["bankName"])));
  });

  it("reads a stored row with only a name or only a number as no bank details", async () => {
    const { club, owner } = await clubWithStaff();
    await testDb().update(clubs).set({ bankAccountName: "Half Set", bankAccountNumber: null }).where(eq(clubs.id, club.id));

    expect((await owner.agent.get(`/api/clubs/${club.id}/payments`)).body).toEqual({ clubId: club.id, bankDetails: null, changes: [] });
  });

  it("is 404 for an unknown club, and refused to anyone outside its staff", async () => {
    const { club, stranger, admin } = await clubWithStaff();

    expect((await admin.agent.get(`/api/clubs/${UNKNOWN_ID}/payments`)).status).toBe(404);
    expect((await stranger.agent.get(`/api/clubs/${club.id}/payments`)).status).toBe(403);
    expect((await (await anon()).get(`/api/clubs/${club.id}/payments`)).status).toBe(401);
    expect((await putPayments(stranger.agent, club.id, BANK_DETAILS)).status).toBe(403);
    expect((await clubRow(club.id)).bankAccountNumber).toBeNull();
  });

  it("are never set by the club form, nor sent by any club read, its staff's included", async () => {
    const { club, owner } = await clubWithStaff();
    await putPayments(owner.agent, club.id, BANK_DETAILS);

    const edit = await owner.agent.put(`/api/clubs/${club.id}`).send({ name: "Renamed", bankAccountNumber: "99-9999-9999999-99", bankDetails: null });
    expect(edit.status).toBe(200);
    expect((await clubRow(club.id)).bankAccountNumber).toBe(BANK_DETAILS.accountNumber);

    const reads = await Promise.all([owner.agent.get("/api/clubs"), owner.agent.get(`/api/clubs/${club.id}`), owner.agent.get(`/api/clubs/slug/${club.slug}`)]);
    for (const read of [edit, ...reads]) {
      expect(read.status).toBe(200);
      expect(findForbiddenKeys(read.body)).toEqual([]);
      expect(JSON.stringify(read.body)).not.toContain("7890123");
    }
  });
});

describe("the tournament's showBankTransfer setting", () => {
  const newTournament = (clubId: string, extra: Record<string, unknown> = {}) => ({
    clubId,
    name: "Transfer Night",
    startDateTime: "2026-11-18T06:30:00Z",
    buyInAmount: "50.00",
    maxPlayers: 40,
    ...extra,
  });

  it("is off unless asked for, and says so to everyone", async () => {
    const { club, owner } = await clubWithStaff();

    const created = await owner.agent.post("/api/tournaments").send(newTournament(club.id));

    expect(created.status).toBe(201);
    expect(created.body.showBankTransfer).toBe(false);
    expect((await (await anon()).get(`/api/tournaments/${created.body.id}`)).body.showBankTransfer).toBe(false);
  });

  it("is refused on create, on its field, while the club has no bank details", async () => {
    const { club, owner } = await clubWithStaff();

    const response = await owner.agent.post("/api/tournaments").send(newTournament(club.id, { showBankTransfer: true }));

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION");
    expect(response.body.error).toMatch(/bank details/);
    expect(response.body.details).toEqual([expect.objectContaining({ path: ["showBankTransfer"] })]);
  });

  it("is turned on at create and on edit once the club has bank details, and shown to anyone (the details are not)", async () => {
    const { club, owner, manager } = await clubWithStaff();
    await putPayments(owner.agent, club.id, BANK_DETAILS);
    const plain = await createTournament({ clubId: club.id });

    const created = await manager.agent.post("/api/tournaments").send(newTournament(club.id, { showBankTransfer: true }));
    const edited = await manager.agent.put(`/api/tournaments/${plain.id}`).send({ showBankTransfer: true });

    expect(created.status).toBe(201);
    expect(created.body.showBankTransfer).toBe(true);
    expect(edited.status).toBe(200);
    expect(edited.body.showBankTransfer).toBe(true);
    const anonymous = await anon();
    for (const read of [await anonymous.get(`/api/tournaments/${plain.id}`), await anonymous.get(`/api/tournaments?clubId=${club.id}`)]) {
      expect(JSON.stringify(read.body)).toContain('"showBankTransfer":true');
      expect(findForbiddenKeys(read.body)).toEqual([]);
      expect(JSON.stringify(read.body)).not.toContain("7890123");
    }
  });

  it("is refused on edit without bank details; resent unchanged after they are removed, it is kept; turned off, always", async () => {
    const { club, owner } = await clubWithStaff();
    const off = await createTournament({ clubId: club.id });
    const on = await createTournament({ clubId: club.id, showBankTransfer: true });

    const refused = await owner.agent.put(`/api/tournaments/${off.id}`).send({ showBankTransfer: true });
    const resent = await owner.agent.put(`/api/tournaments/${on.id}`).send({ name: "Renamed", showBankTransfer: true });
    const turnedOff = await owner.agent.put(`/api/tournaments/${on.id}`).send({ showBankTransfer: false });

    expect(refused.status).toBe(400);
    expect(refused.body.details).toEqual([expect.objectContaining({ path: ["showBankTransfer"] })]);
    expect(resent.status).toBe(200);
    expect(resent.body).toMatchObject({ name: "Renamed", showBankTransfer: true });
    expect(turnedOff.status).toBe(200);
    expect(turnedOff.body.showBankTransfer).toBe(false);
  });
});

describe("the sign-up's payment instructions", () => {
  it("tell a QR sign-up the club's account, the buy-in to transfer, and their name as the reference, never cached", async () => {
    const { tournament } = await transferGame();

    const { response, body } = await qrSignUp(tournament.id, "Tama Rangi");

    expect(response.status).toBe(201);
    expect(body.paymentInstructions).toEqual(instructions());
    expect(body.waitingListPosition).toBeNull();
    expect(response.headers["cache-control"]).toBe("no-store");
    // Only here: the registration itself says nothing of the payment.
    expect(findTakingsKeys(body)).toEqual([]);
  });

  it("tell a returning player found by the club's search (no sign-up token) the same", async () => {
    const { staff, tournament } = await transferGame();
    const regular = await createPlayer({ name: "Regular Rita" });
    const earlier = await createTournament({ clubId: staff.club.id, status: "completed" });
    await createRegistration({ tournamentId: earlier.id, playerId: regular.id, paymentConfirmed: true });

    const response = await (await anon()).post(`/api/tournaments/${tournament.id}/registrations`).send({ playerId: regular.id });

    expect(response.status).toBe(201);
    expect(response.body.paymentInstructions).toEqual(instructions({ reference: "Regular Rita" }));
  });

  it("leave the ticked high hand out of the transfer: it is paid at the door", async () => {
    const { tournament } = await transferGame();

    const { body } = await qrSignUp(tournament.id, "Tama Rangi", { enteringHighHands: true });

    expect(body.paymentInstructions).toEqual(instructions({ amountDueCents: 5_000, highHandAtDoorCents: 500 }));
  });

  it("cut the reference to the 12 characters a transfer takes, and suggest the game's day for a long name, in the club's time zone", async () => {
    // 12:00 UTC on Wednesday 18 November is 1am on Thursday 19 November in Auckland.
    const { tournament } = await transferGame({ name: "Central Stars One Life Line", startDateTime: new Date("2026-11-18T12:00:00Z") });

    const { body } = await qrSignUp(tournament.id, "  Alexandra   Fitzgerald-Smythe ");

    expect(body.paymentInstructions).toMatchObject({ reference: "Alexandra Fi", particulars: "Thu 19 Nov" });
  });

  it("tell a waiting-list sign-up there is nothing to pay yet, without the club's account (R8REV0-PRIV-01)", async () => {
    const { tournament, td } = await transferGame({ maxPlayers: 2 });
    for (const name of ["Ann", "Bob"]) {
      await createRegistration({ tournamentId: tournament.id, playerId: (await createPlayer({ name })).id, paymentConfirmed: true });
    }

    const { response, body } = await qrSignUp(tournament.id, "Cat Waiting", { enteringHighHands: true });
    const atDesk = await td.post(`/api/tournaments/${tournament.id}/registrations`).send({ playerId: (await createPlayer({ name: "Dee Waiting" })).id });

    expect(body.waitingListPosition).toBe(1);
    expect(body.paymentInstructions).toEqual({ amountDueCents: 5_000, highHandAtDoorCents: 500, waitingList: true } satisfies NothingToTransferDto);
    expect(atDesk.status).toBe(201);
    expect(atDesk.body.waitingListPosition).toBe(2);
    expect(atDesk.body.paymentInstructions).toEqual({ amountDueCents: 5_000, highHandAtDoorCents: 0, waitingList: true });
    for (const answer of [response, atDesk]) {
      expect(answer.body.paymentInstructions).not.toHaveProperty("accountNumber");
      expect(findForbiddenKeys(answer.body).filter((path) => path.startsWith("paymentInstructions"))).toEqual(["paymentInstructions"]);
      const text = JSON.stringify(answer.body);
      for (const value of Object.values(BANK_DETAILS)) expect(text).not.toContain(value);
    }
  });

  it("give a sign-up for a $0 game nothing to transfer, and not the club's account", async () => {
    const { tournament } = await transferGame({ buyInAmount: "0.00" });

    const { response, body } = await qrSignUp(tournament.id, "Fay Freeroll", { enteringHighHands: true });

    expect(response.status).toBe(201);
    expect(body.paymentInstructions).toEqual({ amountDueCents: 0, highHandAtDoorCents: 500, waitingList: false } satisfies NothingToTransferDto);
    expect(JSON.stringify(body)).not.toContain(BANK_DETAILS.accountNumber);
  });

  it("go to the desk's sign-ups too: nothing to transfer for a free entry, and none for a player registered as paid", async () => {
    const { tournament, td } = await transferGame();
    const [paying, free, paid] = [await createPlayer({ name: "Desk Dan" }), await createPlayer({ name: "Free Fran" }), await createPlayer({ name: "Paid Pat" })];

    const desk = await td.post(`/api/tournaments/${tournament.id}/registrations`).send({ playerId: paying.id });
    const freeEntry = await td
      .post(`/api/tournaments/${tournament.id}/registrations`)
      .send({ playerId: free.id, enteringHighHands: true, freeEntry: { reason: "season_prize" } });
    const paidAtDesk = await td.post(`/api/tournaments/${tournament.id}/registrations`).send({ playerId: paid.id, paymentConfirmed: true, paidBy: "cash" });

    expect(desk.status).toBe(201);
    expect(desk.body.paymentInstructions).toEqual(instructions({ reference: "Desk Dan" }));
    expect(freeEntry.status).toBe(201);
    expect(freeEntry.body.paymentInstructions).toEqual({ amountDueCents: 0, highHandAtDoorCents: 500, waitingList: false } satisfies NothingToTransferDto);
    expect(paidAtDesk.status).toBe(201);
    expect(paidAtDesk.body).not.toHaveProperty("paymentInstructions");
  });

  it("are left out while the tournament does not show them, or its club has none any more", async () => {
    const { staff, tournament } = await transferGame();
    const hidden = await createTournament({ clubId: staff.club.id, status: "registration" });

    const off = await qrSignUp(hidden.id, "Off Olly");
    await putPayments(staff.owner.agent, staff.club.id, null);
    const removed = await qrSignUp(tournament.id, "Gone Gus");

    for (const { response } of [off, removed]) {
      expect(response.status).toBe(201);
      expect(response.body).not.toHaveProperty("paymentInstructions");
      expect(findForbiddenKeys(response.body)).toEqual([]);
      expect(response.headers["cache-control"]).toBeUndefined();
    }
  });

  it("are in no later read of the tournament, its registrations, its club or its screens, for anyone", async () => {
    const { staff, tournament } = await transferGame();
    await qrSignUp(tournament.id, "Tama Rangi");
    const reads = [
      `/api/tournaments/${tournament.id}`,
      `/api/tournaments/${tournament.id}/registrations`,
      `/api/tournaments/${tournament.id}/activity`,
      `/api/tournaments?clubId=${staff.club.id}`,
      `/api/clubs/${staff.club.id}`,
      `/api/public/tournaments/${tournament.id}/display`,
      `/api/public/tournaments/${tournament.id}/seating`,
      `/api/public/tournaments/${tournament.id}/prizes`,
    ];

    for (const agent of [await anon(), staff.stranger.agent, staff.owner.agent]) {
      for (const url of reads) {
        const response = await agent.get(url);
        expect(response.status, url).toBe(200);
        expect(findForbiddenKeys(response.body), url).toEqual([]);
        const text = JSON.stringify(response.body);
        for (const value of [BANK_DETAILS.accountNumber, BANK_DETAILS.accountName, BANK_DETAILS.instructions]) expect(text, url).not.toContain(value);
      }
    }
  });

  it("are the only bank keys a sign-up's answer has", async () => {
    const { tournament } = await transferGame();

    const { body } = await qrSignUp(tournament.id, "Tama Rangi");

    const found = findForbiddenKeys(body);
    expect(found.every((path) => path === "paymentInstructions" || path.startsWith("paymentInstructions."))).toBe(true);
    expect(found).toEqual(expect.arrayContaining(["paymentInstructions", "paymentInstructions.accountName", "paymentInstructions.accountNumber"]));
    expect(BANK_DETAIL_KEYS).toEqual(expect.arrayContaining(["bankAccountNumber", "accountNumber", "paymentInstructions"]));
  });
});

describe("how an entry paid (paidBy)", () => {
  /** Bob, signed up at the QR page and not paid yet. */
  async function unpaid() {
    const world = await transferGame();
    const { body } = await qrSignUp(world.tournament.id, "Bob Transfer");
    return { ...world, bob: body };
  }

  const activityOf = async (tournamentId: string) =>
    (await testDb().select().from(activityLog).where(eq(activityLog.tournamentId, tournamentId))).map((entry) => entry.description);

  it("is recorded when the TD confirms a payment as a bank transfer, and shown on the desk's lists and the staff's registrations", async () => {
    const { tournament, td, bob } = await unpaid();

    const pendingBefore = await td.get(`/api/tournaments/${tournament.id}/pending-registrations`);
    expect(pendingBefore.body).toEqual([expect.objectContaining({ id: bob.id, paidBy: null, amountOwed: 50 })]);

    const confirmed = await td.patch(`/api/registrations/${bob.id}/confirm-payment`).send({ paidBy: "transfer" });

    expect(confirmed.status).toBe(200);
    expect(confirmed.body).toMatchObject({ id: bob.id, paymentConfirmed: true, paidBy: "transfer" });
    expect((await registrationRow(bob.id)).paidBy).toBe("transfer");
    expect(await activityOf(tournament.id)).toContain("Payment confirmed for Bob Transfer (bank transfer)");
    const paid = await td.get(`/api/tournaments/${tournament.id}/confirmed-registrations`);
    expect(paid.body).toEqual([expect.objectContaining({ id: bob.id, paidBy: "transfer", amountPaid: 50 })]);
    const staffList = await td.get(`/api/tournaments/${tournament.id}/registrations`);
    expect(staffList.body).toEqual([expect.objectContaining({ id: bob.id, paidBy: "transfer" })]);
    // Staff bookkeeping, like the payment itself: never public.
    const publicList = await (await anon()).get(`/api/tournaments/${tournament.id}/registrations`);
    expect(publicList.body[0]).not.toHaveProperty("paidBy");
  });

  it("is not recorded when the TD does not say, and changes on a second confirm without a second log entry", async () => {
    const { tournament, td, bob } = await unpaid();

    const first = await td.patch(`/api/registrations/${bob.id}/confirm-payment`);
    const corrected = await td.patch(`/api/registrations/${bob.id}/confirm-payment`).send({ paidBy: "cash" });
    const again = await td.patch(`/api/registrations/${bob.id}/confirm-payment`).send({});

    expect(first.body.paidBy).toBeNull();
    expect(corrected.status).toBe(200);
    expect(corrected.body).toMatchObject({ paymentConfirmed: true, paidBy: "cash", seating: null });
    expect(again.body.paidBy).toBe("cash");
    expect((await activityOf(tournament.id)).filter((line) => line.startsWith("Payment confirmed"))).toEqual(["Payment confirmed for Bob Transfer"]);
  });

  it.each([["free"], ["bitcoin"], [null]])("refuses %s as how a payment was made", async (paidBy) => {
    const { td, bob } = await unpaid();

    const response = await td.patch(`/api/registrations/${bob.id}/confirm-payment`).send({ paidBy });

    expect(response.status).toBe(400);
    expect((await registrationRow(bob.id)).paymentConfirmed).toBe(false);
  });

  it("is cleared with a payment taken back", async () => {
    const { td, bob } = await unpaid();
    await td.patch(`/api/registrations/${bob.id}/confirm-payment`).send({ paidBy: "transfer" });

    const response = await td.put(`/api/registrations/${bob.id}`).send({ paymentConfirmed: false });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ paymentConfirmed: false, paidBy: null });
    expect((await registrationRow(bob.id)).paidBy).toBeNull();
  });

  it("is free for a free entry, cleared when it is taken back, and how they paid when it is marked paid", async () => {
    const { td, bob } = await unpaid();

    const given = await td.post(`/api/registrations/${bob.id}/free-entry`).send({ action: "give", reason: "season_prize" });
    const confirmFree = await td.patch(`/api/registrations/${bob.id}/confirm-payment`).send({ paidBy: "cash" });
    const takenBack = await td.post(`/api/registrations/${bob.id}/free-entry`).send({ action: "take_back" });
    await td.post(`/api/registrations/${bob.id}/free-entry`).send({ action: "give", reason: "promo" });
    const markedPaid = await td.post(`/api/registrations/${bob.id}/free-entry`).send({ action: "mark_paid", paidBy: "transfer" });

    expect(given.body).toMatchObject({ freeEntry: true, paidBy: "free" });
    // A free entry keeps "free": marking it paid is how a payment is recorded for it.
    expect(confirmFree.body).toMatchObject({ freeEntry: true, paidBy: "free" });
    expect(takenBack.body).toMatchObject({ freeEntry: false, paymentConfirmed: false, paidBy: null });
    expect(markedPaid.status).toBe(200);
    expect(markedPaid.body).toMatchObject({ freeEntry: false, paymentConfirmed: true, paidBy: "transfer" });
    expect((await registrationRow(bob.id)).paidBy).toBe("transfer");
  });

  it("is said by the desk registering a paid player, only with the payment, and never by a QR sign-up", async () => {
    const { tournament, td } = await transferGame();
    const [cash, unpaidPlayer] = [await createPlayer({ name: "Cash Carl" }), await createPlayer({ name: "Unpaid Una" })];

    const paid = await td.post(`/api/tournaments/${tournament.id}/registrations`).send({ playerId: cash.id, paymentConfirmed: true, paidBy: "cash" });
    const withoutPayment = await td.post(`/api/tournaments/${tournament.id}/registrations`).send({ playerId: unpaidPlayer.id, paidBy: "cash" });
    const qr = await qrSignUp(tournament.id, "Qr Quinn", { paidBy: "transfer", paymentConfirmed: true });

    expect(paid.status).toBe(201);
    expect(paid.body).toMatchObject({ paymentConfirmed: true, paidBy: "cash" });
    expect(withoutPayment.status).toBe(400);
    expect(qr.response.status).toBe(201);
    expect(qr.body).not.toHaveProperty("paidBy");
    expect(await registrationRow(qr.body.id)).toMatchObject({ paymentConfirmed: false, paidBy: null });
  });
});

describe("a club with bank details elsewhere", () => {
  it("never puts them in another club's sign-up", async () => {
    const { tournament } = await transferGame();
    const other = await createClub();
    const plain = await createTournament({ clubId: other.id, status: "registration" });

    const { body } = await qrSignUp(plain.id, "Elsewhere Ed");

    expect(body).not.toHaveProperty("paymentInstructions");
    expect(tournament.showBankTransfer).toBe(true);
  });
});
