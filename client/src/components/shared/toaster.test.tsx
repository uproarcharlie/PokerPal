import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast, useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { TOAST_DURATION_MS, Toaster } from "./toaster";

/** Radix starts listening for taps outside an open layer a tick after it opens. */
const layersListening = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

function notifications() {
  return within(screen.getByRole("region", { name: "Notifications" }));
}

afterEach(() => {
  act(() => {
    for (const item of screen.queryAllByRole("button", { name: "Dismiss notification" })) item.click();
  });
  vi.useRealTimers();
});

describe("Toaster", () => {
  it("shows a toast in a polite live region, and a failure in an assertive one", () => {
    render(<Toaster />);

    act(() => void toast({ title: "Season created successfully!", description: "Summer League is ready" }));
    const saved = notifications().getByRole("listitem");
    expect(saved).toHaveTextContent("Season created successfully!Summer League is ready");
    expect(saved.parentElement).toHaveAttribute("aria-live", "polite");

    act(() => void toast({ title: "Error", description: "Could not save", variant: "destructive" }));
    const failed = notifications().getByRole("listitem");
    expect(failed).toHaveTextContent("Could not save");
    expect(failed.parentElement).toHaveAttribute("aria-live", "assertive");
  });

  it("offers the next step a toast names, and closes once it is taken", async () => {
    render(<Toaster />);
    const seatNow = vi.fn();
    act(() => void toast({ title: "Player registered", description: "Ann is in, waiting for a seat.", action: { label: "Seat now", onClick: seatNow } }));
    await userEvent.click(notifications().getByRole("button", { name: "Seat now" }));
    expect(seatNow).toHaveBeenCalledOnce();
    expect(notifications().queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("closes from its labelled button", async () => {
    render(<Toaster />);
    act(() => void toast({ title: "Payment confirmed" }));

    await userEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));

    expect(notifications().queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("goes by itself after a few seconds, but waits while the pointer is on it", () => {
    vi.useFakeTimers();
    render(<Toaster />);

    act(() => void toast({ title: "First" }));
    act(() => void vi.advanceTimersByTime(TOAST_DURATION_MS - 1));
    expect(notifications().getByRole("listitem")).toHaveTextContent("First");
    act(() => void vi.advanceTimersByTime(1));
    expect(notifications().queryByRole("listitem")).not.toBeInTheDocument();

    act(() => void toast({ title: "Second" }));
    act(() => void vi.advanceTimersByTime(1000));
    fireEvent.pointerEnter(notifications().getByRole("listitem"));
    act(() => void vi.advanceTimersByTime(TOAST_DURATION_MS * 3));
    expect(notifications().getByRole("listitem")).toHaveTextContent("Second");

    // The time it had left when the pointer arrived, not a fresh start.
    fireEvent.pointerLeave(notifications().getByRole("listitem"));
    act(() => void vi.advanceTimersByTime(TOAST_DURATION_MS - 1000));
    expect(notifications().queryByRole("listitem")).not.toBeInTheDocument();
  });

  it.each(["mouse", "touch"] as const)("leaves an open sheet open when a toast over it is dismissed by %s (MA-03)", async (pointerType) => {
    const closedSheet = vi.fn();
    render(
      <>
        <Sheet open onOpenChange={closedSheet}>
          <SheetContent>
            <SheetTitle>Register Player</SheetTitle>
            <SheetDescription>Find the player</SheetDescription>
          </SheetContent>
        </Sheet>
        <Toaster />
      </>,
    );
    act(() => void toast({ title: "Error", description: "Could not register", variant: "destructive" }));
    const dismiss = screen.getByRole("button", { name: "Dismiss notification" });
    await layersListening();

    fireEvent.pointerDown(dismiss, { pointerType, button: 0 });
    fireEvent.pointerUp(dismiss, { pointerType, button: 0 });
    fireEvent.click(dismiss);

    expect(closedSheet).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Register Player" })).toBeInTheDocument();
    expect(notifications().queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("still lets a tap outside a dialog, anywhere but on a toast, close it", async () => {
    const closed = vi.fn();
    render(
      <>
        <button type="button">Behind</button>
        <Dialog open onOpenChange={closed}>
          <DialogContent>
            <DialogTitle>Edit</DialogTitle>
            <DialogDescription>Change it</DialogDescription>
          </DialogContent>
        </Dialog>
        <Toaster />
      </>,
    );

    await layersListening();
    fireEvent.pointerDown(screen.getByText("Behind"), { pointerType: "mouse", button: 0 });

    expect(closed).toHaveBeenCalledWith(false);
  });

  it("sits at the foot of a phone's screen, clear of the staff header's menu, with a 40 px dismiss (MA-P3REV1-05)", () => {
    render(<Toaster />);
    act(() => void toast({ title: "Link Copied!" }));

    const region = screen.getByRole("region", { name: "Notifications" });
    expect(region).toHaveClass("bottom-0");
    expect(region).not.toHaveClass("top-0");
    expect(screen.getByRole("button", { name: "Dismiss notification" })).toHaveClass("h-10", "w-10");
  });

  it("does not re-render the components that only raise toasts (P3REV5-CQ-10)", () => {
    let renders = 0;
    function Raiser() {
      renders += 1;
      useToast();
      return null;
    }
    render(
      <>
        <Raiser />
        <Toaster />
      </>,
    );
    const before = renders;

    act(() => void toast({ title: "Payment Confirmed" }));
    act(() => screen.getByRole("button", { name: "Dismiss notification" }).click());

    expect(renders).toBe(before);
  });
});
