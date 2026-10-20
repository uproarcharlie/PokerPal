import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TOURNAMENT_STATUSES } from "@shared/domain/tournaments";
import { StatusBadge, TOURNAMENT_STATUS_LABELS, tournamentStatusLabel } from "./status-badge";

describe("StatusBadge", () => {
  it("names every status, cancelled included", () => {
    for (const status of TOURNAMENT_STATUSES) expect(TOURNAMENT_STATUS_LABELS[status]).toBeTruthy();
    expect(tournamentStatusLabel("cancelled")).toBe("Cancelled");
    expect(tournamentStatusLabel("registration")).toBe("Registration Open");
    expect(tournamentStatusLabel("legacy_status")).toBe("legacy_status");
  });

  it("draws with the theme's status colours, and a label of the page's choosing", () => {
    render(
      <>
        <StatusBadge status="cancelled" />
        <StatusBadge status="in_progress" label="Live" />
      </>,
    );

    expect(screen.getByText("Cancelled")).toHaveClass("bg-status-cancelled", "text-status-cancelled-foreground");
    expect(screen.getByText("Live")).toHaveClass("bg-status-live");
  });
});
