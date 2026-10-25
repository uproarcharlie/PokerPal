import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { RakeLabelInput } from "./rake-label-input";

function Controlled({ initial = "", disabled = false }: { initial?: string; disabled?: boolean }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <Label htmlFor="rake-label">House take</Label>
      <RakeLabelInput id="rake-label" value={value} onChange={setValue} disabled={disabled} />
      <output data-testid="value">{value}</output>
    </>
  );
}

/** As club settings will hold it: a FormField with a description, and an error set by the form. */
function InSettingsForm() {
  const form = useForm<{ rakeLabel: string }>({ defaultValues: { rakeLabel: "AP" } });
  return (
    <Form {...form}>
      <form>
        <FormField
          control={form.control}
          name="rakeLabel"
          render={({ field }) => (
            <FormItem>
              <FormLabel>What the club calls its rake</FormLabel>
              <FormControl>
                <RakeLabelInput {...field} />
              </FormControl>
              <FormDescription>Every tournament shows it.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <button type="button" onClick={() => form.setError("rakeLabel", { message: "Must be 16 characters or fewer" })}>
          Refuse
        </button>
      </form>
    </Form>
  );
}

describe("RakeLabelInput", () => {
  it("fills in Rake, AP or Admin fee in one tap, and says which one is chosen", async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const chips = screen.getByRole("group", { name: "Common names" });
    expect(chips).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "AP" }));
    expect(screen.getByTestId("value")).toHaveTextContent("AP");
    expect(screen.getByRole("textbox", { name: "House take" })).toHaveValue("AP");
    expect(screen.getByRole("button", { name: "AP" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Rake" })).toHaveAttribute("aria-pressed", "false");

    await user.click(screen.getByRole("button", { name: "Admin fee" }));
    expect(screen.getByTestId("value")).toHaveTextContent("Admin fee");
  });

  it("takes a name of its own, up to 16 characters, and says where it shows", async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const box = screen.getByRole("textbox", { name: "House take" });
    await user.type(box, "Tournament fee and more");

    expect(box).toHaveValue("Tournament fee a");
    expect(box).toHaveAttribute("maxlength", "16");
    expect(box).toHaveAccessibleDescription(/Shown wherever the house take appears, e\.g\. AP/);
    expect(screen.getByRole("button", { name: "AP" })).toHaveAttribute("aria-pressed", "false");
  });

  it("takes the field's label, description and error inside a form", async () => {
    const user = userEvent.setup();
    render(<InSettingsForm />);
    const box = screen.getByRole("textbox", { name: "What the club calls its rake" });
    expect(box).toHaveValue("AP");
    expect(box).toHaveAccessibleDescription(/Shown wherever the house take appears.*Every tournament shows it\./);

    await user.click(screen.getByRole("button", { name: "Refuse" }));
    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(box).toHaveAccessibleDescription(/Must be 16 characters or fewer/);
  });

  it("can be shown but not changed", () => {
    render(<Controlled initial="AP" disabled />);
    expect(screen.getByRole("textbox", { name: "House take" })).toBeDisabled();
    for (const chip of screen.getAllByRole("button")) expect(chip).toBeDisabled();
  });
});
