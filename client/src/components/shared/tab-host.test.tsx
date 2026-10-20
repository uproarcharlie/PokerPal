import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { TabHost, type HostedTab } from "./tab-host";

const tabs = (extra: HostedTab[] = []): HostedTab[] => [
  { value: "profile", label: "Profile", keepMounted: true, content: <input aria-label="Name" /> },
  { value: "feed", label: "Activity", content: <p>The feed</p> },
  ...extra,
];

describe("TabHost (P3REV2-CQ-14)", () => {
  it("keeps a kept tab's half-made edit while another shows, and takes the others out of the page", async () => {
    const user = userEvent.setup();
    render(<TabHost tabs={tabs()} />);

    await user.type(screen.getByRole("textbox", { name: "Name" }), "Central");
    expect(screen.queryByText("The feed")).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Activity" }));

    expect(screen.getByText("The feed")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Name" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Profile" }));
    expect(screen.queryByText("The feed")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Central");
  });

  it("shows the first tab when the one chosen is no longer offered", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<TabHost tabs={tabs([{ value: "managers", label: "Managers", content: <p>The managers</p> }])} />);
    await user.click(screen.getByRole("tab", { name: "Managers" }));

    rerender(<TabHost tabs={tabs()} />);

    expect(screen.getByRole("tab", { name: "Profile" })).toHaveAttribute("aria-selected", "true");
  });

  it("follows a page that keeps the choice itself, with a badge in a tab's name (P3REV5-CQ-03)", async () => {
    const user = userEvent.setup();
    const chosen: string[] = [];
    const { rerender } = render(
      <TabHost
        value="feed"
        onValueChange={(value) => chosen.push(value)}
        tabs={tabs([{ value: "season", label: <>Summer <span>Active</span></>, content: <p>The season</p> }])}
      />,
    );
    expect(screen.getByText("The feed")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Summer Active" }));
    expect(chosen.at(-1)).toBe("season");
    rerender(<TabHost value="season" tabs={tabs([{ value: "season", label: "Summer", content: <p>The season</p> }])} />);
    expect(screen.getByText("The season")).toBeInTheDocument();
  });
});

