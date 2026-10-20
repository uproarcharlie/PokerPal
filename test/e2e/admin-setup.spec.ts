/**
 * (a) A platform admin's first evening: sign up, be made an admin by an operator, then build a club, a
 * season with a points system and a tournament, all through the admin UI.
 */
import { PASSWORD, uniqueToken } from "./support/api";
import { promoteToAdmin } from "./support/db";
import { expect, test } from "./support/fixtures";
import { choose, toast } from "./support/ui";

test("a new account, made a platform admin, sets up a club, a season, a points system and a tournament", async ({ page }) => {
  const token = uniqueToken();
  const email = `admin-${token}@example.test`;
  const clubName = `Admin Club ${token}`;
  const seasonName = `Summer ${token}`;
  const pointsName = `Standard Points ${token}`;
  const tournamentName = `Friday Freezeout ${token}`;

  await test.step("sign up as a member", async () => {
    await page.goto("/register");
    await page.getByLabel("Full Name*").fill("Ada Admin");
    await page.getByLabel("Email*").fill(email);
    await page.getByLabel("Password*", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Confirm Password*").fill(PASSWORD);
    await page.getByRole("button", { name: "Create Account" }).click();

    // Signing up lands on the staff home, the dashboard (P3REV5-CQ-13).
    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
    await expect(page.getByTestId("nav-users")).toHaveCount(0);
  });

  await test.step("become a platform admin", async () => {
    await promoteToAdmin(email);
    await page.reload();

    await expect(page.getByTestId("nav-users")).toBeVisible();
  });

  await test.step("create a club", async () => {
    await page.getByTestId("nav-clubs").click();
    await page.getByTestId("create-club-button").click();
    const form = page.getByRole("dialog", { name: "Create New Club" });
    await form.getByTestId("club-name").fill(clubName);
    await expect(form.getByLabel("URL Slug*")).toHaveValue(`admin-club-${token}`);
    await form.getByTestId("create-club-final").click();

    await expect(toast(page, "Club created successfully!")).toBeVisible();
    await expect(form).toBeHidden();
    const card = page.locator('[data-testid^="club-card-"]').filter({ hasText: clubName });
    await expect(card.getByRole("link", { name: "Settings" })).toBeVisible();
  });

  await test.step("create a season for it", async () => {
    await page.getByTestId("nav-seasons").click();
    await page.getByTestId("create-season-button").click();
    const form = page.getByRole("dialog", { name: "Create New Season" });
    await form.getByTestId("season-name").fill(seasonName);
    await choose(page, form.getByTestId("club-select"), clubName);
    await form.getByTestId("start-date").fill("2026-10-01");
    await form.getByTestId("create-season-final").click();

    await expect(toast(page, "Season created successfully!")).toBeVisible();
    const card = page.locator('[data-testid^="season-card-"]').filter({ hasText: seasonName });
    await expect(card).toContainText(clubName);
    await expect(card).toContainText("Active Season");
    await card.getByRole("link", { name: "Settings" }).click();
    await expect(page.getByRole("heading", { name: `${seasonName} Settings` })).toBeVisible();
  });

  await test.step("give the season a points system", async () => {
    await page.getByRole("tab", { name: "Points Systems" }).click();
    await page.getByLabel("System Name*").fill(pointsName);
    await page.getByLabel("Participation Points").fill("10");
    await page.getByLabel("Knockout Points").fill("5");
    for (const [position, points] of [["1", "100"], ["2", "70"], ["3", "50"]]) {
      await page.getByRole("button", { name: "Add Position" }).click();
      await page.getByPlaceholder("1", { exact: true }).last().fill(position);
      await page.getByPlaceholder("100", { exact: true }).last().fill(points);
    }
    await page.getByRole("button", { name: "Create Points System" }).click();

    await expect(toast(page, "Points system created successfully!")).toBeVisible();
    const existing = page.getByRole("heading", { name: "Existing Points Systems" }).locator("..");
    await expect(existing).toContainText(pointsName);
    await expect(existing).toContainText("Participation: 10 pts");
    await expect(existing).toContainText("Knockout: 5 pts");
  });

  await test.step("create a tournament in that club, season and points system", async () => {
    await page.getByTestId("nav-tournaments").click();
    await page.getByTestId("create-tournament-button").click();
    const form = page.getByRole("dialog", { name: "Create New Tournament" });
    await form.getByTestId("tournament-name").fill(tournamentName);
    await choose(page, form.getByTestId("club-select"), clubName);
    await choose(page, form.getByTestId("season-select"), seasonName);
    await choose(page, form.getByTestId("points-system-select"), pointsName);
    await form.getByTestId("start-datetime").fill("2026-10-24T19:30");
    await form.getByTestId("buyin-amount").fill("50");
    await form.getByTestId("min-players").fill("4");
    await form.getByTestId("max-players").fill("30");
    await form.getByTestId("create-tournament-final").click();

    await expect(toast(page, "Tournament created successfully!")).toBeVisible();
    const row = page.locator('[data-testid^="tournament-row-"]').filter({ hasText: tournamentName });
    await expect(row).toContainText(clubName);
    await expect(row).toContainText("Registration");
    await expect(row).toContainText("$50.00");
    await expect(row).toContainText("0/30");
  });

  await test.step("the club's page lists the tournament, which opens its admin page", async () => {
    await page.getByTestId("nav-clubs").click();
    await page.locator('[data-testid^="club-card-"]').filter({ hasText: clubName }).getByRole("link", { name: "View" }).click();
    await expect(page.getByTestId("club-name")).toHaveText(clubName);
    await expect(page.getByTestId("total-tournaments")).toHaveText("1");
    await expect(page.getByTestId("active-seasons")).toHaveText("1");
    await page.getByText(tournamentName).click();

    await expect(page).toHaveURL(/\/admin\/tournaments\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: tournamentName })).toBeVisible();
    await expect(page.getByText(clubName, { exact: true })).toBeVisible();
    await expect(page.getByText(`• Season: ${seasonName}`)).toBeVisible();
    await expect(page.getByTestId("players-count")).toHaveText("0/30");
    await expect(page.getByTestId("prize-pool")).toHaveText("$0");
  });
});
