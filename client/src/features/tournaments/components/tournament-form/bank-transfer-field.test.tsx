/**
 * "Show bank transfer details after sign-up" in the tournament form (round 8, item 2), on a phone
 * (390 px), in a Payments part of its own: usable only once the club has bank details, else off with
 * a link to add them; off again when the club changes; sent when switched, never resent by an edit
 * that leaves it alone; the server's refusal said under it.
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "@test/msw/server";
import { apiError, mockSignedIn, renderWithApp } from "@test/helpers/web";
import { clubDto, recordBodies, screenWidth, tournamentDto } from "@test/helpers/f1-tournaments";
import type { BankDetails, ClubPaymentsDto } from "@shared/api/clubs";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { CreateTournamentDialog } from "../create-tournament-dialog";
import { EditTournamentDialog } from "../edit-tournament-dialog";

const DETAILS: BankDetails = { accountName: "Central Stars Poker Club", accountNumber: "12-3456-7890123-00", bankName: "ANZ", instructions: null };

/** GET /api/clubs/c1/payments's answer: the club's bank details, or none, never changed. */
const payments = (bankDetails: BankDetails | null): ClubPaymentsDto => ({ clubId: "c1", bankDetails, changes: [] });

/** The club (with or without bank details), no seasons; every create and save recorded. */
function mockForm(bankDetails: BankDetails | null) {
  const sent = recordBodies();
  server.use(
    http.get("/api/clubs", () => HttpResponse.json([clubDto()])),
    http.get("/api/clubs/c1/payments", () => HttpResponse.json<ClubPaymentsDto>(payments(bankDetails))),
    http.get("/api/seasons", () => HttpResponse.json([])),
    http.get("/api/tournaments/t1/registrations", () => HttpResponse.json([])),
    http.post("/api/tournaments", async ({ request }) => {
      await sent.record(request);
      return HttpResponse.json(tournamentDto(), { status: 201 });
    }),
    http.put("/api/tournaments/t1", async ({ request }) => {
      await sent.record(request);
      return HttpResponse.json(tournamentDto());
    }),
  );
  return sent.bodies;
}

/** The create dialog, open in the viewer's only club, with the required fields filled in. */
async function openCreate() {
  const user = userEvent.setup();
  renderWithApp(<CreateTournamentDialog open onOpenChange={() => {}} />);
  await screen.findByRole("dialog", { name: "Create New Tournament" }, { timeout: 5000 });
  await user.type(screen.getByTestId("tournament-name"), "Wed 18 Nov");
  fireEvent.change(screen.getByTestId("start-datetime"), { target: { value: "2026-11-18T19:30" } });
  await user.type(screen.getByTestId("max-players"), "30");
  await user.type(screen.getByTestId("buyin-amount"), "50");
  return user;
}

function openEdit(tournament: TournamentDetailDto) {
  const user = userEvent.setup();
  renderWithApp(<EditTournamentDialog tournament={tournament} club={clubDto()} open onOpenChange={() => {}} />);
  return user;
}

const transferSwitch = () => screen.getByRole("switch", { name: "Show bank transfer details after sign-up" });

beforeEach(() => {
  screenWidth(390);
  mockSignedIn({ id: "u1", name: "Tess TD", email: "tess@club.test", role: "full_member" });
});

describe("the tournament form's bank transfer switch", () => {
  it("is off for a new tournament, and switching it on sends it", async () => {
    const sent = mockForm(DETAILS);
    const user = await openCreate();

    await waitFor(() => expect(transferSwitch()).toBeEnabled());
    expect(transferSwitch()).not.toBeChecked();
    expect(transferSwitch()).toHaveAccessibleDescription(expect.stringContaining("They can still pay at the door."));
    await user.click(transferSwitch());
    expect(transferSwitch()).toBeChecked();
    await user.click(screen.getByTestId("create-tournament-final"));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ name: "Wed 18 Nov", showBankTransfer: true });
  });

  it("cannot be used before the club has bank details, and links to where they are added", async () => {
    const sent = mockForm(null);
    const user = await openCreate();

    const setting = await screen.findByTestId("bank-transfer-setting");
    await waitFor(() => expect(transferSwitch()).toBeDisabled());
    expect(transferSwitch()).not.toBeChecked();
    const link = within(setting).getByRole("link", { name: /Club settings → Payments/ });
    // Beside the form, so the tournament typed so far stays.
    expect(link).toHaveAttribute("href", "/clubs/c1/settings?tab=payments");
    expect(link).toHaveAttribute("target", "_blank");
    expect(setting).toHaveTextContent("Add the club's bank details first");
    await user.click(screen.getByTestId("create-tournament-final"));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ showBankTransfer: false });
  });

  it("goes off when the club changes, so another club's bank details are never asked for (R8REV1-PHONE-03)", async () => {
    const sent = mockForm(DETAILS);
    server.use(
      http.get("/api/clubs", () => HttpResponse.json([clubDto(), clubDto({ id: "c2", name: "Second Club" })])),
      http.get("/api/clubs/c2/payments", () => HttpResponse.json<ClubPaymentsDto>({ ...payments(null), clubId: "c2" })),
    );
    const user = await openCreate();
    const chooseClub = async (name: string) => {
      await user.click(screen.getByTestId("club-select"));
      await user.click(await screen.findByRole("option", { name }));
    };

    await chooseClub("Central Stars");
    await waitFor(() => expect(transferSwitch()).toBeEnabled());
    await user.click(transferSwitch());
    expect(transferSwitch()).toBeChecked();
    // A club without bank details: off, and cannot be switched on.
    await chooseClub("Second Club");
    await waitFor(() => expect(transferSwitch()).toBeDisabled());
    expect(transferSwitch()).not.toBeChecked();
    // Back to one with them: still off until switched on again.
    await chooseClub("Central Stars");
    await waitFor(() => expect(transferSwitch()).toBeEnabled());
    expect(transferSwitch()).not.toBeChecked();

    await user.click(transferSwitch());
    await chooseClub("Second Club");
    await waitFor(() => expect(transferSwitch()).toBeDisabled());
    await user.click(screen.getByTestId("create-tournament-final"));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ clubId: "c2", showBankTransfer: false });
  });

  it("sits in a Payments part of its own, never between the high hand's box and its settings (R8REV1-PHONE-04)", async () => {
    mockForm(DETAILS);
    const user = await openCreate();

    await user.click(screen.getByTestId("enable-high-hand"));
    const fee = await screen.findByTestId("high-hand-amount");
    const setting = screen.getByTestId("bank-transfer-setting");
    const follows = (earlier: Element, later: Element) => Boolean(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING);
    // The high hand's box, then its settings and its note, then the bank transfer switch.
    expect(follows(screen.getByTestId("enable-high-hand"), fee)).toBe(true);
    expect(follows(fee, setting)).toBe(true);
    expect(follows(screen.getByText("High Hand Bonus:"), setting)).toBe(true);
    expect(within(setting.closest("section") as HTMLElement).getByRole("heading", { level: 3 })).toHaveTextContent("Payments");
    expect(within(fee.closest("section") as HTMLElement).queryByTestId("bank-transfer-setting")).not.toBeInTheDocument();
  });

  it("becomes usable when the TD comes back from adding the bank details in another tab (R8REV1-PHONE-05)", async () => {
    mockForm(null);
    const user = await openCreate();
    await waitFor(() => expect(transferSwitch()).toBeDisabled());

    // Saved in the other tab, seconds later: this tab's copy is not yet 30 s old.
    server.use(http.get("/api/clubs/c1/payments", () => HttpResponse.json<ClubPaymentsDto>(payments(DETAILS))));
    window.dispatchEvent(new Event("visibilitychange"));

    await waitFor(() => expect(transferSwitch()).toBeEnabled());
    await user.click(transferSwitch());
    expect(transferSwitch()).toBeChecked();
  });

  it("shows a stored setting on, and an edit that leaves it alone never resends it", async () => {
    const sent = mockForm(DETAILS);
    const user = openEdit(tournamentDto({ status: "registration", showBankTransfer: true }));

    await waitFor(() => expect(transferSwitch()).toBeEnabled());
    expect(transferSwitch()).toBeChecked();
    await user.clear(screen.getByTestId("tournament-name"));
    await user.type(screen.getByTestId("tournament-name"), "Wednesday Night");
    await user.click(screen.getByTestId("save-tournament"));

    await waitFor(() => expect(sent).toEqual([{ name: "Wednesday Night" }]));
  });

  it("is sent by an edit that switches it", async () => {
    const sent = mockForm(DETAILS);
    const user = openEdit(tournamentDto({ status: "registration" }));

    await waitFor(() => expect(transferSwitch()).toBeEnabled());
    await user.click(transferSwitch());
    await user.click(screen.getByTestId("save-tournament"));

    await waitFor(() => expect(sent).toEqual([{ showBankTransfer: true }]));
  });

  it("puts the server's refusal under the switch, and stays open", async () => {
    mockForm(DETAILS);
    server.use(
      http.put("/api/tournaments/t1", () =>
        apiError(400, "VALIDATION", "Invalid request", [{ path: ["showBankTransfer"], message: "Add the club's bank details first" }]),
      ),
    );
    const user = openEdit(tournamentDto({ status: "registration" }));

    await waitFor(() => expect(transferSwitch()).toBeEnabled());
    await user.click(transferSwitch());
    await user.click(screen.getByTestId("save-tournament"));

    expect(await within(screen.getByTestId("bank-transfer-setting")).findByText("Add the club's bank details first")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Edit Tournament" })).toBeInTheDocument();
  });
});
