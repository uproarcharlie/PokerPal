import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "@test/msw/server";
import { mockSignedOut, renderWithApp } from "@test/helpers/web";
import PublicClubView from "./public-club-view";

const club = {
  id: "c1",
  name: "Central Stars",
  slug: "central-stars",
  description: null,
  imageUrl: null,
  address: null,
  discordUrl: "javascript:alert(document.cookie)",
  twitterUrl: "data:text/html,<script>alert(1)</script>",
  facebookUrl: "https://facebook.example/central-stars",
  instagramUrl: null,
  websiteUrl: "https://centralstars.example",
  rakeLabel: "AP",
  viewer: { canManage: false, canOwn: false },
};

beforeEach(() => {
  mockSignedOut();
  server.use(
    http.get("/api/clubs/slug/central-stars", () => HttpResponse.json(club)),
    http.get("/api/tournaments", () => HttpResponse.json([])),
    http.get("/api/seasons", () => HttpResponse.json([])),
  );
});

describe("PublicClubView social links (P2REV0-SEC-05)", () => {
  it("links only to http(s) addresses, whatever an older club row holds", async () => {
    renderWithApp(<PublicClubView />, { path: "/club/central-stars", route: "/club/:slug" });

    expect(await screen.findByTitle("Facebook")).toHaveAttribute("href", "https://facebook.example/central-stars");
    expect(screen.getByTitle("Website")).toHaveAttribute("href", "https://centralstars.example");
    expect(screen.queryByTitle("Discord")).toBeNull();
    expect(screen.queryByTitle("Twitter/X")).toBeNull();
    for (const link of screen.getAllByRole("link")) {
      expect(link.getAttribute("href") ?? "").not.toMatch(/^\s*(javascript|data):/i);
    }
  });
});
