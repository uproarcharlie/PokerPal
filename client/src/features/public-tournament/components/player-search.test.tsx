import { useState } from "react";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicPlayer } from "@shared/api/public";
import { server } from "@test/msw/server";
import { apiError, mockSignedOut, renderWithApp } from "@test/helpers/web";
import { PlayerSearch, type PlayerSearchWording } from "./player-search";

const ann = { id: "p1", name: "Ann Ngata", imageUrl: "/uploads/player_avatar/0b9f6a6e-1d2c-4c39-9a4e-2f6f5e0c1a11/512.webp" };

beforeEach(() => {
  mockSignedOut();
});

describe("PlayerSearch", () => {
  it("lists the matching players with their photos, and marks the one chosen", async () => {
    server.use(http.get("/api/public/tournaments/t1/players", () => HttpResponse.json([ann])));
    const onSelect = vi.fn();
    function Chooser() {
      const [selected, setSelected] = useState<PublicPlayer | null>(null);
      return (
        <PlayerSearch
          tournamentId="t1"
          selected={selected}
          onSelect={(player) => {
            onSelect(player);
            setSelected(player);
          }}
        />
      );
    }
    const user = userEvent.setup();
    renderWithApp(<Chooser />);

    await user.type(screen.getByRole("searchbox", { name: "Search for your name" }), "Ann");
    const option = await screen.findByRole("button", { name: "Ann Ngata" });
    expect(option).toHaveAttribute("aria-pressed", "false");
    expect(option.querySelector("img")).toHaveAttribute("src", ann.imageUrl);
    await user.click(option);

    expect(onSelect).toHaveBeenCalledWith(ann);
    expect(screen.getByRole("button", { name: "Ann Ngata" })).toHaveAttribute("aria-pressed", "true");
  });

  it("speaks the TD's words at the desk", async () => {
    const wording: PlayerSearchWording = { placeholder: "Player name", label: "Find a player", tooShort: "Type two letters.", noMatch: "Nobody by that name." };
    server.use(http.get("/api/public/tournaments/t1/players", () => HttpResponse.json([])));
    const user = userEvent.setup();
    renderWithApp(<PlayerSearch tournamentId="t1" selected={null} onSelect={() => {}} wording={wording} />);

    expect(screen.getByText("Type two letters.")).toBeInTheDocument();
    await user.type(screen.getByRole("searchbox", { name: "Find a player" }), "Zed");
    expect(await screen.findByText("Nobody by that name.")).toBeInTheDocument();
  });

  it("shows the server's reason when the search fails", async () => {
    server.use(http.get("/api/public/tournaments/t1/players", () => apiError(429, "RATE_LIMITED", "Too many requests, please try again later.")));
    const user = userEvent.setup();
    renderWithApp(<PlayerSearch tournamentId="t1" selected={null} onSelect={() => {}} />);

    await user.type(screen.getByRole("searchbox", { name: "Search for your name" }), "Ann");
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many requests, please try again later.");
  });

  it("keeps the last matches on screen, still tappable, while the next letters' answer comes (P3REV4-PERF-F)", async () => {
    const ana = { id: "p2", name: "Ana Tui", imageUrl: null };
    let answerNarrower: () => void = () => {};
    const narrowerAnswered = new Promise<void>((resolve) => {
      answerNarrower = resolve;
    });
    const asked: Array<string | null> = [];
    server.use(
      http.get("/api/public/tournaments/t1/players", async ({ request }) => {
        const q = new URL(request.url).searchParams.get("q");
        asked.push(q);
        if (q === "An") return HttpResponse.json([ann, ana]);
        await narrowerAnswered;
        return HttpResponse.json([ann]);
      }),
    );
    const onSelect = vi.fn();
    const user = userEvent.setup();
    renderWithApp(<PlayerSearch tournamentId="t1" selected={null} onSelect={onSelect} />);
    const box = screen.getByRole("searchbox", { name: "Search for your name" });

    await user.type(box, "An");
    expect(await screen.findByRole("button", { name: "Ana Tui" })).toBeInTheDocument();
    await user.type(box, "n");
    // The search for "Ann" has gone out (past the debounce) and has no answer yet (P3REV6-CQ-11).
    await waitFor(() => expect(asked).toContain("Ann"));

    // Asked for "Ann" and still waiting: the list stays, still tappable, and never says nobody matched.
    expect(screen.getByRole("button", { name: "Ana Tui" })).toBeInTheDocument();
    expect(screen.queryByTestId("player-search-empty")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Ann Ngata" }));
    expect(onSelect).toHaveBeenCalledWith(ann);
    answerNarrower();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Ana Tui" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Ann Ngata" })).toBeInTheDocument();
  });
});

