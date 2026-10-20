import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button";

describe("Button busy (MA-REV-02)", () => {
  it("says it is busy and ignores presses, but keeps focus, which disabled would drop to the page", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<Button onClick={onClick}>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });

    await user.click(button);
    rerender(
      <Button onClick={onClick} busy>
        Save
      </Button>,
    );

    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toBeEnabled();
    expect(button).toHaveFocus();
    await user.click(button);
    await user.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("submits nothing while busy, from a click or from Enter in a field", async () => {
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    const user = userEvent.setup();
    render(
      <form onSubmit={onSubmit}>
        <input aria-label="Name" />
        <Button type="submit" busy>
          Save
        </Button>
      </form>,
    );

    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Ann{Enter}");

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("is plain when not busy", () => {
    render(<Button>Save</Button>);

    expect(screen.getByRole("button", { name: "Save" })).not.toHaveAttribute("aria-disabled");
  });
});
