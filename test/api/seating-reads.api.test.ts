/**
 * What the seating reads load (R2-CQ-04). The last seating change (SeatingDto.lastChange: "Show last
 * moves" and Undo) is the TD's alone, so only the staff read and the writes look it up in the activity
 * log; the public seat finder, which every phone in the room polls, and the bust hooks never do. Told
 * apart by the SQL each request sends.
 *
 * And each read sees one moment (P4REV1-R3-02): a seating write that commits while a read is part way
 * through its queries shows either not at all or whole, never tables from before it with seats from
 * after it.
 */
import { Client } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicSeatingDto, SeatingDto } from "@shared/api/seating";
import { createTournament } from "../factories";
import { createSeat, createTable, registerPlayers } from "../factories/seating";
import { anon, resetDb } from "../helpers";
import { clubWithStaff } from "../helpers/club-staff";

beforeEach(resetDb);

afterEach(() => {
  vi.restoreAllMocks();
});

/** Every query sent from here on, by its SQL. */
function recordQueries(): () => string[] {
  const query = vi.spyOn(Client.prototype, "query");
  return () => query.mock.calls.map(([sent]: unknown[]) => (typeof sent === "string" ? sent : ((sent as { text?: string }).text ?? "")));
}

const activityReads = (queries: readonly string[]) => queries.filter((text) => /^select\b/i.test(text.trim()) && /from "activity_log"/i.test(text));

describe("the seating reads", () => {
  it("never look up the last seating change for the public seat finder or a bust, only for the TD", async () => {
    const staff = await clubWithStaff();
    const tournament = await createTournament({ clubId: staff.club.id, status: "in_progress" });
    const [alice] = await registerPlayers(tournament.id, ["Alice", "Bob"]);
    const table = await createTable({ tournamentId: tournament.id, tableNumber: 1 });
    await createSeat({ tournamentId: tournament.id, tableId: table.id, registrationId: alice.id, seatNumber: 1 });
    const visitor = await anon();
    const queries = recordQueries();

    const seatFinder = await visitor.get(`/api/public/tournaments/${tournament.id}/seating`);
    const bust = await staff.manager.agent.put(`/api/registrations/${alice.id}`).send({ isEliminated: true });
    const undoneBust = await staff.manager.agent.put(`/api/registrations/${alice.id}`).send({ isEliminated: false });

    expect([seatFinder.status, bust.status, undoneBust.status]).toEqual([200, 200, 200]);
    expect(queries().length).toBeGreaterThan(0);
    expect(activityReads(queries())).toEqual([]);

    const forStaff = await staff.manager.agent.get(`/api/tournaments/${tournament.id}/seating`);
    expect(forStaff.status).toBe(200);
    expect(activityReads(queries())).toHaveLength(1);
  });
});

const sqlOf = (sent: unknown) => (typeof sent === "string" ? sent : ((sent as { text?: string } | null)?.text ?? ""));

/**
 * Holds back the first read of the seats (the last of a read's queries to reach the database) until
 * `meanwhile` has run and committed, as if it landed between that read's queries.
 */
function writeBeforeTheSeatsAreRead(meanwhile: () => Promise<unknown>) {
  const original = Client.prototype.query;
  let held = false;
  vi.spyOn(Client.prototype, "query").mockImplementation(function (this: Client, ...args: unknown[]) {
    const call = () => (original as (...sent: unknown[]) => unknown).apply(this, args);
    const text = sqlOf(args[0]);
    if (held || !/^select\b/i.test(text.trim()) || !/from "tournament_seats"/i.test(text)) return call() as never;
    held = true;
    return meanwhile().then(call) as never;
  });
}

describe("a seating read", () => {
  /** Nine players at two tables (5 and 4): everyone fits at Table 1, so a final table archives Table 2. */
  async function beforeTheFinalTable() {
    const staff = await clubWithStaff();
    const tournament = await createTournament({ clubId: staff.club.id, status: "in_progress" });
    const registrations = await registerPlayers(tournament.id, Array.from({ length: 9 }, (_, i) => `Player ${i + 1}`));
    const tables = [await createTable({ tournamentId: tournament.id, tableNumber: 1 }), await createTable({ tournamentId: tournament.id, tableNumber: 2 })];
    for (let i = 0; i < registrations.length; i++) {
      await createSeat({ tournamentId: tournament.id, tableId: tables[i % 2].id, registrationId: registrations[i].id, seatNumber: Math.floor(i / 2) + 1 });
    }
    const finalTable = () => staff.manager.agent.post(`/api/tournaments/${tournament.id}/seating/final-table`).send({}).expect(200);
    return { staff, tournament, finalTable };
  }

  it("for the public seat finder shows the seating as it was when it began, not tables from before a final table with seats from after it", async () => {
    const { tournament, finalTable } = await beforeTheFinalTable();
    const visitor = await anon();
    const url = `/api/public/tournaments/${tournament.id}/seating`;
    const before = (await visitor.get(url).expect(200)).body as PublicSeatingDto;

    writeBeforeTheSeatsAreRead(finalTable);
    const during = (await visitor.get(url).expect(200)).body as PublicSeatingDto;
    vi.restoreAllMocks();
    const after = (await visitor.get(url).expect(200)).body as PublicSeatingDto;

    expect(before.tables.map((table) => table.tableNumber)).toEqual([1, 2]);
    expect(after.tables.map((table) => table.tableNumber)).toEqual([1]);
    expect(during).toEqual(before);
  });

  it("for the TD shows one moment too, the version and suggestions with it", async () => {
    const { staff, tournament, finalTable } = await beforeTheFinalTable();
    const url = `/api/tournaments/${tournament.id}/seating`;
    const before = (await staff.manager.agent.get(url).expect(200)).body as SeatingDto;

    writeBeforeTheSeatsAreRead(finalTable);
    const during = (await staff.manager.agent.get(url).expect(200)).body as SeatingDto;
    vi.restoreAllMocks();
    const after = (await staff.manager.agent.get(url).expect(200)).body as SeatingDto;

    expect(after.version).not.toBe(before.version);
    expect(during).toEqual(before);
  });
});
