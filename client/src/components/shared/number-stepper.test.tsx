import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";
import { Form, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { FormNumberStepper, NumberStepper } from "./number-stepper";

function Minutes({ start = "20" }: { start?: string }) {
  const [value, setValue] = useState(start);
  return (
    <>
      <label htmlFor="minutes">Level length</label>
      <NumberStepper id="minutes" label="minutes per level" value={value} onChange={setValue} min={5} max={30} step={5} unit="min" />
    </>
  );
}

function Seats() {
  const form = useForm({ defaultValues: { seats: "9" } });
  return (
    <Form {...form}>
      <form>
        <FormField
          control={form.control}
          name="seats"
          rules={{ validate: (value) => Number(value) !== 7 || "Seven is unlucky" }}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Seats per table</FormLabel>
              <FormNumberStepper field={field} min={2} max={10} noun="seat" quickPicks={[6, 9]} testId="seats" />
              <FormMessage />
            </FormItem>
          )}
        />
        <button type="button" onClick={() => void form.trigger()}>
          Check
        </button>
      </form>
    </Form>
  );
}

describe("NumberStepper (one stepper for the clock and the seating: R5REV3-CQ-04)", () => {
  it("steps within its bounds, and stops at them", async () => {
    const user = userEvent.setup();
    render(<Minutes start="25" />);
    const box = screen.getByLabelText("Level length");
    expect(box).toHaveAttribute("inputmode", "numeric");
    await user.click(screen.getByRole("button", { name: "More minutes per level" }));
    expect(box).toHaveValue("30");
    expect(screen.getByRole("button", { name: "More minutes per level" })).toBeDisabled();
    await user.clear(box);
    await user.click(screen.getByRole("button", { name: "Fewer minutes per level" }));
    expect(box).toHaveValue("5");
    expect(screen.getByRole("button", { name: "Fewer minutes per level" })).toBeDisabled();
    expect(screen.getByText("min")).toBeInTheDocument();
  });

  it("drives a form field: labelled by its FormLabel, quick picks pressed, its error on the box", async () => {
    const user = userEvent.setup();
    render(<Seats />);
    const box = screen.getByLabelText("Seats per table");
    expect(box).toHaveAttribute("data-testid", "seats");
    expect(screen.getByRole("button", { name: "9 seats" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "6 seats" }));
    expect(box).toHaveValue("6");
    await user.click(screen.getByRole("button", { name: "More seats" }));
    expect(box).toHaveValue("7");
    await user.click(screen.getByRole("button", { name: "Check" }));
    expect(await screen.findByText("Seven is unlucky")).toBeInTheDocument();
    expect(box).toHaveAttribute("aria-invalid", "true");
  });
});
