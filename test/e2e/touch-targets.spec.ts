/**
 * Touch targets on the TD's phone (390 × 844, where hosts run their games): every button, link, box,
 * tab and menu item on each tab of the tournament page and in each sheet it opens is at least 44 × 44
 * CSS px as the browser draws it (round5-contracts: "touch targets ≥ 44 px"). Measured, not read from
 * class names, so a control no class check covers (a 40 px stepper, a small chip) fails here
 * (R5REV3-CQ-14). With SCREENSHOTS_DIR set, each screen measured is also saved there as
 * `touch-<screen>.png`.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { devices, type APIRequestContext, type BrowserContextOptions, type Page } from "@playwright/test";
import type { StaffPlayer } from "../../shared/api/players";
import { presetStructure } from "../../shared/domain/blind-structures";
import { createClub, createTournament, expectJson, registerPlayer, signUp, uniquePhone, uniqueToken } from "./support/api";
import { expect, test } from "./support/fixtures";

const { defaultBrowserType: _browser, ...pixel7 } = devices["Pixel 7"];
const PHONE: BrowserContextOptions = { ...pixel7, viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 } };
test.use(PHONE);

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SCREENS = process.env.SCREENSHOTS_DIR ? path.resolve(REPO_ROOT, process.env.SCREENSHOTS_DIR) : null;

/** The smallest a thumb's target may be, each way (CSS px). */
const MIN_TARGET = 44;

/**
 * Every control a thumb can reach that is drawn smaller than MIN_TARGET either way, as "button
 * "Name" 40×40". What is hidden from everyone is left out (behind an open sheet, aria-hidden, inert, or
 * visually hidden for screen readers); a switch, check box or radio counts its label's box, which the
 * whole of takes the tap.
 */
async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate((min) => {
    const selector = [
      "button",
      "a[href]",
      "input:not([type=hidden])",
      "select",
      "textarea",
      "[role=tab]",
      "[role=menuitem]",
      "[role=switch]",
      "[role=checkbox]",
      "[role=radio]",
      "[role=option]",
    ].join(",");
    const labelled = (element: Element) => ["switch", "checkbox", "radio"].includes(element.getAttribute("role") ?? "") || (element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type));
    const nameOf = (element: Element) =>
      (element.getAttribute("aria-label") ?? element.getAttribute("data-testid") ?? element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 50);
    const small: string[] = [];
    for (const element of Array.from(document.querySelectorAll(selector))) {
      if (!(element instanceof HTMLElement)) continue;
      if (element.closest("[aria-hidden=true], [inert]")) continue;
      if (!element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      const own = element.getBoundingClientRect();
      // Visually hidden for screen readers (sr-only), or a native box drawn by a custom control over it.
      if (own.width <= 2 || own.height <= 2) continue;
      let { width, height } = own;
      // A hit area drawn round the control (a switch's ::after, a card's stretched link) takes the tap too.
      const after = getComputedStyle(element, "::after");
      if (after.position === "absolute" && after.content !== "none" && after.content !== "normal") {
        width = Math.max(width, Number.parseFloat(after.width) || 0);
        height = Math.max(height, Number.parseFloat(after.height) || 0);
      }
      if (labelled(element)) {
        const label = element.closest("label") ?? (element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`) : null);
        if (label) {
          const box = label.getBoundingClientRect();
          width = Math.max(width, box.width);
          height = Math.max(height, box.height);
        }
      }
      if (width + 0.5 < min || height + 0.5 < min) small.push(`${element.getAttribute("role") ?? element.tagName.toLowerCase()} "${nameOf(element)}" ${Math.round(width)}×${Math.round(height)}`);
    }
    return small;
  }, MIN_TARGET);
}

/** Waits for what animates in (Radix sheets and menus) to settle, so what is measured is its final size. */
async function settled(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
}

/** The page, and each dialog or sheet open on it, that is wider than what it shows: it would scroll sideways. */
async function sidewaysScrolls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const wide: string[] = [];
    if (document.documentElement.scrollWidth > window.innerWidth) wide.push(`page ${document.documentElement.scrollWidth}px`);
    for (const dialog of Array.from(document.querySelectorAll<HTMLElement>("[role=dialog], [role=alertdialog]"))) {
      if (dialog.scrollWidth > dialog.clientWidth + 1 || dialog.getBoundingClientRect().right > window.innerWidth + 1) {
        // The innermost part wider than the dialog shows, to say what to fix.
        const room = dialog.clientWidth;
        const tooWide = (part: Element) => part.getBoundingClientRect().width > room + 1;
        const out = Array.from(dialog.querySelectorAll<HTMLElement>("*")).filter((part) => tooWide(part) && !Array.from(part.children).some(tooWide));
        const what = out.slice(0, 3).map((part) => `${part.tagName.toLowerCase()}${part.dataset.testid ? `[${part.dataset.testid}]` : ""} "${(part.textContent ?? "").trim().slice(0, 30)}"`);
        wide.push(`${dialog.querySelector("h2")?.textContent ?? "dialog"} ${dialog.scrollWidth}px in ${dialog.clientWidth}px: ${what.join(", ")}`);
      }
    }
    return wide;
  });
}

async function expectThumbSized(page: Page, where: string): Promise<void> {
  await settled(page);
  if (SCREENS) await page.screenshot({ path: path.join(SCREENS, `touch-${where.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.png`) });
  expect.soft(await smallTargets(page), `controls under ${MIN_TARGET} × ${MIN_TARGET} px: ${where}`).toEqual([]);
  expect.soft(await sidewaysScrolls(page), `scrolls sideways: ${where}`).toEqual([]);
}

const post = async <T>(request: APIRequestContext, url: string, data: object, status = 200) => expectJson<T>(await request.post(url, { data }), status);
const put = async <T>(request: APIRequestContext, url: string, data: object) => expectJson<T>(await request.put(url, { data }), 200);

test("every control on the TD's phone page and its sheets is at least 44 × 44 px", async ({ page, openBrowser }) => {
  test.slow();
  const token = uniqueToken();
  await signUp(page.request, "Tess Director");
  const club = await createClub(page.request, `Central Stars ${token}`);
  await put(page.request, `/api/clubs/${club.id}`, { defaultSeatsPerTable: 9, defaultTableShape: "rectangle", rakeLabel: "AP" });
  const tournament = await createTournament(page.request, {
    clubId: club.id,
    name: `Touch Night ${token}`,
    buyInAmount: "50.00",
    rebuyAmount: "25.00",
    addonAmount: "20.00",
    maxRebuys: 2,
    maxAddons: 1,
    maxPlayers: 27,
  });
  const players: StaffPlayer[] = [];
  for (const name of ["Aroha Ngata", "Ben Smith", "Chloe Wu", "Dev Patel", "Ella Jones", "Finn Lee"]) {
    players.push(await post<StaffPlayer>(page.request, "/api/players", { name: `${name} ${token}`, phone: uniquePhone(), clubId: club.id }, 201));
  }
  // The last has not paid yet: the "Take payment" sheet lists them.
  for (let index = 0; index < players.length; index++) await registerPlayer(page.request, tournament.id, players[index]!.id, { paymentConfirmed: index < players.length - 1 });
  await put(page.request, `/api/tournaments/${tournament.id}`, { status: "in_progress" });

  await test.step("the Seats tab before the tables are put out, and the setup and settings sheets", async () => {
    await page.goto(`/admin/tournaments/${tournament.id}?tab=seating`);
    await expect(page.getByTestId("open-seating-setup")).toBeVisible();
    await expectThumbSized(page, "Seats tab, no tables");
    await page.getByTestId("open-seating-settings").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectThumbSized(page, "seating settings sheet");
    await page.keyboard.press("Escape");
    await page.getByTestId("open-seating-setup").click();
    await expect(page.getByRole("dialog", { name: "Set up tables & draw seats" })).toBeVisible();
    await expectThumbSized(page, "seating setup sheet");
    await page.getByTestId("setup-seating-submit").click();
    const moves = page.getByRole("dialog").filter({ has: page.getByTestId("seat-moves") });
    await moves.getByRole("button", { name: "Done" }).click();
    await expect(moves).toBeHidden();
  });

  // A late arrival left waiting for a seat (seating them automatically is off): the Seats tab lists them above the tables.
  await put(page.request, `/api/tournaments/${tournament.id}`, { autoSeat: "off" });
  const late = await post<StaffPlayer>(page.request, "/api/players", { name: `Gus Late ${token}`, phone: uniquePhone(), clubId: club.id }, 201);
  await registerPlayer(page.request, tournament.id, late.id, { paymentConfirmed: true });

  await expectJson(
    await page.request.put(`/api/tournaments/${tournament.id}/clock`, {
      data: { structure: presetStructure("central_stars_one_life_line"), presetKey: "central_stars_one_life_line", baseHash: null },
    }),
    201,
  );
  // A player's own request, waiting for the TD.
  const playersPhone = await (await openBrowser(PHONE)).newPage();
  await playersPhone.goto(`/tournaments/${tournament.id}/actions`);
  await playersPhone.getByRole("button", { name: /^Re-buy/ }).click();
  await playersPhone.getByRole("list", { name: "Who is the re-buy for?" }).getByRole("button", { name: new RegExp(`^Ben Smith`) }).click();
  await playersPhone.getByRole("button", { name: "Submit Re-buy" }).click();
  await expect(playersPhone.getByText("Action Submitted!")).toBeVisible();

  await test.step("each tab of the page", async () => {
    await page.goto(`/admin/tournaments/${tournament.id}`);
    await expect(page.getByTestId("mobile-clock")).toBeVisible();
    for (const [tab, ready] of [
      ["players", "field-summary"],
      ["seating", "unseated-list"],
      ["clock", "clock-phone-controls"],
      ["money", "prize-pool"],
      ["more", "end-tournament"],
    ] as const) {
      await page.goto(`/admin/tournaments/${tournament.id}${tab === "players" ? "" : `?tab=${tab}`}`);
      await expect(page.getByTestId(ready).first()).toBeVisible();
      await expectThumbSized(page, `${tab} tab`);
    }
  });

  await test.step("the quick actions and each sheet they open", async () => {
    await page.goto(`/admin/tournaments/${tournament.id}`);
    const open = async (item: string) => {
      await page.getByTestId("quick-actions").click();
      await page.getByRole("menuitem", { name: new RegExp(`^${item}`) }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
    };
    await page.getByTestId("quick-actions").click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expectThumbSized(page, "quick actions menu");
    await menu.press("Escape");
    await expect(menu).toBeHidden();

    await open("Bust a player");
    await expectThumbSized(page, "bust sheet: who is out");
    await page.getByTestId(/^bust-pick-/).first().click();
    await expect(page.getByRole("dialog", { name: "Knocked out by" })).toBeVisible();
    await expectThumbSized(page, "bust sheet: knocked out by");
    await page.keyboard.press("Escape");

    for (const item of ["Re-buy", "Add-on", "Take payment", "Approve requests", "Register player"]) {
      await open(item);
      await expectThumbSized(page, `${item} sheet`);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toBeHidden();
    }
  });

  await test.step("the clock's sheets", async () => {
    await page.goto(`/admin/tournaments/${tournament.id}?tab=clock`);
    await page.getByTestId("clock-phone-controls").getByRole("button", { name: "Start" }).click();
    for (const [tool, sheet] of [
      [/Change the rest of the structure/, "Change the rest of the structure"],
      [/Edit the blind structure/, "Blind structure"],
      [/TV display/, "TV display"],
      [/Early birds/, "Early birds"],
    ] as const) {
      await page.getByRole("button", { name: tool }).first().click();
      await expect(page.getByRole("dialog", { name: sheet })).toBeVisible();
      await expectThumbSized(page, `${sheet} sheet`);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toBeHidden();
    }
  });

  await test.step("the money sheets and End Tournament", async () => {
    await page.goto(`/admin/tournaments/${tournament.id}?tab=money`);
    await page.getByTestId("edit-payouts").first().click();
    const editor = page.getByRole("dialog", { name: "Edit payouts" });
    await editor.getByTestId("customise-payouts").click();
    await expectThumbSized(page, "payout editor");
    await page.keyboard.press("Escape");

    await page.goto(`/admin/tournaments/${tournament.id}?tab=more`);
    await page.getByTestId("end-tournament").click();
    const end = page.getByRole("dialog", { name: "End Tournament" });
    await end.getByTestId("make-deal").click();
    await expect(end.getByTestId("deal-editor")).toBeVisible();
    await expectThumbSized(page, "End Tournament with a deal");
  });
});
