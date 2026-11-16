/**
 * Club settings → Payments (round 8, item 1), on a phone (390 px): the club's bank account for players
 * paying ahead by transfer, read and saved by its owner, managers and admins, the account number laid
 * out as the banks write it while it is typed, and removed with a question first; who changed it last,
 * and when, is said above it.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "@test/msw/server";
import { apiError, mockSignedIn, renderWithApp } from "@test/helpers/web";
import { clubDto, MANAGER_VIEW } from "@test/helpers/f3-clubs";
import { screenWidth } from "@test/helpers/f1-tournaments";
import type { BankDetails, BankDetailsChangeDto, ClubPaymentsDto } from "@shared/api/clubs";
import ClubSettingsPage from "../pages/club-settings";

const DETAILS: BankDetails = {
  accountName: "Central Stars Poker Club",
  accountNumber: "12-3456-7890123-00",
  bankName: "ANZ",
  instructions: "Pay by 5 pm on the day",
};

let stored: BankDetails | null;
let sent: unknown[];

/**
 * The club's payments as the server holds them, with the changes made so far (newest first): PUT
 * replaces them, records `saved` as the change it made, and answers with them.
 */
function servePayments(initial: BankDetails | null, { changes = [] as BankDetailsChangeDto[], saved }: { changes?: BankDetailsChangeDto[]; saved?: BankDetailsChangeDto } = {}) {
  stored = initial;
  let trail = changes;
  server.use(
    http.get("/api/clubs/c1/payments", () => HttpResponse.json<ClubPaymentsDto>({ clubId: "c1", bankDetails: stored, changes: trail })),
    http.put("/api/clubs/c1/payments", async ({ request }) => {
      const body = (await request.json()) as { bankDetails: BankDetails | null };
      sent.push(body);
      stored = body.bankDetails;
      if (saved) trail = [saved, ...trail];
      return HttpResponse.json<ClubPaymentsDto>({ clubId: "c1", bankDetails: stored, changes: trail });
    }),
  );
}

beforeEach(() => {
  screenWidth(390);
  sent = [];
  mockSignedIn({ id: "u-manager", name: "Mia Manager", email: "mia@club.test", role: "full_member" });
  server.use(http.get("/api/clubs/c1", () => HttpResponse.json(clubDto({ viewer: MANAGER_VIEW }))));
});

/** The settings page opened on its Payments tab, as the tournament form's link opens it. */
async function openPayments() {
  const user = userEvent.setup();
  renderWithApp(<ClubSettingsPage />, { path: "/clubs/c1/settings?tab=payments", route: "/clubs/:id/settings" });
  expect(await screen.findByRole("tab", { name: "Payments", selected: true })).toBeInTheDocument();
  return user;
}

const accountNumber = () => screen.getByRole("textbox", { name: "Account number" });

describe("Club settings → Payments", () => {
  it("says who last changed the bank details and when, and the changes before (R8REV0-PRIV-03)", async () => {
    servePayments(DETAILS, {
      changes: [
        { at: "2026-11-17T06:30:00.000Z", by: "Sam Manager", change: "changed", fields: ["accountNumber", "bankName"] },
        { at: "2026-11-10T06:30:00.000Z", by: null, change: "added", fields: ["accountName", "accountNumber"] },
      ],
      saved: { at: "2026-11-18T06:30:00.000Z", by: "Mia Manager", change: "changed", fields: ["instructions"] },
    });
    const user = await openPayments();

    const changes = await screen.findByRole("region", { name: "Last changed by Sam Manager on Tue, 17 Nov 2026, 7:30 pm" });
    expect(within(changes).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Tue, 17 Nov 2026, 7:30 pm · Sam Manager changed the account number and bank",
      "Tue, 10 Nov 2026, 7:30 pm · A former staff member added the bank details",
    ]);

    // A save shows its own change straight away.
    await user.clear(screen.getByRole("textbox", { name: "Note for players (optional)" }));
    await user.type(screen.getByRole("textbox", { name: "Note for players (optional)" }), "Pay by noon");
    await user.click(screen.getByRole("button", { name: "Save bank details" }));
    expect(await screen.findByRole("region", { name: "Last changed by Mia Manager on Wed, 18 Nov 2026, 7:30 pm" })).toBeInTheDocument();
  });

  it("shows no changes for a club that has never had bank details", async () => {
    servePayments(null);
    await openPayments();

    expect(await screen.findByTestId("club-payments-none")).toBeInTheDocument();
    expect(screen.queryByTestId("bank-details-changes")).not.toBeInTheDocument();
  });

  it("lets a manager add the club's bank details, the number laid out as the banks write it", async () => {
    servePayments(null);
    const user = await openPayments();

    expect(await screen.findByTestId("club-payments-none")).toHaveTextContent("No bank details yet");
    expect(screen.queryByRole("button", { name: "Remove bank details" })).not.toBeInTheDocument();
    // A phone's number pad has no dash: they go in as the digits are typed.
    expect(accountNumber()).toHaveAttribute("inputmode", "numeric");
    await user.type(screen.getByRole("textbox", { name: "Account name" }), DETAILS.accountName);
    await user.type(accountNumber(), "1234567");
    expect(accountNumber()).toHaveValue("12-3456-7");
    await user.type(accountNumber(), "89012300");
    expect(accountNumber()).toHaveValue("12-3456-7890123-00");
    await user.type(screen.getByRole("textbox", { name: "Bank (optional)" }), "ANZ");
    await user.type(screen.getByRole("textbox", { name: "Note for players (optional)" }), DETAILS.instructions ?? "");
    await user.click(screen.getByRole("button", { name: "Save bank details" }));

    await waitFor(() => expect(sent).toEqual([{ bankDetails: DETAILS }]));
    expect(await screen.findByText("Bank details saved")).toBeInTheDocument();
    expect(screen.queryByTestId("club-payments-none")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove bank details" })).toBeInTheDocument();
  });

  it("sends a pasted number with spaces as the banks write it, and a 3-digit suffix too", async () => {
    servePayments(null);
    const user = await openPayments();

    await user.type(await screen.findByRole("textbox", { name: "Account name" }), "Central Stars");
    await user.click(accountNumber());
    await user.paste("02 1234 5678901 001");
    expect(accountNumber()).toHaveValue("02-1234-5678901-001");
    await user.click(screen.getByRole("button", { name: "Save bank details" }));

    await waitFor(() => expect(sent).toEqual([{ bankDetails: { accountName: "Central Stars", accountNumber: "02-1234-5678901-001", bankName: null, instructions: null } }]));
  });

  it("names what is missing or not an account number, and sends nothing", async () => {
    servePayments(null);
    const user = await openPayments();

    await user.click(await screen.findByRole("button", { name: "Save bank details" }));
    expect(await screen.findByText("Required")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Account name" }), "Central Stars");
    await user.type(accountNumber(), "1234");
    await user.click(screen.getByRole("button", { name: "Save bank details" }));

    expect(await screen.findByText("Enter a New Zealand account number, like 12-3456-7890123-00")).toBeInTheDocument();
    expect(accountNumber()).toHaveAttribute("aria-invalid", "true");
    expect(sent).toEqual([]);
  });

  it("puts the server's refusal of the number under it", async () => {
    servePayments(null);
    server.use(
      http.put("/api/clubs/c1/payments", () =>
        apiError(400, "VALIDATION", "Invalid request", [{ path: ["bankDetails", "accountNumber"], message: "That account number is not accepted" }]),
      ),
    );
    const user = await openPayments();

    await user.type(await screen.findByRole("textbox", { name: "Account name" }), "Central Stars");
    await user.type(accountNumber(), "123456789012300");
    await user.click(screen.getByRole("button", { name: "Save bank details" }));

    expect(await screen.findByText("That account number is not accepted")).toBeInTheDocument();
    expect(accountNumber()).toHaveFocus();
  });

  it("shows the stored details, and removes them after asking", async () => {
    servePayments(DETAILS);
    const user = await openPayments();

    expect(await screen.findByRole("textbox", { name: "Account number" })).toHaveValue("12-3456-7890123-00");
    expect(screen.getByRole("textbox", { name: "Account name" })).toHaveValue("Central Stars Poker Club");
    await user.click(screen.getByRole("button", { name: "Remove bank details" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Remove the bank details?" });
    expect(dialog).toHaveTextContent("players pay at the door");
    await user.click(within(dialog).getByRole("button", { name: "Remove bank details" }));

    await waitFor(() => expect(sent).toEqual([{ bankDetails: null }]));
    expect(await screen.findByTestId("club-payments-none")).toBeInTheDocument();
    expect(accountNumber()).toHaveValue("");
    // Remove has gone with the details: focus lands on Save, not on the page.
    await waitFor(() => expect(screen.getByRole("button", { name: "Save bank details" })).toHaveFocus());
  });

  it("says when the details could not be loaded, and offers to try again", async () => {
    server.use(http.get("/api/clubs/c1/payments", () => apiError(500, "INTERNAL", "Something went wrong")));
    await openPayments();

    expect(await screen.findByText("The club's bank details could not be loaded")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Try again/ })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Account number" })).not.toBeInTheDocument();
  });
});
