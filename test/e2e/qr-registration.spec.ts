/**
 * (b) The QR sign-up on a phone, signed out: a first-timer takes a selfie with the camera and registers,
 * a regular finds themselves with the search (which only looks at this club's players), and a second
 * attempt is told kindly that they are already in.
 */
import { devices } from "@playwright/test";
import type { ImageUploadResponse } from "../../shared/api/images";
import {
  createClub,
  createPlayer,
  createTournament,
  registerPlayer,
  registrationsOf,
  signUp,
  uniquePhone,
  uniqueToken,
} from "./support/api";
import { expect, test } from "./support/fixtures";
import { toast } from "./support/ui";

// The browser type is the project's (Chromium, with the fake camera); a device may not choose another.
const { defaultBrowserType: _browser, ...pixel7 } = devices["Pixel 7"];
test.use(pixel7);

test("a player registers from the QR code on a phone: new with a selfie, then an existing player, then a duplicate", async ({
  page,
  request,
  baseURL,
}) => {
  const token = uniqueToken();
  const newcomer = { name: `Nina ${token}`, phone: uniquePhone() };

  // The club's owner prepares tonight's game on their own device (`request` is not the phone's session).
  await signUp(request, "Quinn Owner");
  const club = await createClub(request, `QR Club ${token}`);
  const lastWeek = await createTournament(request, { clubId: club.id, name: `Last Week ${token}` });
  const regular = await createPlayer(request, `Erin ${token}`);
  await registerPlayer(request, lastWeek.id, regular.id);
  const elsewhere = await createClub(request, `Elsewhere ${token}`);
  const otherGame = await createTournament(request, { clubId: elsewhere.id });
  const stranger = await createPlayer(request, `Erik ${token}`);
  await registerPlayer(request, otherGame.id, stranger.id);
  const tonight = await createTournament(request, { clubId: club.id, name: `Tonight ${token}`, buyInAmount: "40.00" });

  await test.step("the QR code leads to the tournament's registration page", async () => {
    await page.goto(`/qr/${tonight.id}`);
    const link = page.locator("code").filter({ hasText: "/register/" });
    await expect(link).toHaveText(`${baseURL}/register/${tonight.id}`);
    await page.goto((await link.textContent()) ?? "");

    await expect(page.getByText(tonight.name)).toBeVisible();
    await expect(page.getByText(club.name)).toBeVisible();
    await expect(page.getByText("Step 1 of 3")).toBeVisible();
  });

  let photoUrl = "";
  await test.step("a new player takes a photo with the phone's camera", async () => {
    await page.getByTestId("player-type-new").click();
    await page.getByTestId("step1-next").click();
    await page.getByRole("button", { name: "Take Photo" }).click();

    // Capture is enabled once the camera's first frame is in, so pressing it at once takes the photo.
    const camera = page.getByRole("dialog", { name: "Take a photo" });
    const uploaded = page.waitForResponse((response) => response.url().endsWith("/api/images/player_avatar"));
    await camera.getByRole("button", { name: "Capture" }).click();

    const response = await uploaded;
    expect(response.status()).toBe(201);
    photoUrl = ((await response.json()) as ImageUploadResponse).url;
    expect(photoUrl).toMatch(/^\/uploads\/player_avatar\/[0-9a-f-]{36}\/\d+\.webp$/);
    await expect(camera).toBeHidden();
    await expect(page.getByAltText("Upload preview")).toBeVisible();
    await expect(page.getByTestId("step2-next")).toHaveText("Continue");
  });

  await test.step("and registers with their name and number", async () => {
    await page.getByTestId("player-name").fill(newcomer.name);
    await page.getByTestId("player-phone").fill(newcomer.phone);
    await page.getByTestId("step2-next").click();

    await expect(page.getByTestId("registering-as")).toHaveText(`Registering ${newcomer.name}`);
    await page.getByTestId("complete-registration").click();

    await expect(page.getByText("Registration Complete!")).toBeVisible();
    await expect(page.getByTestId("amount-due")).toHaveText("$40.00");
  });

  await test.step("a regular finds themselves by name; only this club's players are searched", async () => {
    await page.getByTestId("register-another").click();
    await page.getByTestId("player-type-existing").click();
    await page.getByTestId("step1-next").click();
    await page.getByTestId("player-search").fill(token);

    const matches = page.getByRole("list", { name: "Matching players" }).getByRole("button");
    await expect(matches).toHaveText([regular.name, newcomer.name].sort());
    await matches.filter({ hasText: regular.name }).click();
    await page.getByTestId("step2-next").click();

    await expect(page.getByTestId("registering-as")).toHaveText(`Registering ${regular.name}`);
    await page.getByTestId("complete-registration").click();
    await expect(page.getByText("Registration Complete!")).toBeVisible();
  });

  await test.step("signing up again is recognised, and refused kindly", async () => {
    await page.getByTestId("register-another").click();
    await page.getByTestId("player-type-new").click();
    await page.getByTestId("step1-next").click();
    await page.getByTestId("player-name").fill(newcomer.name);
    await page.getByTestId("player-phone").fill(newcomer.phone);
    await page.getByTestId("step2-next").click();

    await expect(toast(page, "Welcome back!")).toBeVisible();
    await expect(page.getByTestId("registering-as")).toHaveText(`Registering ${newcomer.name}`);
    await page.getByTestId("complete-registration").click();
    await expect(page.getByTestId("registration-problem")).toHaveText(
      "You're already registered for this tournament. See you at the table!",
    );
  });

  await test.step("someone else cannot take that phone number", async () => {
    await page.getByTestId("step3-back").click();
    await page.getByTestId("player-name").fill(`Someone ${token}`);
    await page.getByTestId("step2-next").click();

    await expect(page.getByText("That phone number is already registered to another player.")).toBeVisible();
    await expect(page.getByText("Step 2 of 3")).toBeVisible();
  });

  await test.step("tonight's list has both players once, the newcomer with their photo", async () => {
    const registrations = await registrationsOf(request, tonight.id);
    expect(registrations.map((registration) => registration.player?.name).sort()).toEqual([regular.name, newcomer.name].sort());
    expect(registrations.find((registration) => registration.player?.name === newcomer.name)?.player?.imageUrl).toBe(photoUrl);

    await page.goto(`/tournament/${tonight.id}`);
    await page.getByRole("tab", { name: "Standings" }).click();
    const avatar = page.getByRole("img", { name: newcomer.name });
    await expect(avatar).toHaveAttribute("src", photoUrl);
    await expect.poll(() => avatar.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  });
});
