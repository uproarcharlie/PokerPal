import { describe, expect, it } from "vitest";
import { matchRoute, useRouter } from "wouter";
import { renderHook } from "@testing-library/react";
import { STAFF_INVITE_PATH } from "@shared/api/clubs";
import { absoluteUrl, paths, routes } from "./routes";

describe("routes", () => {
  it("build links that the matching path pattern accepts", () => {
    const { result } = renderHook(() => useRouter());
    const parser = result.current.parser;
    const pairs: Array<[string, string]> = [
      [paths.tournamentAdmin, routes.tournamentAdmin("t1")],
      [paths.adminRegistrations, routes.adminRegistrations("t1")],
      [paths.adminActions, routes.adminActions("t1")],
      [paths.publicRegister, routes.publicRegister("t1")],
      [paths.publicTournament, routes.publicTournament("t1")],
      [paths.publicClub, routes.publicClub("central-stars")],
      [paths.tournamentQr, routes.tournamentQr("t1")],
      [paths.playerActions, routes.playerActions("t1")],
      [paths.clockDisplay, routes.clockDisplay("t1")],
      [paths.publicSeats, routes.publicSeats("t1")],
      [paths.publicSeason, routes.publicSeason("s1")],
      [paths.clubDetails, routes.clubDetails("c1")],
      [paths.clubSettings, routes.clubSettings("c1")],
      [paths.seasonSettings, routes.seasonSettings("s1")],
    ];
    for (const [pattern, link] of pairs) expect(matchRoute(parser, pattern, link)[0]).toBe(true);
  });

  it("keep the URLs that QR codes and bookmarks already use", () => {
    expect(routes.publicRegister("t1")).toBe("/register/t1");
    expect(routes.tournamentQr("t1")).toBe("/qr/t1");
    expect(routes.publicTournament("t1")).toBe("/tournament/t1");
    expect(routes.publicClub("central-stars")).toBe("/club/central-stars");
    expect(routes.playerActions("t1")).toBe("/tournaments/t1/actions");
    expect(routes.tournamentAdmin("t1")).toBe("/admin/tournaments/t1");
  });

  it("keep the TD's desk tab in the address, so a reload opens the same tab", () => {
    expect(routes.tournamentAdmin("t1", "clock")).toBe("/admin/tournaments/t1?tab=clock");
    expect(routes.tournamentAdmin("t1", undefined)).toBe("/admin/tournaments/t1");
  });

  it("serve the live screens where the TV clock's QR code and the seat finder links point", () => {
    expect(routes.clockDisplay("t1")).toBe("/clock/t1");
    expect(routes.clockDisplay("t1", "tv")).toBe("/clock/t1?screen=tv");
    expect(routes.publicSeats("t1")).toBe("/tournament/t1/seats");
    expect(routes.publicSeason("s1")).toBe("/season/s1");
    const { result } = renderHook(() => useRouter());
    // The tournament page's pattern does not swallow its seat finder.
    expect(matchRoute(result.current.parser, paths.publicTournament, routes.publicSeats("t1"))[0]).toBe(false);
  });

  it("encode ids and carry a sign-in's way back", () => {
    expect(routes.publicClub("a/b")).toBe("/club/a%2Fb");
    expect(routes.login("/staff-invite")).toBe("/login?next=%2Fstaff-invite");
    expect(routes.login()).toBe("/login");
    expect(routes.leaderboards("s 1")).toBe("/leaderboards?season=s%201");
    expect(routes.leaderboards()).toBe("/leaderboards");
    expect(absoluteUrl(routes.publicRegister("t1"))).toBe(`${window.location.origin}/register/t1`);
  });

  it("open a staff invitation where the invite links the club page hands out point", () => {
    expect(routes.staffInvite()).toBe(STAFF_INVITE_PATH);
  });
});
