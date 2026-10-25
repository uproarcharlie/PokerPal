/**
 * The club's AP (its rake) on a night with a low turnout: the TD fixes the AP total by hand from the AP
 * panel, the payouts on the TD's page and the players' public pool change at once, and finalize pays
 * exactly that pool.
 *
 * Four players at $100 with 10% AP on buy-ins: $400 taken in, $40 AP, $360 to pay (50/30/20: $180, $108,
 * $72). With the AP fixed at $10 for the low turnout: $390 ($195, $117, $78).
 */
import { devices } from "@playwright/test";
import type { PublicRegistration } from "../../shared/api/public";
import { toCents } from "../../shared/domain/money";
import { createClub, createPlayer, createTournament, expectJson, registerPlayer, registrationsOf, signUp, uniqueToken } from "./support/api";
import { expect, test } from "./support/fixtures";
import { toast } from "./support/ui";

const { defaultBrowserType: _browser, ...pixel7 } = devices["Pixel 7"];

test("a TD fixes the AP total for a low turnout: the payouts and the public pool change, and finalize pays it", async ({ page, openBrowser }) => {
  const token = uniqueToken();
  const players = ["Ava", "Ben", "Cal", "Dee"].map((name) => `${name} ${token}`);
  const [, , cal, dee] = players;

  await signUp(page.request, "Tess Director");
  const club = await createClub(page.request, `AP Club ${token}`);
  await expectJson(await page.request.put(`/api/clubs/${club.id}`, { data: { rakeLabel: "AP" } }), 200);
  const tournament = await createTournament(page.request, {
    clubId: club.id,
    name: `Quiet Tuesday ${token}`,
    buyInAmount: "100.00",
    rakeType: "percentage",
    rakeAmount: "10",
    payoutStructure: "standard",
  });
  const registrationOf: Record<string, string> = {};
  for (const name of players) {
    const player = await createPlayer(page.request, name);
    registrationOf[name] = (await registerPlayer(page.request, tournament.id, player.id, { paymentConfirmed: true })).id;
  }
  await expectJson(await page.request.put(`/api/tournaments/${tournament.id}`, { data: { status: "in_progress", prizePoolLocked: true } }), 200);

  const phone = await (await openBrowser(pixel7)).newPage();
  const panel = page.getByTestId("ap-panel");

  await test.step("the AP panel and both pages show the calculated AP and pool", async () => {
    await page.goto(`/admin/tournaments/${tournament.id}`);
    await expect(panel.getByRole("heading", { name: "AP", level: 2 })).toBeVisible();
    // The prize pool card holds what came in and the pool; the AP panel beside it, the AP (P4REV4-CQ-02).
    await expect(page.getByTestId("gross-total")).toHaveText("$400");
    await expect(panel.getByTestId("ap-calculated")).toHaveText("$40");
    await expect(panel.getByTestId("ap-take")).toHaveText("$40");
    await expect(page.getByTestId("net-prize-pool")).toHaveText("$360");
    await expect(page.getByTestId("prize-pool")).toHaveText("$360");
    await expect(page.getByTestId("payout-1")).toHaveText("$180");

    await phone.goto(`/tournament/${tournament.id}`);
    await expect(phone.getByText("Total prize pool: $360")).toBeVisible();
  });

  await test.step("the TD fixes the AP at $10 for the low turnout, with the reason", async () => {
    await panel.getByTestId("adjust-ap").click();
    const dialog = page.getByRole("dialog", { name: "Adjust AP" });
    await dialog.getByLabel("Set AP total").check();
    await dialog.getByTestId("adjust-amount").fill("10");
    await dialog.getByRole("group", { name: "Common reasons" }).getByRole("button", { name: "Low turnout" }).click();
    await expect(dialog.getByText("Prize pool is locked — published payouts will change.")).toBeVisible();
    await dialog.getByTestId("save-adjustment").click();

    await expect(toast(page, "AP fixed at $10")).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(panel.getByTestId("ap-override")).toHaveText("$10");
    await expect(panel).toContainText("Fixed at $10 (calculated $40)");
    await expect(panel.getByTestId("ap-take")).toHaveText("$10");
    await expect(page.getByTestId("net-prize-pool")).toHaveText("$390");
    await expect(panel.getByTestId("ap-adjustment")).toContainText("Low turnout");
  });

  await test.step("the TD's payouts and the players' public pool change at once", async () => {
    await expect(page.getByTestId("prize-pool")).toHaveText("$390(manual AP)");
    await expect(page.getByTestId("payout-1")).toHaveText("$195");
    await expect(page.getByTestId("payout-2")).toHaveText("$117");
    await expect(page.getByTestId("payout-3")).toHaveText("$78");

    await phone.reload();
    await expect(phone.getByText("Total prize pool: $390")).toBeVisible();
    await phone.getByRole("tab", { name: "Activity" }).click();
    await expect(phone.getByText(/Low turnout/).first()).toBeVisible();
  });

  await test.step("finalize pays the pool with the fixed AP", async () => {
    await page.getByRole("tab", { name: "Standings" }).click();
    for (const out of [dee, cal]) {
      await page.getByTestId(`eliminate-player-${registrationOf[out!]}`).click();
      const dialog = page.getByRole("dialog", { name: "Eliminate Player" });
      await dialog.getByRole("button", { name: "Eliminate Player" }).click();
      await expect(dialog).toBeHidden();
    }
    await page.getByTestId("end-tournament").click();
    const finalize = page.getByRole("dialog", { name: "End Tournament" });
    await expect(finalize.getByTestId("confirm-finalize")).toBeEnabled();
    await expect(finalize.getByTestId("finalize-pool")).toHaveText("$390");
    await finalize.getByTestId("confirm-finalize").click();
    await expect(toast(page, "Tournament finalized")).toBeVisible();

    const paid = (await registrationsOf(page.request, tournament.id))
      .map((registration: PublicRegistration) => toCents(registration.prizeAmount))
      .filter((cents) => cents > 0)
      .sort((a, b) => b - a);
    expect(paid).toEqual([19_500, 11_700, 7_800]);
    await expect(page.getByTestId("prize-pool")).toHaveText("$390(paid)");
    await page.getByRole("tab", { name: "Overview" }).click();
    await expect(panel).toContainText("Finalized — showing what was paid.");
    await expect(panel.getByTestId("ap-take")).toHaveText("$10");
    await expect(page.getByTestId("paid-out")).toContainText("$390");

    await phone.reload();
    await expect(phone.getByText("Total prize pool: $390")).toBeVisible();
  });
});
