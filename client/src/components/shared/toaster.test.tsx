import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast, useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { PhoneSheet, PhoneSheetBody, PhoneSheetFooter, PhoneSheetHeader } from "./phone-sheet";
import { TOAST_DURATION_MS, Toaster } from "./toaster";

/** Radix starts listening for taps outside an open layer a tick after it opens. */
const layersListening = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

function notifications() {
  return within(screen.getByRole("region", { name: "Notifications" }));
}

/** After the next frame, when the toaster measures where it stands. */
const nextFrame = () => act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

interface Box {
  top: number;
  bottom: number;
  left?: number;
  right?: number;
}

/**
 * A 390 × 844 phone's layout, which jsdom does not do: each element's box (others have none), and the
 * one Tailwind rule the toaster reads, a sheet body's overflow-y-auto.
 */
function phoneLayout(boxes: Map<Element, Box>) {
  const height = window.innerHeight;
  window.innerHeight = 844;
  const styles = document.head.appendChild(document.createElement("style"));
  styles.textContent = ".overflow-y-auto { overflow-y: auto; }";
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const { top, bottom, left = 0, right = 390 } = boxes.get(this) ?? { top: 0, bottom: 0, left: 0, right: 0 };
    return new DOMRect(left, top, right - left, bottom - top);
  });
  return () => {
    window.innerHeight = height;
    styles.remove();
  };
}

/** The toaster's region, 100 px of toasts at the foot of the screen, full width. */
function toastsBox(boxes: Map<Element, Box>) {
  const region = screen.getByRole("region", { name: "Notifications" });
  boxes.set(region, { top: 744, bottom: 844 });
  return region;
}

/** An open phone sheet's parts, as PhoneSheet draws them: heading, content, then any footer, and the close button. */
function sheetParts(boxes: Map<Element, Box>, { footer }: { footer: boolean }) {
  const [heading, content, ...rest] = Array.from(screen.getByRole("dialog").children);
  boxes.set(screen.getByRole("dialog"), { top: 0, bottom: 844 });
  boxes.set(heading, { top: 0, bottom: 80 });
  boxes.set(content, { top: 80, bottom: footer ? 772 : 844 });
  if (footer) boxes.set(rest[0], { top: 772, bottom: 844 });
  boxes.set(rest[rest.length - 1], { top: 8, bottom: 52, left: 338, right: 382 });
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
    const failed = notifications().getByText("Could not save").closest("li");
    expect(failed?.parentElement).toHaveAttribute("aria-live", "assertive");
  });

  it("stacks up to three, and never lets news push out a toast that offers a next step (R5REV-HOST-08)", () => {
    render(<Toaster />);
    const undo = vi.fn();
    act(() => void toast({ title: "Player busted", description: "Ann is out.", action: { label: "Undo", onClick: undo } }));
    act(() => void toast({ title: "Player seated", description: "Bob seated at Table 1, Seat 2." }));
    act(() => void toast({ title: "Player seated", description: "Cat seated at Table 2, Seat 4." }));
    expect(notifications().getAllByRole("listitem")).toHaveLength(3);

    // A fourth: the oldest news goes, not the older Undo.
    act(() => void toast({ title: "Player seated", description: "Dan seated at Table 1, Seat 5." }));
    const shown = notifications().getAllByRole("listitem");
    expect(shown.map((item) => item.textContent)).toEqual([
      expect.stringContaining("Dan"),
      expect.stringContaining("Cat"),
      expect.stringContaining("Ann is out."),
    ]);
    expect(notifications().getByRole("button", { name: "Undo" })).toBeInTheDocument();

    // With every toast offering a step, news waits its turn rather than push one out...
    act(() => void toast({ title: "Re-buy recorded", action: { label: "Seat now", onClick: vi.fn() } }));
    act(() => void toast({ title: "Elimination undone", action: { label: "Seat now", onClick: vi.fn() } }));
    act(() => void toast({ title: "Player seated", description: "Eve seated at Table 2, Seat 1." }));
    const titles = () => notifications().getAllByRole("listitem").map((item) => item.querySelector("p")?.textContent);
    expect(titles()).toEqual(["Elimination undone", "Re-buy recorded", "Player busted"]);
    // ...and only another next step replaces the oldest of them.
    act(() => void toast({ title: "Add-on recorded", action: { label: "Seat now", onClick: vi.fn() } }));
    expect(titles()).toEqual(["Add-on recorded", "Elimination undone", "Re-buy recorded"]);
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

  describe("over an open dialog or sheet (round 6, B3)", () => {
    let restore: (() => void) | undefined;
    afterEach(() => {
      restore?.();
      restore = undefined;
      vi.restoreAllMocks();
    });

    function SaveSheet({ open, footer = true }: { open: boolean; footer?: boolean }) {
      return (
        <>
          {/* The TD's tab bar, under the sheet. */}
          <div data-bottom-bar="" />
          <PhoneSheet
            open={open}
            onOpenChange={() => {}}
            title="Seating settings"
            footer={footer ? <Button type="button">Save</Button> : undefined}
          >
            <p>Seats per table</p>
          </PhoneSheet>
          <Toaster />
        </>
      );
    }

    it("rises above a phone sheet's footer, so a refusal never hides its Save, and goes back once the sheet closes", async () => {
      const boxes = new Map<Element, Box>();
      const { rerender } = render(<SaveSheet open />);
      restore = phoneLayout(boxes);
      sheetParts(boxes, { footer: true });
      const region = toastsBox(boxes);

      act(() => void toast({ title: "Could not save the seating", description: "Try again.", variant: "destructive" }));
      await nextFrame();

      // The footer starts 72 px above the foot of the screen.
      expect(region.style.bottom).toBe("72px");
      expect(region).toHaveClass("pb-4");
      // The sheet's body ends above the toasts' 100 px, so none of its rows is under one (R6REV1-PHONE-03).
      expect(screen.getByRole("dialog").style.getPropertyValue("--toast-clearance")).toBe("100px");
      expect(screen.getByText("Seats per table").parentElement).toHaveClass("mb-[var(--toast-clearance,0px)]", "overflow-y-auto");

      rerender(<SaveSheet open={false} />);
      await nextFrame();
      expect(region.style.bottom).toBe("");
      expect(region).not.toHaveClass("pb-4");
    });

    it("finds a phone sheet's footer by its mark, however deep a step's form wraps it", async () => {
      const boxes = new Map<Element, Box>();
      render(
        <>
          <PhoneSheet open onOpenChange={() => {}}>
            <form data-testid="step">
              <div data-testid="step-inner">
                <div data-testid="step-content">
                  <PhoneSheetHeader title="Take payment" />
                  <PhoneSheetBody>
                    <p>Aroha owes $40</p>
                  </PhoneSheetBody>
                  <PhoneSheetFooter>
                    <Button type="submit">Confirm payment</Button>
                  </PhoneSheetFooter>
                </div>
              </div>
            </form>
          </PhoneSheet>
          <Toaster />
        </>,
      );
      restore = phoneLayout(boxes);
      // Every wrapper spans the whole sheet, deeper than the layout search goes; only the mark finds the footer.
      for (const element of [screen.getByRole("dialog"), screen.getByTestId("step"), screen.getByTestId("step-inner"), screen.getByTestId("step-content")]) {
        boxes.set(element, { top: 0, bottom: 844 });
      }
      const footer = screen.getByRole("button", { name: "Confirm payment" }).parentElement!;
      expect(footer).toHaveAttribute("data-sheet-footer");
      boxes.set(footer, { top: 760, bottom: 844 });
      const region = toastsBox(boxes);

      act(() => void toast({ title: "Tournament full", description: "6 of 6 players accepted", variant: "destructive" }));
      await nextFrame();

      expect(region.style.bottom).toBe("84px");
    });

    it("goes to the foot of the screen over a sheet whose list scrolls to its foot, not up over the list to clear the hidden tab bar", async () => {
      const boxes = new Map<Element, Box>();
      render(<SaveSheet open footer={false} />);
      restore = phoneLayout(boxes);
      sheetParts(boxes, { footer: false });
      const region = toastsBox(boxes);

      act(() => void toast({ title: "Tournament full", description: "6 of 6 players accepted", variant: "destructive" }));
      await nextFrame();

      expect(region.style.bottom).toBe("0px");
      expect(region).not.toHaveClass("pb-4");
      // The list ends above the toasts, so its last rows can be scrolled clear of them.
      expect(screen.getByRole("dialog").style.getPropertyValue("--toast-clearance")).toBe("100px");
    });

    it("gives a sheet's body back its foot once the last toast goes (R6REV1-PHONE-03)", async () => {
      const boxes = new Map<Element, Box>();
      render(<SaveSheet open />);
      restore = phoneLayout(boxes);
      sheetParts(boxes, { footer: true });
      toastsBox(boxes);

      act(() => void toast({ title: "Payment Confirmed", description: "Hana has paid: $50 is in the prize pool." }));
      await nextFrame();
      expect(screen.getByRole("dialog").style.getPropertyValue("--toast-clearance")).toBe("100px");

      act(() => screen.getByRole("button", { name: "Dismiss notification" }).click());
      expect(screen.getByRole("dialog").style.getPropertyValue("--toast-clearance")).toBe("");
    });

    it("stays at the foot under a centred dialog whose buttons are well above the toasts", async () => {
      const boxes = new Map<Element, Box>();
      render(
        <>
          <Dialog open>
            <DialogContent>
              <DialogTitle>Remove player</DialogTitle>
              <DialogDescription>They leave the waiting list.</DialogDescription>
              <DialogFooter>
                <Button type="button">Remove</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Toaster />
        </>,
      );
      restore = phoneLayout(boxes);
      boxes.set(screen.getByRole("dialog"), { top: 280, bottom: 464, left: 8, right: 382 });
      const [title, description, footer] = Array.from(screen.getByRole("dialog").children);
      boxes.set(title, { top: 300, bottom: 330, left: 16, right: 374 });
      boxes.set(description, { top: 340, bottom: 370, left: 16, right: 374 });
      boxes.set(footer, { top: 400, bottom: 444, left: 16, right: 374 });
      const region = toastsBox(boxes);

      act(() => void toast({ title: "Player removed" }));
      await nextFrame();

      expect(region.style.bottom).toBe("0px");
      // Nothing of the dialog is under them.
      expect(screen.getByRole("dialog").style.getPropertyValue("--toast-clearance")).toBe("0px");
    });

    it("is placed by its classes alone while nothing is open (above the TD's tab bar)", async () => {
      render(
        <>
          <div data-bottom-bar="" />
          <Toaster />
        </>,
      );

      act(() => void toast({ title: "Payment confirmed" }));
      await nextFrame();

      const region = screen.getByRole("region", { name: "Notifications" });
      expect(region.style.bottom).toBe("");
      expect(region.className).toContain("[:root:has([data-bottom-bar])_&]:bottom-[calc(7.5rem+env(safe-area-inset-bottom))]");
    });
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
