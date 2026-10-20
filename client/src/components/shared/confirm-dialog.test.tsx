import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/http";
import { ConfirmDialog, sameWords } from "./confirm-dialog";

function Harness({ onConfirm, confirmText }: { onConfirm: () => Promise<unknown>; confirmText?: string }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <p>{open ? "open" : "closed"}</p>
      <button onClick={() => setOpen(true)}>Reopen</button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete Friday Freezeout?"
        description="Its registrations and results go with it."
        confirmLabel="Delete tournament"
        pendingLabel="Deleting…"
        destructive
        confirmText={confirmText}
        contentTestId="confirm-delete"
        confirmTestId="confirm-delete-action"
        onConfirm={onConfirm}
      />
    </>
  );
}

describe("ConfirmDialog", () => {
  it("waits for the action, then closes", async () => {
    let finish: () => void = () => {};
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    render(<Harness onConfirm={onConfirm} />);

    await userEvent.click(screen.getByRole("button", { name: "Delete tournament" }));

    // Busy, not disabled: pressing again does nothing, and the button keeps focus (MA-REV-02).
    const running = screen.getByRole("button", { name: "Deleting…" });
    expect(running).toHaveAttribute("aria-disabled", "true");
    expect(running).toHaveFocus();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(running);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("open")).toBeInTheDocument();
    finish();
    await waitFor(() => expect(screen.getByText("closed")).toBeInTheDocument());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("leaves focus on the confirm button when the action is refused, so the person keeps their place (MA-REV-02)", async () => {
    let refuse: (error: Error) => void = () => {};
    const onConfirm = vi.fn(() => new Promise<void>((_, reject) => (refuse = reject)));
    const user = userEvent.setup();
    render(<Harness onConfirm={onConfirm} />);

    await user.click(screen.getByRole("button", { name: "Delete tournament" }));
    expect(screen.getByRole("button", { name: "Deleting…" })).toHaveFocus();
    refuse(new ApiError({ status: 409, error: "Finish the tournament first" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Finish the tournament first");
    expect(screen.getByRole("button", { name: "Delete tournament" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Delete tournament" })).not.toHaveAttribute("aria-disabled");
  });

  it("stays open with the server's reason when the action fails, so it can be retried", async () => {
    const onConfirm = vi.fn().mockRejectedValueOnce(new ApiError({ status: 403, error: "Only the club's owner or an admin can do that" }));
    render(<Harness onConfirm={onConfirm} />);

    await userEvent.click(screen.getByRole("button", { name: "Delete tournament" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Only the club's owner or an admin can do that");
    expect(screen.getByText("open")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete tournament" })).toBeEnabled();
  });

  it("closes on Cancel without running the action", async () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByText("closed")).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("passes its test ids through to the dialog and its confirm button", () => {
    render(<Harness onConfirm={vi.fn()} />);

    expect(screen.getByTestId("confirm-delete")).toHaveTextContent("Delete Friday Freezeout?");
    expect(screen.getByTestId("confirm-delete-action")).toHaveTextContent("Delete tournament");
  });

  it("with confirmText, keeps the confirm button off until those words are typed (CA-33)", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<Harness onConfirm={onConfirm} confirmText="Central Stars" />);

    const confirm = screen.getByRole("button", { name: "Delete tournament" });
    const typed = screen.getByLabelText("Type Central Stars to confirm");
    expect(confirm).toBeDisabled();
    await user.type(typed, "Central");
    expect(confirm).toBeDisabled();
    await user.type(typed, " Stars");
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() => expect(screen.getByText("closed")).toBeInTheDocument());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("accepts the words as an iPhone types them: curly apostrophes, any case (MA-11)", async () => {
    const user = userEvent.setup();
    render(<Harness onConfirm={vi.fn().mockResolvedValue(undefined)} confirmText="O'Malley's" />);

    const typed = screen.getByLabelText("Type O'Malley's to confirm");
    expect(typed).toHaveAttribute("autocapitalize", "none");
    expect(typed).toHaveAttribute("autocorrect", "off");
    expect(typed).toHaveAttribute("spellcheck", "false");
    await user.type(typed, "o\u2019malley\u2019s ");

    expect(screen.getByRole("button", { name: "Delete tournament" })).toBeEnabled();
  });

  it("still needs the same words, not just similar ones", () => {
    expect(sameWords("O\u2019Malley\u2019s", "O'Malley's")).toBe(true);
    expect(sameWords("  central   STARS ", "Central Stars")).toBe(true);
    expect(sameWords("Central Star", "Central Stars")).toBe(false);
    expect(sameWords("OMalleys", "O'Malley's")).toBe(false);
  });

  it("opens again without the last refusal or the words typed before", async () => {
    const onConfirm = vi.fn().mockRejectedValueOnce(new ApiError({ status: 409, error: "It has tournaments" }));
    const user = userEvent.setup();
    render(<Harness onConfirm={onConfirm} confirmText="Central Stars" />);

    await user.type(screen.getByLabelText("Type Central Stars to confirm"), "Central Stars");
    await user.click(screen.getByRole("button", { name: "Delete tournament" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("It has tournaments");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("closed")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reopen" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Type Central Stars to confirm")).toHaveValue("");
  });
});
