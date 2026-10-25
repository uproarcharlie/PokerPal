import { describe, expect, it } from "vitest";
import { centreHeight, LINE, planScreen, textEm, type CentreText, type PlanInput, type ScreenPlan, type TileText } from "./screen-plan";

/** The owner's list (round 5, items 17, 22, 23): TVs, a laptop, tablets both ways, a phone both ways. */
const SCREENS = [
  { name: "TV 1920×1080", width: 1920, height: 1080, tv: true },
  { name: "TV 1280×720 (cast)", width: 1280, height: 720, tv: true },
  { name: "laptop 1366×768", width: 1366, height: 768, tv: true },
  { name: "tablet 1024×768", width: 1024, height: 768, tv: false },
  { name: "tablet 768×1024", width: 768, height: 1024, tv: false },
  { name: "phone 390×844", width: 390, height: 844, tv: false },
  { name: "phone 844×390", width: 844, height: 390, tv: false },
] as const;

/** Inside a 2.5% edge margin, as the TV draws by default. */
const inside = (size: number) => Math.floor(size * 0.95);

const TILES: TileText[] = [
  { label: "Players", value: "188 / 200", lead: true },
  { label: "Average stack", value: "1,234,567", detail: "61.7 BB", lead: true },
  { label: "Re-buys & add-ons close in", value: "1:16:30", lead: true },
  { label: "Entries", value: "212", detail: "incl. 12 re-buys" },
  { label: "Add-ons", value: "40" },
  { label: "Early birds", value: "120" },
  { label: "Chips in play", value: "232,000,000" },
  { label: "Tables", value: "23" },
];

/** The worst the owner asked for: long names, a 4-digit level, 1,000,000/2,000,000 with an ante, 3 places paid, the QR code on. */
function worstCase(width: number, height: number, overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    width: inside(width),
    height: inside(height),
    logo: true,
    name: "Central Stars Thursday Night Deepstack Championship Freezeout Special Edition",
    clubName: "Central Stars Poker Club of Onehunga and Greater Auckland",
    face: {
      title: "LEVEL 1024",
      note: null,
      status: null,
      timer: "00:00",
      blinds: "1,000,000/2,000,000",
      ante: "BB ante 2,000,000",
      breakLine: "BREAK IN 1:52:31",
      next: "Next: 1,500,000/3,000,000 · BB ante 3,000,000",
    },
    tiles: TILES,
    money: {
      pool: { label: "Prize pool est.", amount: "$123,456" },
      payouts: [
        { place: "1st", amount: "$61,728" },
        { place: "2nd", amount: "$37,037" },
        { place: "3rd", amount: "$24,691" },
      ],
      lines: [
        { label: "Carried over from Central Stars Thursday Night Deepstack Championship", amount: "$1,234" },
        { label: "Carried over to Winter 2026 Central Stars League", amount: "$987" },
      ],
      ap: { label: "AP", amount: "$12,345" },
      note: null,
    },
    qrCaption: "Scan for the Winter 2026 Central Stars League leaderboard",
    ...overrides,
  };
}

/** Every planned column fits the screen's height, and the columns its width. */
function expectFits(plan: ScreenPlan) {
  const body = plan.height - plan.used.header;
  expect(plan.used.face).toBeLessThanOrEqual(body + 0.5);
  if (plan.layout === "landscape") {
    expect(plan.used.left).toBeLessThanOrEqual(body + 0.5);
    expect(plan.used.right).toBeLessThanOrEqual(body + 0.5);
    expect(2 * plan.side + 2 * plan.gap + plan.face.width).toBeLessThanOrEqual(plan.width + 0.5);
  } else {
    expect(plan.used.face + plan.gap + plan.used.below).toBeLessThanOrEqual(body + 0.5);
  }
  // Every line of the face fits its column's width.
  const face = plan.face;
  expect(textEm("1,000,000/2,000,000") * face.blinds).toBeLessThanOrEqual(face.width);
  expect(textEm("00:00") * face.timer).toBeLessThanOrEqual(face.width);
}

describe("the TV clock's screen plan: one screen, never scrolling (round 5, item 17)", () => {
  it.each(SCREENS)("fits the worst case on $name", ({ width, height }) => {
    expectFits(planScreen(worstCase(width, height)));
  });

  it.each(SCREENS)("fits a paused break with its note, and a final level, on $name", ({ width, height }) => {
    const paused = worstCase(width, height, {
      face: {
        title: "BREAK",
        note: "Last re-buys / add-ons, then colour up the 25s",
        status: { text: "PAUSED", size: "big" },
        timer: "00:00",
        blinds: null,
        ante: null,
        breakLine: "BREAK — BACK IN 14:59",
        next: "Next: 1,500,000/3,000,000 · BB ante 3,000,000",
      },
    });
    expectFits(planScreen(paused));
    const final = worstCase(width, height, { face: { ...worstCase(width, height).face, status: { text: "FINAL LEVEL", size: "small" }, breakLine: "NO MORE BREAKS" } });
    expectFits(planScreen(final));
  });

  it("keeps the clock, the level, the blinds and what comes next at any size, and gives way in order of priority", () => {
    const phone = planScreen(worstCase(844, 390));
    expect(phone.face.timer).toBeGreaterThan(0);
    expect(phone.face.blinds).toBeGreaterThan(0);
    expect(phone.face.next).toBeGreaterThan(0);
    // The time to the break comes before every figure.
    expect(phone.face.breakLine).toBeGreaterThan(0);
    // Players first, then the average stack, then the rest.
    const tiny = planScreen(worstCase(640, 360));
    expect(tiny.tiles.shown).toBeLessThan(TILES.length);
    const upright = planScreen(worstCase(390, 844));
    expect(upright.layout).toBe("portrait");
    expect(upright.tiles.shown).toBeGreaterThanOrEqual(2);
    // The pool comes before the QR code, the QR code before the places and the AP.
    expect(upright.money?.pool).toBe(true);
  });

  it.each(SCREENS)("lists the pool's breakdown after the places and before the AP on $name (round 5, item 16)", ({ width, height }) => {
    const plan = planScreen(worstCase(width, height));
    if (!plan.money) return;
    if (plan.money.lines > 0) expect(plan.money.payouts).toBe(3);
    if (plan.money.ap) expect(plan.money.lines).toBe(2);
  });

  it("shows the whole breakdown with the pool on a TV, in type the room can read", () => {
    const plan = planScreen(worstCase(1920, 1080));
    expect(plan.money).toMatchObject({ pool: true, payouts: 3, lines: 2 });
    expect(plan.money?.small).toBeGreaterThanOrEqual(0.03 * plan.height - 0.01);
  });

  it("drops the QR code and the places before the pool, and the figures before the players, when there is no room", () => {
    const short = planScreen(worstCase(1280, 300));
    expect(short.tiles.shown).toBeGreaterThanOrEqual(1);
    if (short.money) expect(short.money.pool || !short.qr).toBe(true);
    expectFits(short);
  });
});

describe("the TV clock across a room on a 40-inch TV (round 5, item 23)", () => {
  it.each(SCREENS.filter((screen) => screen.tv))("makes the countdown about a third of the height, no word under 3%, the QR code 18% or more on $name", ({ width, height }) => {
    const plan = planScreen(worstCase(width, height, { face: { ...worstCase(width, height).face, blinds: "600/1,200", ante: "BB ante 1,200", title: "LEVEL 4" } }));
    const H = plan.height;
    expect(plan.face.timer).toBeGreaterThanOrEqual(0.3 * H);
    expect(plan.face.timer).toBeLessThanOrEqual(0.4 * H);
    for (const size of [plan.face.title, plan.face.blinds, plan.face.ante, plan.face.breakLine, plan.face.next, plan.header.name, plan.tiles.label]) {
      expect(size).toBeGreaterThanOrEqual(0.03 * H - 0.01);
    }
    expect(plan.qr?.size ?? 0).toBeGreaterThanOrEqual(0.18 * H);
    expect(plan.money?.row ?? 0.03 * H).toBeGreaterThanOrEqual(0.03 * H - 0.01);
    // The club's logo centred at the top in play: 14–16% of the height (round 5, item 24).
    expect(plan.header.logo / H).toBeGreaterThanOrEqual(0.14);
    expect(plan.header.logo / H).toBeLessThanOrEqual(0.16);
  });

  it.each(SCREENS.filter((screen) => screen.tv))("makes the blinds the headline under the countdown when the level's number is left out on $name (round 5, item 21)", ({ width, height }) => {
    const titled = planScreen(worstCase(width, height, { face: { ...worstCase(width, height).face, title: "LEVEL 4" } }));
    const untitled = planScreen(worstCase(width, height, { face: { ...worstCase(width, height).face, title: "" } }));
    expect(untitled.face.title).toBe(0);
    expect(untitled.used.face).toBeLessThan(titled.used.face);
    expect(untitled.face.timer).toBeGreaterThanOrEqual(titled.face.timer);
    expect(untitled.face.timer).toBeGreaterThanOrEqual(0.3 * untitled.height);
    expectFits(untitled);
  });

  it("shrinks long names to fit beside the corners, then cuts them short, never wrapping", () => {
    const plan = planScreen(worstCase(1920, 1080));
    expect(plan.header.name).toBeGreaterThanOrEqual(0.03 * plan.height - 0.01);
    expect(plan.header.name * LINE.title).toBeLessThan(0.06 * plan.height);
  });

  it("shrinks a step more each time the guard finds something spilling", () => {
    const plan = planScreen(worstCase(1920, 1080));
    const squeezed = planScreen(worstCase(1920, 1080, { squeeze: 2 }));
    expect(squeezed.header.logo).toBeLessThan(plan.header.logo);
    expect(squeezed.used.header + squeezed.used.face).toBeLessThan(plan.used.header + plan.used.face);
    expect(squeezed.height).toBeCloseTo(plan.height * 0.88, 0);
  });

  it("leaves no logo row when the club has no logo, but keeps the corners clear on an upright screen", () => {
    expect(planScreen(worstCase(1920, 1080, { logo: false })).header.top).toBe(0);
    expect(planScreen(worstCase(390, 844, { logo: false })).header.top).toBeGreaterThanOrEqual(44);
  });
});

describe("the club's logo as the centrepiece: before the start, on a break, once the game is over (round 5, item 24)", () => {
  const centre = (overrides: Partial<CentreText> = {}): CentreText => ({ headline: "Starting soon", status: null, timer: null, note: null, lines: [{ text: "First blinds: 1,000,000/2,000,000 · BB ante 2,000,000" }], action: false, ...overrides });
  const onBreak = centre({ headline: "Break — back in", status: "Paused", timer: "00:00", note: "Last re-buys / add-ons, then colour up the 25s", lines: [{ text: "Next: 1,500,000/3,000,000 · BB ante 3,000,000" }] });
  const messages = [
    centre({ headline: "Clock not set up yet", lines: [{ text: "The blinds appear here as soon as the tournament director sets the clock up.", wrap: true }] }),
    centre({ headline: "Tournament complete", lines: [], action: true }),
    centre({ headline: "This tournament was cancelled", lines: [] }),
  ];

  /** The centrepiece fits its column, and every centre line fits its width. */
  function expectCentreFits(plan: ScreenPlan) {
    const body = plan.height - plan.used.header;
    expect(plan.centre).not.toBeNull();
    expect(plan.used.face).toBeCloseTo(centreHeight(plan.centre!), 5);
    expect(plan.used.face).toBeLessThanOrEqual(body + 0.5);
    expect(plan.centre!.logoWidth).toBeLessThanOrEqual(plan.centre!.width + 0.5);
    expectFits(plan);
  }

  it.each(SCREENS)("fits before the start, a paused break with a long note, and every message on $name", ({ width, height }) => {
    expectCentreFits(planScreen(worstCase(width, height, { centre: centre() })));
    expectCentreFits(planScreen(worstCase(width, height, { centre: onBreak })));
    for (const message of messages) expectCentreFits(planScreen(worstCase(width, height, { centre: message, tiles: [], money: null })));
  });

  it.each(SCREENS.filter((screen) => screen.tv))("draws the logo at about 30% of the height in the middle, and none in the header, on $name", ({ width, height }) => {
    for (const words of [centre(), onBreak, ...messages]) {
      const plan = planScreen(worstCase(width, height, { centre: words, ...(words.timer || words.lines.length > 0 && !words.lines[0]!.wrap ? {} : { tiles: [], money: null }) }));
      expect(plan.header.logo).toBe(0);
      expect(plan.centre!.logo / plan.height).toBeGreaterThanOrEqual(0.27);
      expect(plan.centre!.logo / plan.height).toBeLessThanOrEqual(0.31);
    }
    // The break's countdown stays large under it: 14% of the height or more, and no word under 3%.
    const brk = planScreen(worstCase(width, height, { centre: onBreak }));
    expect(brk.centre!.timer).toBeGreaterThanOrEqual(0.14 * brk.height);
    for (const size of [brk.centre!.headline, brk.centre!.note, ...brk.centre!.lines.map((line) => line.size)]) expect(size).toBeGreaterThanOrEqual(0.03 * brk.height - 0.01);
  });

  it("gives the logo way first, then the countdown, when the words need more room", () => {
    const wordy = { ...onBreak, lines: [...onBreak.lines, ...["Last re-buys at the desk", "Colour up the 25s", "Food at the bar"].map((text) => ({ text }))] };
    const plan = planScreen(worstCase(1280, 720, { centre: wordy }));
    expectCentreFits(plan);
    expect(plan.centre!.logo).toBeLessThan(0.3 * plan.height);
    expect(plan.centre!.logo).toBeGreaterThanOrEqual(0.15 * plan.height - 0.01);
    expect(plan.centre!.timer).toBeGreaterThanOrEqual(0.14 * plan.height - 0.01);
  });

  it("leaves the logo out of the centrepiece for a club without one", () => {
    const plan = planScreen(worstCase(1920, 1080, { centre: centre(), logo: false }));
    expect(plan.centre!.logo).toBe(0);
    expect(plan.header.logo).toBe(0);
    expectCentreFits(plan);
  });

  it("wraps a message onto up to three rows, keeps the results button a thumb's height, and still fits a phone", () => {
    const phone = planScreen(worstCase(390, 844, { centre: messages[0], tiles: [], money: null }));
    expect(phone.centre!.lines[0]!.rows).toBeGreaterThan(1);
    expect(phone.centre!.lines[0]!.rows).toBeLessThanOrEqual(3);
    expectCentreFits(phone);
    const done = planScreen(worstCase(844, 390, { centre: messages[1], tiles: [], money: null }));
    expect(done.centre!.action).toBeGreaterThanOrEqual(44);
    expectCentreFits(done);
  });
});
