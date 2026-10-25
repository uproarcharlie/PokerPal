/**
 * The shared controls TDs tap on a phone are 40 px or more (phase3-conventions §3.11, MA-08), the close
 * button 44 px (round 5). Each one's drawn size on the TD's phone page is measured in a browser by
 * test/e2e/touch-targets.spec.ts (R5REV3-CQ-14).
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PageHeader } from "@/components/shared/page-header";
import { Checkbox } from "./checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "./sheet";

describe("touch targets", () => {
  it("gives a dialog's and a sheet's close button a 44 px box", () => {
    render(
      <>
        <Dialog open>
          <DialogContent>
            <DialogTitle>Edit</DialogTitle>
            <DialogDescription>Change it</DialogDescription>
          </DialogContent>
        </Dialog>
        <Sheet open>
          <SheetContent>
            <SheetTitle>Register Player</SheetTitle>
            <SheetDescription>Find the player</SheetDescription>
          </SheetContent>
        </Sheet>
      </>,
    );

    for (const close of screen.getAllByRole("button", { name: "Close", hidden: true })) expect(close).toHaveClass("h-11", "w-11");
  });

  it("makes each menu item 40 px tall on a phone", async () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>More</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Edit</DropdownMenuItem>
          <DropdownMenuItem>Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    await userEvent.click(screen.getByRole("button", { name: "More" }));

    for (const item of await screen.findAllByRole("menuitem")) expect(item).toHaveClass("min-h-10");
  });

  it("makes each choice in a select menu 40 px tall on a phone (P3REV-MA-SHARED-TARGETS)", async () => {
    render(
      <Select>
        <SelectTrigger aria-label="Season">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="s1">Spring</SelectItem>
          <SelectItem value="s2">Summer</SelectItem>
        </SelectContent>
      </Select>,
    );

    await userEvent.click(screen.getByRole("combobox", { name: "Season" }));

    for (const option of await screen.findAllByRole("option")) expect(option).toHaveClass("min-h-10", "md:min-h-0");
  });

  it("takes a tap 12 px around a checkbox, a 40 px target", () => {
    render(<Checkbox aria-label="Track Player Points" />);

    expect(screen.getByRole("checkbox", { name: "Track Player Points" })).toHaveClass("h-4", "w-4", "relative", "after:absolute", "after:-inset-3");
  });

  it("makes a page's back link 40 px tall on a phone", () => {
    render(<PageHeader title="Players" back={{ href: "/dashboard", label: "Dashboard" }} />);

    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveClass("min-h-10", "md:min-h-0");
  });
});
