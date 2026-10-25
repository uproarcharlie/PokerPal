/**
 * The tournament clock on the night: the TD sets it up from the Central Stars preset, starts it (and
 * the tournament with it), pauses, moves on a level and adds a minute; the TV display opened from the
 * Clock tab shows the same time and blinds, and a QR code that leads to the season's leaderboard, which
 * opens for anyone.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QRCodeSVG } from "qrcode.react";
import type { Locator, Page } from "@playwright/test";
import { signUp } from "./support/api";
import { buildDemoClub } from "./support/demo";
import { expect, test } from "./support/fixtures";
import { toast } from "./support/ui";

/** The clock face's time left and blinds, as a screen shows them. */
async function timeAndBlinds(face: Locator): Promise<{ time: string; blinds: string }> {
  return {
    time: (await face.getByRole("timer", { name: "Time left" }).innerText()).trim(),
    blinds: (await face.locator("p").filter({ hasText: /^Blinds/ }).innerText()).replace(/^Blinds\s*/, "").trim(),
  };
}

/** The TD's clock face: its level title too. */
async function faceOf(face: Locator): Promise<{ level: string; time: string; blinds: string }> {
  return { level: ((await face.getByRole("heading").first().textContent()) ?? "").trim(), ...(await timeAndBlinds(face)) };
}

/** The modules of a QR code as qrcode.react draws them (its second path), to compare two codes. */
function modulesOf(svg: string): string | undefined {
  return Array.from(svg.matchAll(/<path[^>]*\sd="([^"]+)"/g), ([, d]) => d)[1];
}

const clockFace = (page: Page) => page.getByTestId("clock-face");

test("a TD runs the clock from the Central Stars preset, and the TV shows it with a QR code to the season leaderboard", async ({ page, context }) => {
  await signUp(page.request, "Mere Director");
  const demo = await buildDemoClub(page.request);
  const tournament = demo.upcoming;

  await test.step("the TD sets the clock up from the Central Stars preset", async () => {
    await page.goto(`/admin/tournaments/${tournament.id}`);
    await page.getByRole("tab", { name: "Clock" }).click();
    await expect(page.getByTestId("preset-central_stars_one_life_line")).toContainText("Central Stars");
    await page.getByRole("button", { name: "Use this: Central Stars · One Life Line" }).click();

    await expect(toast(page, "Clock set up")).toBeVisible();
    expect(await faceOf(clockFace(page))).toEqual({ level: "Level 1", time: "20:00", blinds: "200/400" });
    await expect(clockFace(page)).toContainText("Not started");
    // The header's chip shows the clock too.
    await expect(page.getByTestId("clock-status-chip")).toContainText("L1 · 20:00 · 200/400");
  });

  await test.step("starting the clock starts the tournament too", async () => {
    await expect(page.getByLabel("Also start the tournament (status In Progress)")).toBeChecked();
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
    await expect(page.getByText("In Progress", { exact: true }).first()).toBeVisible();
    await expect(clockFace(page).getByRole("timer")).not.toHaveText("20:00");
  });

  await test.step("the TD pauses, moves on a level and adds a minute", async () => {
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
    await expect(clockFace(page)).toContainText("Paused");

    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(clockFace(page).getByRole("heading", { name: "Level 2" })).toBeVisible();
    await expect(clockFace(page).getByRole("timer")).toHaveText("20:00");

    await page.getByRole("button", { name: "+1 min", exact: true }).click();
    await expect(clockFace(page).getByRole("timer")).toHaveText("21:00");
    expect(await faceOf(clockFace(page))).toEqual({ level: "Level 2", time: "21:00", blinds: "300/600" });
  });

  let seasonUrl = "";
  await test.step("the TV display, opened from the Clock tab, shows the same time and blinds (without the level's number), and the season's QR code", async () => {
    const [tv] = await Promise.all([context.waitForEvent("page"), page.getByRole("link", { name: "Open TV display" }).click()]);
    await tv.setViewportSize({ width: 1920, height: 1080 });
    // Opened as the venue's screen: polled at the TV's rate whatever its size (TDN2-TABLET-AS-PHONE).
    await expect(tv).toHaveURL(new RegExp(`/clock/${tournament.id}\\?screen=tv$`));
    await expect(tv.getByRole("heading", { level: 1, name: tournament.name })).toBeVisible();
    await expect(clockFace(tv).getByRole("timer")).toHaveText("21:00");
    expect(await timeAndBlinds(clockFace(tv))).toEqual(await timeAndBlinds(clockFace(page)));
    // The blinds are the headline under the countdown: no "LEVEL 2" unless the TD shows it (round 5, item 21).
    await expect(clockFace(tv).getByRole("heading")).toHaveCount(0);

    const qr = tv.getByTestId("display-qr");
    await expect(qr).toContainText(`Scan for the ${demo.season.name} leaderboard`);
    seasonUrl = new URL(`/season/${demo.season.id}`, tv.url()).toString();
    await expect(qr).toContainText(seasonUrl.replace(/^https?:\/\//, ""));
    // The code itself encodes exactly that address: drawn again from it, it is the same picture.
    const shown = await qr.locator("svg").evaluate((svg) => svg.outerHTML);
    const expected = renderToStaticMarkup(createElement(QRCodeSVG, { value: seasonUrl, size: 240, level: "M", marginSize: 2 }));
    expect(modulesOf(shown)).toBeTruthy();
    expect(modulesOf(shown)).toBe(modulesOf(expected));
    await tv.close();
  });

  await test.step("the season page the code leads to opens for anyone", async () => {
    await context.clearCookies();
    await page.goto(seasonUrl);
    await expect(page.getByRole("heading", { level: 1, name: demo.season.name })).toBeVisible();
    await expect(page.getByText("After 1 of 3 tournaments")).toBeVisible();
    await expect(page.getByText(demo.players[0]!.name).first()).toBeVisible();
  });
});
