import fc from "fast-check";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { TournamentRegistration } from "../schema";
import { rankFinishers, registrationRemovalProblem, type FinisherInput, type RemovalInput } from "./standings";

const at = (minutes: number) => new Date(Date.UTC(2026, 2, 1, 19, minutes));

const ids = (ranked: ReturnType<typeof rankFinishers>) => (ranked.ok ? ranked.ordered.map((r) => r.id) : ranked);

describe("rankFinishers", () => {
  it("ranks busted players by elimination time, latest first, after the one player still in", () => {
    const ranked = rankFinishers([
      { id: "first-out", isEliminated: true, eliminationTime: at(10) },
      { id: "winner", isEliminated: false },
      { id: "third", isEliminated: true, eliminationTime: at(20) },
      { id: "second", isEliminated: true, eliminationTime: at(30) },
    ]);

    expect(ranked).toMatchObject({ ok: true, source: "eliminations" });
    expect(ids(ranked)).toEqual(["winner", "second", "third", "first-out"]);
  });

  it("reads elimination times given as ISO strings, as the API serves them", () => {
    const ranked = rankFinishers([
      { id: "a", isEliminated: true, eliminationTime: "2026-03-01T19:10:00.000Z" },
      { id: "b", isEliminated: true, eliminationTime: "2026-03-01T19:20:00.000Z" },
    ]);

    expect(ids(ranked)).toEqual(["b", "a"]);
  });

  it("puts a bust with no recorded (or unreadable) time after every timed one, as it always has", () => {
    const ranked = rankFinishers([
      { id: "no-time", isEliminated: true, eliminationTime: null },
      { id: "garbled", isEliminated: true, eliminationTime: "not a date" },
      { id: "timed", isEliminated: true, eliminationTime: at(5) },
      { id: "winner", isEliminated: false },
    ]);

    expect(ids(ranked)).toEqual(["winner", "timed", "garbled", "no-time"]);
  });

  it("breaks elimination-time ties by registration id, so the same data always gives the same order (bug-07)", () => {
    const same = at(15);
    const forwards = rankFinishers([
      { id: "c", isEliminated: true, eliminationTime: same },
      { id: "a", isEliminated: true, eliminationTime: same },
      { id: "b", isEliminated: true, eliminationTime: same },
    ]);

    expect(ids(forwards)).toEqual(["a", "b", "c"]);
  });

  it("counts a null isEliminated as still in", () => {
    const ranked = rankFinishers([
      { id: "out", isEliminated: true, eliminationTime: at(1) },
      { id: "in", isEliminated: null },
    ]);

    expect(ids(ranked)).toEqual(["in", "out"]);
  });

  it("refuses to guess the order when two or more players are still in (bug-07)", () => {
    const ranked = rankFinishers([
      { id: "z", isEliminated: false },
      { id: "out", isEliminated: true, eliminationTime: at(1) },
      { id: "y", isEliminated: false },
    ]);

    expect(ranked).toEqual({ ok: false, problem: "ACTIVE_PLAYERS_NEED_ORDER" });
    expect(rankFinishers([{ id: "a" }, { id: "b" }], [])).toMatchObject({ ok: false, problem: "ACTIVE_PLAYERS_NEED_ORDER" });
  });

  it("uses the given order for the players still in, ahead of everyone who busted", () => {
    const ranked = rankFinishers(
      [
        { id: "a", isEliminated: false },
        { id: "out", isEliminated: true, eliminationTime: at(1) },
        { id: "b", isEliminated: false },
        { id: "c", isEliminated: false },
      ],
      ["c", "a", "b"],
    );

    expect(ranked).toMatchObject({ ok: true, source: "explicit" });
    expect(ids(ranked)).toEqual(["c", "a", "b", "out"]);
  });

  it.each([
    ["a player missing", ["a"]],
    ["a player twice", ["a", "a"]],
    ["someone who busted", ["a", "out"]],
    ["an unknown id", ["a", "b", "zz"]],
  ])("refuses an order with %s", (_case, order) => {
    const ranked = rankFinishers(
      [
        { id: "a", isEliminated: false },
        { id: "b", isEliminated: false },
        { id: "out", isEliminated: true, eliminationTime: at(1) },
      ],
      order,
    );

    expect(ranked).toEqual({ ok: false, problem: "INVALID_FINISH_ORDER" });
  });

  it("accepts the lone player still in as the order, and refuses anyone else", () => {
    const registrations = [{ id: "winner" }, { id: "out", isEliminated: true, eliminationTime: at(1) }];

    expect(ids(rankFinishers(registrations, ["winner"]))).toEqual(["winner", "out"]);
    expect(rankFinishers(registrations, ["out"])).toMatchObject({ ok: false, problem: "INVALID_FINISH_ORDER" });
  });

  it("needs no order when everyone busted, and refuses one", () => {
    const registrations = [
      { id: "a", isEliminated: true, eliminationTime: at(1) },
      { id: "b", isEliminated: true, eliminationTime: at(2) },
    ];

    expect(ids(rankFinishers(registrations))).toEqual(["b", "a"]);
    expect(ids(rankFinishers(registrations, []))).toEqual(["b", "a"]);
    expect(rankFinishers(registrations, ["a"])).toEqual({ ok: false, problem: "INVALID_FINISH_ORDER" });
  });

  it("takes a whole finishing order over every registration, eliminations included, to correct a mis-tapped bust (D19)", () => {
    const registrations = [
      { id: "winner" },
      { id: "really-third", isEliminated: true, eliminationTime: at(30) },
      { id: "really-second", isEliminated: true, eliminationTime: at(10) },
    ];

    const ranked = rankFinishers(registrations, ["winner", "really-second", "really-third"]);

    expect(ranked).toMatchObject({ ok: true, source: "explicit" });
    expect(ids(ranked)).toEqual(["winner", "really-second", "really-third"]);
  });

  it("refuses a whole order that leaves someone out or names someone twice", () => {
    const registrations = [{ id: "a" }, { id: "b", isEliminated: true, eliminationTime: at(1) }, { id: "c", isEliminated: true, eliminationTime: at(2) }];

    expect(rankFinishers(registrations, ["a", "b", "b"])).toMatchObject({ ok: false, problem: "INVALID_FINISH_ORDER" });
    expect(rankFinishers(registrations, ["a", "b"])).toMatchObject({ ok: false, problem: "INVALID_FINISH_ORDER" });
  });

  it("ranks nobody when there are no registrations", () => {
    expect(rankFinishers([])).toEqual({ ok: true, ordered: [], source: "eliminations" });
  });

  it("ranks every registration exactly once, whatever the input order", () => {
    const registration = fc.record({
      isEliminated: fc.boolean(),
      eliminationTime: fc.option(fc.integer({ min: 0, max: 50 }).map(at), { nil: null }),
    });
    fc.assert(
      fc.property(fc.array(registration, { maxLength: 30 }), (rows) => {
        const registrations: FinisherInput[] = rows.map((row, i) => ({ id: `r${String(i).padStart(2, "0")}`, ...row }));
        const active = registrations.filter((r) => !r.isEliminated).map((r) => r.id);
        const ranked = rankFinishers([...registrations].reverse(), [...active].reverse());
        if (!ranked.ok) throw new Error("a full order of the active players must be accepted");

        expect([...ranked.ordered.map((r) => r.id)].sort()).toEqual(registrations.map((r) => r.id).sort());
        expect(ranked.ordered.slice(0, active.length).map((r) => r.id)).toEqual([...active].reverse());
        expect(ranked).toEqual(rankFinishers(registrations, [...active].reverse()));
      }),
    );
  });

  it("accepts database rows as they are", () => {
    expectTypeOf<TournamentRegistration>().toExtend<FinisherInput>();
  });
});

describe("registrationRemovalProblem (CQ-P2-03)", () => {
  const entry = (id: string, extra: Partial<RemovalInput> = {}): RemovalInput => ({ id, playerId: `p-${id}`, ...extra });

  it("lets an entry nothing has happened to be removed", () => {
    const fresh = entry("a", { rebuys: 0, addons: 0, knockouts: 0, isEliminated: false, highHandWinner: false, finalPosition: null });

    expect(registrationRemovalProblem(fresh, [fresh, entry("b")])).toBeNull();
  });

  it("names everything already recorded", () => {
    const busy = entry("a", { isEliminated: true, rebuys: 2, addons: 1, knockouts: 1, highHandWinner: true, finalPosition: 3 });

    expect(registrationRemovalProblem(busy, [busy])).toBe(
      "an elimination, re-buys, add-ons, knockouts, a high-hand win, a finishing position",
    );
  });

  it("keeps a player another entry names as its eliminator, even with their own knockout count reset", () => {
    const eliminator = entry("a", { knockouts: 0 });
    const victim = entry("b", { isEliminated: true, eliminatedBy: eliminator.playerId });

    expect(registrationRemovalProblem(eliminator, [eliminator, victim])).toBe("knockouts");
  });
});
