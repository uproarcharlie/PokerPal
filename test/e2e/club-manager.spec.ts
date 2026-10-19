/**
 * (d) A club owner invites a manager by email from the club's Managers tab, and the manager accepts the
 * invitation link signed in to the account that uses that address. The manager can then run that
 * club's tournament from the admin pages, but gets nowhere with another club's, through the UI or by
 * calling the API directly, and loses access as soon as the owner removes them.
 */
import type { ApiErrorBody } from "../../shared/api/errors";
import type { PendingRegistrationDto } from "../../shared/api/registrations";
import type { TournamentDetailDto } from "../../shared/api/tournaments";
import {
  createClub,
  createPlayer,
  createTournament,
  expectJson,
  registerPlayer,
  signUp,
  uniqueToken,
} from "./support/api";
import { expect, test } from "./support/fixtures";
import { toast } from "./support/ui";

test("a manager who accepted an invitation runs that club's tournament, and not another club's", async ({ page, request, openBrowser }) => {
  const token = uniqueToken();

  // The owner's browser (`page`), signed in by signing up through its own API session.
  await signUp(page.request, "Olive Owner");
  const club = await createClub(page.request, `Managed Club ${token}`);
  const game = await createTournament(page.request, { clubId: club.id, name: `Managed Game ${token}` });
  const player = await createPlayer(page.request, `Pat ${token}`);
  const registration = await registerPlayer(page.request, game.id, player.id);

  // Another club, with its own owner and game.
  const otherOwner = await openBrowser();
  await signUp(otherOwner.request, "Oscar Other");
  const otherClub = await createClub(otherOwner.request, `Other Club ${token}`);
  const otherGame = await createTournament(otherOwner.request, { clubId: otherClub.id, name: `Other Game ${token}` });
  const otherPlayer = await createPlayer(otherOwner.request, `Quin ${token}`);
  const otherRegistration = await registerPlayer(otherOwner.request, otherGame.id, otherPlayer.id);

  // The manager-to-be already has an account (made on `request`), and signs in on their own browser.
  const manager = await signUp(request, `Max Manager ${token}`);
  const managerPage = await (await openBrowser()).newPage();

  let inviteLink = "";
  await test.step("the owner invites the manager by their account email, which grants nothing until they accept (SEC-P2REV-03)", async () => {
    await page.goto(`/clubs/${club.id}/settings`);
    await page.getByRole("tab", { name: "Managers" }).click();
    await expect(page.getByTestId("no-managers")).toBeVisible();
    await page.getByTestId("invite-email").fill(manager.email.toUpperCase());
    await page.getByTestId("invite-submit").click();

    await expect(page.getByTestId("invite-created")).toContainText(manager.email);
    inviteLink = await page.getByTestId("invite-link").inputValue();
    expect(new URL(inviteLink).pathname).toBe("/staff-invite");
    await expect(page.getByTestId("no-managers")).toBeVisible();
  });

  await test.step("the manager opens the link, signs in, comes back to it and accepts", async () => {
    await managerPage.goto(inviteLink);
    await expect(managerPage.getByTestId("invite-sign-in")).toBeVisible();
    await managerPage.getByRole("link", { name: "Sign in" }).click();
    await managerPage.getByLabel("Email").fill(manager.email);
    await managerPage.getByLabel("Password").fill(manager.password);
    await managerPage.getByRole("button", { name: "Sign In" }).click();

    await managerPage.getByTestId("invite-accept").click();
    await expect(managerPage.getByTestId("invite-accepted")).toContainText(`You are now a manager of ${club.name}`);

    await page.reload();
    await page.getByRole("tab", { name: "Managers" }).click();
    await expect(page.getByTestId(`manager-row-${manager.id}`)).toContainText(manager.name);
    await expect(page.getByTestId(`manager-row-${manager.id}`)).toContainText(manager.email);
  });

  await test.step("the manager sees the club as one they run, and the other club as not", async () => {
    await managerPage.goto("/clubs");
    await expect(managerPage.getByTestId(`settings-club-${club.id}`)).toBeVisible();
    await expect(managerPage.getByTestId(`view-club-${otherClub.id}`)).toBeVisible();
    await expect(managerPage.getByTestId(`settings-club-${otherClub.id}`)).toHaveCount(0);

    // Managers edit the club, but only the owner or an admin changes its staff.
    await managerPage.getByTestId(`settings-club-${club.id}`).click();
    await expect(managerPage.getByRole("tab", { name: "Edit Profile" })).toBeVisible();
    await expect(managerPage.getByRole("tab", { name: "Managers" })).toHaveCount(0);

    // A new tournament can go in the club they run, and only there.
    await managerPage.getByTestId("nav-tournaments").click();
    await managerPage.getByTestId("create-tournament-button").click();
    await managerPage.getByRole("dialog", { name: "Create New Tournament" }).getByTestId("club-select").click();
    await expect(managerPage.getByRole("option")).toHaveText([club.name]);
    await managerPage.keyboard.press("Escape");
  });

  await test.step("the manager confirms a payment and locks the prize pool of the club's game", async () => {
    await managerPage.goto(`/admin/registrations/${game.id}`);
    await managerPage.getByTestId(`confirm-payment-${registration.id}`).filter({ visible: true }).click();
    await expect(managerPage.getByTestId(`confirmed-registration-${registration.id}`)).toContainText(player.name);

    await managerPage.goto(`/admin/tournaments/${game.id}`);
    await managerPage.getByRole("tab", { name: "Actions" }).click();
    await managerPage.getByText("Lock Prize Pool").click();
    // Locking asks first (TN2-01).
    await managerPage.getByTestId("confirm-lock-action").click();
    await expect(toast(managerPage, "Prize Pool Locked")).toBeVisible();
    await expect(managerPage.getByRole("heading", { name: "Prize Pool Locked" })).toBeVisible();
  });

  await test.step("the other club's game shows the manager no staff controls", async () => {
    await managerPage.goto(`/admin/registrations/${otherGame.id}`);
    await expect(managerPage.getByRole("heading", { name: "Access Denied" })).toBeVisible();
    await expect(managerPage.getByTestId(`confirm-payment-${otherRegistration.id}`)).toHaveCount(0);

    await managerPage.goto(`/admin/tournaments/${otherGame.id}`);
    await expect(managerPage.getByRole("heading", { name: otherGame.name })).toBeVisible();
    await managerPage.getByRole("tab", { name: "Actions" }).click();
    await expect(managerPage.getByText("Lock Prize Pool")).toHaveCount(0);
    await managerPage.getByRole("tab", { name: "Standings" }).click();
    await expect(managerPage.getByTestId(`player-row-${otherRegistration.id}`)).toBeVisible();
    await expect(managerPage.getByTestId(`eliminate-player-${otherRegistration.id}`)).toHaveCount(0);
  });

  await test.step("and the API refuses the manager's writes to it", async () => {
    const confirm = await managerPage.request.patch(`/api/registrations/${otherRegistration.id}/confirm-payment`);
    expect((await expectJson<ApiErrorBody>(confirm, 403)).code).toBe("FORBIDDEN");
    const lock = await managerPage.request.put(`/api/tournaments/${otherGame.id}`, { data: { prizePoolLocked: true } });
    expect((await expectJson<ApiErrorBody>(lock, 403)).code).toBe("FORBIDDEN");

    const pending = await expectJson<PendingRegistrationDto[]>(
      await otherOwner.request.get(`/api/tournaments/${otherGame.id}/pending-registrations`),
      200,
    );
    expect(pending.map((row) => row.id)).toEqual([otherRegistration.id]);
    const after = await expectJson<TournamentDetailDto>(await otherOwner.request.get(`/api/tournaments/${otherGame.id}`), 200);
    expect(after.prizePoolLocked).toBe(false);
  });

  await test.step("once the owner removes them, the manager can no longer run the club", async () => {
    await page.getByRole("button", { name: `Remove ${manager.name}` }).click();
    await expect(toast(page, "Manager removed")).toBeVisible();
    await expect(page.getByTestId("no-managers")).toBeVisible();

    await managerPage.goto(`/admin/registrations/${game.id}`);
    await expect(managerPage.getByRole("heading", { name: "Access Denied" })).toBeVisible();
    const rename = await managerPage.request.put(`/api/tournaments/${game.id}`, { data: { name: "Taken over" } });
    expect((await expectJson<ApiErrorBody>(rename, 403)).code).toBe("FORBIDDEN");
  });
});
