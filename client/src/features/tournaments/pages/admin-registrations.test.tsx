import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "@test/msw/server";
import { apiError, mockSignedIn, renderWithApp } from "@test/helpers/web";
import { clubDto, phoneLayout, registrationDto, tournamentDto } from "@test/helpers/f1-tournaments";
import type { ConfirmedRegistrationDto, PendingRegistrationDto } from "@shared/api/registrations";
import AdminRegistrationsPage from "./admin-registrations";

const staffPlayer = (id: string, name: string, phone: string | null) =>
  ({ id, name, email: null, phone, imageUrl: null, createdAt: null, canEdit: true }) as const;

const ann: PendingRegistrationDto = {
  ...registrationDto("r1", "Ann", 2, { rebuys: 1, addons: 1 }),
  paymentConfirmed: false,
  player: staffPlayer("p-r1", "Ann", "021 555 0101"),
  amountOwed: 175,
};
const visitor: PendingRegistrationDto = {
  ...registrationDto("r2", "Vic", 1, { enteringHighHands: true }),
  paymentConfirmed: false,
  player: { id: "p-r2", name: "Vic", email: null, phone: null, imageUrl: null, createdAt: null, canEdit: false },
  amountOwed: 60.5,
};
const bob: ConfirmedRegistrationDto = {
  ...registrationDto("r3", "Bob", 1),
  paymentConfirmed: true,
  player: staffPlayer("p-r3", "Bob", null),
  amountPaid: 50,
};

function mockDesk({ canManage = true, pending = [ann, visitor], confirmed = [bob] } = {}) {
  const lists: string[] = [];
  server.use(
    http.get("/api/tournaments/t1", () => HttpResponse.json(tournamentDto({ viewer: { canManage, canOwn: canManage } }))),
    http.get("/api/clubs/c1", () => HttpResponse.json(clubDto())),
    http.get("/api/tournaments/t1/pending-registrations", () => {
      lists.push("pending");
      return HttpResponse.json(pending);
    }),
    http.get("/api/tournaments/t1/confirmed-registrations", () => {
      lists.push("confirmed");
      return HttpResponse.json(confirmed);
    }),
  );
  return lists;
}

function renderDesk() {
  return renderWithApp(<AdminRegistrationsPage />, { path: "/admin/registrations/t1", route: "/admin/registrations/:tournamentId" });
}

beforeEach(() => {
  mockSignedIn({ id: "u1", name: "Tess TD", email: "tess@club.test", role: "full_member" });
});

describe("AdminRegistrationsPage", () => {
  it("shows what each sign-up owes and each paid player paid, as the server works them out", async () => {
    mockDesk();
    renderDesk();

    const waiting = await screen.findByRole("table", { name: "Registrations waiting for payment" });
    const annRow = within(waiting).getByTestId("registration-r1");
    expect(annRow).toHaveTextContent("021 555 0101");
    expect(annRow).toHaveTextContent("$175.00");
    expect(annRow).toHaveTextContent("7:30 pm");
    // Another club's player keeps their phone number.
    expect(within(waiting).getByTestId("registration-r2")).toHaveTextContent("Other club");
    expect(screen.getByText("Total Pending").parentElement).toHaveTextContent("$235.50");

    const paid = screen.getByRole("table", { name: "Players who have paid" });
    expect(within(paid).getByTestId("confirmed-registration-r3")).toHaveTextContent("$50.00");
    expect(screen.getByText("Total Collected").parentElement).toHaveTextContent("$50.00");
    // Counted in words, as every count is (P3REV6-CQ-10): never "1 player(s)".
    expect(screen.getByText("2 players")).toBeInTheDocument();
    expect(screen.getByText("1 player")).toBeInTheDocument();
    expect(screen.queryByText(/player\(s\)/)).not.toBeInTheDocument();
    // The desk's two card headings are one style, the card title's own (P3REV6-CQ-09).
    const pendingTitle = screen.getByRole("heading", { name: "Pending Payment Confirmations" });
    expect(pendingTitle.className).toBe(screen.getByRole("heading", { name: "Confirmed Players" }).className);
    expect(screen.getByTestId("view-qr-code")).toHaveAttribute("href", "/qr/t1");
    expect(screen.getByRole("link", { name: "Tournament" })).toHaveAttribute("href", "/admin/tournaments/t1");
  });

  it("tells each confirmation's own outcome when the next row is confirmed before the first answer came (P3REV0-PARITY-03)", async () => {
    mockDesk();
    let answerAnn: () => void = () => {};
    const annAnswered = new Promise<void>((resolve) => {
      answerAnn = resolve;
    });
    server.use(
      http.patch("/api/registrations/r1/confirm-payment", async () => {
        await annAnswered;
        return apiError(409, "CONFLICT", "Ann's payment was already confirmed on another device");
      }),
      http.patch("/api/registrations/r2/confirm-payment", () => HttpResponse.json({ ...visitor, paymentConfirmed: true })),
    );
    const user = userEvent.setup();
    renderDesk();

    await user.click(await screen.findByTestId("confirm-payment-r1"));
    await user.click(screen.getByTestId("confirm-payment-r2"));
    expect(await screen.findByText("Registration payment has been confirmed.")).toBeInTheDocument();
    expect(screen.getByTestId("confirm-payment-r1")).toHaveAttribute("aria-disabled", "true");

    answerAnn();
    expect(await screen.findByText("Ann's payment was already confirmed on another device")).toBeInTheDocument();
    expect(screen.getByTestId("confirm-payment-r1")).not.toHaveAttribute("aria-disabled");
  });

  it("confirms a payment, then shows the lists as the server has them", async () => {
    let confirmedIds: string[] = [];
    mockDesk();
    server.use(
      http.patch("/api/registrations/:id/confirm-payment", ({ params }) => {
        confirmedIds = [...confirmedIds, String(params.id)];
        return HttpResponse.json({ ...ann, paymentConfirmed: true });
      }),
      http.get("/api/tournaments/t1/pending-registrations", () => HttpResponse.json(confirmedIds.includes("r1") ? [visitor] : [ann, visitor])),
    );
    const user = userEvent.setup();
    renderDesk();

    await user.click(await screen.findByTestId("confirm-payment-r1"));

    expect(await screen.findByText("Payment Confirmed")).toBeInTheDocument();
    expect(confirmedIds).toEqual(["r1"]);
    await waitFor(() => expect(screen.queryByTestId("registration-r1")).not.toBeInTheDocument());
  });

  it("frees the desk as soon as the server confirms, without waiting for the lists to refresh (P3REV4-PERF-02)", async () => {
    mockDesk();
    let refreshing = false;
    let hold: () => void = () => undefined;
    server.use(
      http.patch("/api/registrations/:id/confirm-payment", () => {
        refreshing = true;
        return HttpResponse.json({ ...ann, paymentConfirmed: true });
      }),
      // The refresh after it hangs on the venue's Wi-Fi.
      http.get("/api/tournaments/t1/pending-registrations", async () => {
        if (refreshing) await new Promise<void>((resolve) => (hold = resolve));
        return HttpResponse.json(refreshing ? [visitor] : [ann, visitor]);
      }),
    );
    const user = userEvent.setup();
    renderDesk();

    await user.click(await screen.findByTestId("confirm-payment-r1"));

    expect(await screen.findByText("Payment Confirmed")).toBeInTheDocument();
    expect(screen.queryByTestId("registration-r1")).not.toBeInTheDocument();
    expect(screen.getByTestId("confirm-payment-r2")).not.toHaveAttribute("aria-disabled");
    hold();
  });

  it("waits only on the payment being confirmed: every other row can still be confirmed", async () => {
    mockDesk();
    let answer: () => void = () => undefined;
    server.use(
      http.patch("/api/registrations/:id/confirm-payment", async () => {
        await new Promise<void>((resolve) => (answer = resolve));
        return HttpResponse.json({ ...ann, paymentConfirmed: true });
      }),
    );
    const user = userEvent.setup();
    renderDesk();

    await user.click(await screen.findByTestId("confirm-payment-r1"));

    await waitFor(() => expect(screen.getByTestId("confirm-payment-r1")).toHaveAttribute("aria-disabled", "true"));
    expect(screen.getByTestId("confirm-payment-r2")).not.toHaveAttribute("aria-disabled");
    answer();
    expect(await screen.findByText("Payment Confirmed")).toBeInTheDocument();
  });

  it("shows the server's sentence when a payment cannot be confirmed", async () => {
    mockDesk();
    server.use(http.patch("/api/registrations/:id/confirm-payment", () => apiError(403, "FORBIDDEN", "Only this club's staff can do that")));
    const user = userEvent.setup();
    renderDesk();

    await user.click(await screen.findByTestId("confirm-payment-r1"));

    expect(await screen.findByText("Only this club's staff can do that")).toBeInTheDocument();
  });

  it("shows each registration once on a phone, so its test id and Confirm button are not doubled", async () => {
    phoneLayout();
    mockDesk();
    renderDesk();

    expect(await screen.findAllByTestId("registration-r1")).toHaveLength(1);
    expect(screen.getAllByTestId("confirm-payment-r1")).toHaveLength(1);
    expect(screen.getAllByTestId("confirmed-registration-r3")).toHaveLength(1);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("says when nobody is waiting or has paid yet", async () => {
    mockDesk({ pending: [], confirmed: [] });
    renderDesk();

    expect(await screen.findByText("No pending registrations")).toBeInTheDocument();
    expect(screen.getByText("No confirmed players yet")).toBeInTheDocument();
    expect(screen.queryByText("Total Pending")).not.toBeInTheDocument();
  });

  it("tells someone who does not run the club so, without asking for the staff lists", async () => {
    const lists = mockDesk({ canManage: false });
    renderDesk();

    expect(await screen.findByRole("heading", { name: "Access Denied" })).toBeInTheDocument();
    expect(lists).toEqual([]);
  });

  it("says when the tournament does not exist", async () => {
    server.use(http.get("/api/tournaments/t1", () => apiError(404, "NOT_FOUND", "Tournament not found")));
    renderDesk();

    expect(await screen.findByRole("heading", { name: "Tournament not found" })).toBeInTheDocument();
  });

  it("frames its loading, error and not-found states in the page's own inset, as every staff page does (P3REV5-CQ-04)", async () => {
    server.use(http.get("/api/tournaments/t1", () => apiError(503, "SERVICE_UNAVAILABLE", "The server is busy right now")));
    renderDesk();

    const alert = await screen.findByRole("alert");
    expect(alert.parentElement).toHaveClass("px-4", "py-6");
  });

  it("says only LiveStatus's word on how current it is, as the request desk does: no 'updates automatically' line beside it (P3REV5-CQ-17)", async () => {
    mockDesk();
    renderDesk();

    await screen.findByRole("table", { name: "Registrations waiting for payment" });
    expect(screen.queryByText(/updates automatically/)).not.toBeInTheDocument();
  });
});
