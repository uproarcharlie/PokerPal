import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@test/msw/server";
import { clubDto, mockTournamentPages, tournamentDto } from "@test/helpers/f2-public";
import { apiError, mockSignedOut, renderWithApp } from "@test/helpers/web";
import TournamentQrPage from "./tournament-qr";

function renderPage() {
  return renderWithApp(<TournamentQrPage />, { path: "/qr/t1", route: "/qr/:tournamentId" });
}

const registerUrl = () => `${window.location.origin}/register/t1`;

beforeEach(() => {
  mockSignedOut();
});

afterEach(() => {
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("TournamentQrPage", () => {
  it("shows a QR code of the sign-up link, sized to fit the screen (PUB-31)", async () => {
    mockTournamentPages(tournamentDto());
    renderPage();

    const code = await screen.findByRole("img", { name: "Scan to register for Friday Freezeout" });
    expect(code).toHaveStyle({ width: "100%" });
    expect(screen.getByText(registerUrl())).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Friday Freezeout" })).toBeInTheDocument();
    expect(document.title).toBe("QR code: Friday Freezeout | LovePoker.club");
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute("content", "noindex");
  });

  it("dates the tournament in the club's time zone, never the US format", async () => {
    mockTournamentPages(tournamentDto(), [], clubDto({ timezone: "Pacific/Auckland" }));
    renderPage();

    expect(await screen.findByText("Fri, 23 Oct 2026")).toBeInTheDocument();
    expect(screen.queryByText(/October 23, 2026/)).not.toBeInTheDocument();
  });

  it("shows the buy-in and, when there is one, the high-hand entry fee (PUB-13)", async () => {
    mockTournamentPages(tournamentDto({ buyInAmount: "40.00", enableHighHand: true, highHandAmount: "10.00" }));
    renderPage();

    expect(await screen.findByText("$40.00")).toBeInTheDocument();
    expect(screen.getByText("High hand entry")).toBeInTheDocument();
    expect(screen.getByText("$10.00")).toBeInTheDocument();
  });

  it("advertises no high hand switched on without a price (P3REV3-CQ-03)", async () => {
    mockTournamentPages(tournamentDto({ buyInAmount: "40.00", enableHighHand: true, highHandAmount: "0.00" }));
    renderPage();

    expect(await screen.findByText("$40.00")).toBeInTheDocument();
    expect(screen.queryByText("High hand entry")).not.toBeInTheDocument();
  });

  it("copies the sign-up link, and says so only when it worked", async () => {
    mockTournamentPages(tournamentDto());
    const writeText = vi.fn(() => Promise.resolve());
    const user = userEvent.setup();
    // After setup(), which puts its own clipboard on navigator.
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Copy link" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(registerUrl()));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("says the tournament is not found for a 404", async () => {
    server.use(http.get("/api/tournaments/t1", () => apiError(404, "NOT_FOUND", "Tournament not found")));
    renderPage();

    expect(await screen.findByRole("heading", { name: "Tournament not found" })).toBeInTheDocument();
  });
});
