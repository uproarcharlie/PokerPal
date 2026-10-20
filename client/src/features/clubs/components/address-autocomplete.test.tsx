import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AddressAutocomplete } from "./address-autocomplete";

/** A stand-in for google.maps.places.Autocomplete: records each one made and lets a test pick a place. */
class FakeAutocomplete {
  static made: FakeAutocomplete[] = [];
  listeners = new Map<string, () => void>();
  place: google.maps.places.PlaceResult = {};
  suggestions = document.createElement("div");

  constructor(
    readonly input: HTMLInputElement,
    readonly options: google.maps.places.AutocompleteOptions,
  ) {
    FakeAutocomplete.made.push(this);
    // Like Google's widget: its suggestion list goes at the end of the page.
    this.suggestions.className = "pac-container";
    this.suggestions.style.display = "none";
    document.body.appendChild(this.suggestions);
  }

  addListener(name: string, listener: () => void) {
    this.listeners.set(name, listener);
  }

  getPlace() {
    return this.place;
  }

  pick(place: google.maps.places.PlaceResult) {
    this.place = place;
    this.listeners.get("place_changed")?.();
  }
}

const maps = vi.hoisted(() => ({
  setOptions: vi.fn(),
  importLibrary: vi.fn(),
  clearInstanceListeners: vi.fn(),
}));

vi.mock("@googlemaps/js-api-loader", () => ({ setOptions: maps.setOptions, importLibrary: maps.importLibrary }));

function mapsLoad() {
  maps.importLibrary.mockImplementation(async (name: string) =>
    name === "places" ? { Autocomplete: FakeAutocomplete } : { event: { clearInstanceListeners: maps.clearInstanceListeners } },
  );
}

function Field({ initial = "", onChange = vi.fn() }: { initial?: string; onChange?: (address: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <form onSubmit={(event) => event.preventDefault()}>
      <label htmlFor="address">Address</label>
      <AddressAutocomplete
        id="address"
        value={value}
        onChange={(address) => {
          setValue(address);
          onChange(address);
        }}
      />
    </form>
  );
}

beforeEach(() => {
  FakeAutocomplete.made = [];
  maps.setOptions.mockReset();
  maps.importLibrary.mockReset();
  maps.clearInstanceListeners.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  document.querySelectorAll(".pac-container").forEach((list) => list.remove());
});

describe("AddressAutocomplete without Maps", () => {
  it("is a plain, controlled text input when the build has no Maps key", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Field onChange={onChange} />);

    await user.type(screen.getByLabelText("Address"), "57 Princes St");

    expect(screen.getByLabelText("Address")).toHaveValue("57 Princes St");
    expect(onChange).toHaveBeenLastCalledWith("57 Princes St");
    expect(maps.importLibrary).not.toHaveBeenCalled();
  });

  it("shows the value it is given, also when it changes after the field appeared (no seed-once copy)", () => {
    const { rerender } = render(<AddressAutocomplete aria-label="Address" value="" onChange={() => {}} />);

    rerender(<AddressAutocomplete aria-label="Address" value="Club 2020, 57 Princes St, Onehunga" onChange={() => {}} />);

    expect(screen.getByLabelText("Address")).toHaveValue("Club 2020, 57 Princes St, Onehunga");
  });

  it("takes the form's ref, so a refused address gets focus as any other field does (P3REV6-CQ-07)", async () => {
    function AddressForm({ onSave }: { onSave: () => void }) {
      const form = useForm({ defaultValues: { address: "" } });
      return (
        <form onSubmit={form.handleSubmit(onSave)}>
          <label htmlFor="address">Address</label>
          <Controller
            control={form.control}
            name="address"
            rules={{ maxLength: 10 }}
            render={({ field }) => <AddressAutocomplete id="address" {...field} />}
          />
          <button type="submit">Save</button>
        </form>
      );
    }
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<AddressForm onSave={onSave} />);

    await user.type(screen.getByLabelText("Address"), "57 Princes Street, Onehunga");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Address")).toHaveFocus();
  });

  it("stays a working input when Maps cannot load (offline, blocked by the page's CSP, a bad key)", async () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "test-key");
    maps.importLibrary.mockRejectedValue(new Error("The Google Maps JavaScript API could not load."));
    const user = userEvent.setup();
    render(<Field />);

    await waitFor(() => expect(maps.importLibrary).toHaveBeenCalledWith("places"));
    // Maps is set up with the build's key, once per page.
    expect(maps.setOptions).toHaveBeenCalledWith(expect.objectContaining({ key: "test-key" }));
    await user.type(screen.getByLabelText("Address"), "Onehunga");

    expect(screen.getByLabelText("Address")).toHaveValue("Onehunga");
  });
});

describe("AddressAutocomplete with Maps", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "test-key");
    mapsLoad();
  });

  it("adds one Autocomplete to the field however much is typed (CC-03: one was made per keystroke)", async () => {
    const user = userEvent.setup();
    render(<Field />);

    await waitFor(() => expect(FakeAutocomplete.made).toHaveLength(1));
    await user.type(screen.getByLabelText("Address"), "57 Princes Street");

    expect(FakeAutocomplete.made).toHaveLength(1);
    expect(FakeAutocomplete.made[0].input).toBe(screen.getByLabelText("Address"));
    expect(FakeAutocomplete.made[0].options.componentRestrictions).toEqual({ country: "nz" });
  });

  it("puts a picked suggestion's address in the form", async () => {
    const onChange = vi.fn();
    render(<Field onChange={onChange} />);
    await waitFor(() => expect(FakeAutocomplete.made).toHaveLength(1));

    act(() => FakeAutocomplete.made[0].pick({ formatted_address: "57 Princes Street, Onehunga, Auckland 1061, New Zealand" }));

    expect(onChange).toHaveBeenLastCalledWith("57 Princes Street, Onehunga, Auckland 1061, New Zealand");
    expect(screen.getByLabelText("Address")).toHaveValue("57 Princes Street, Onehunga, Auckland 1061, New Zealand");

    act(() => FakeAutocomplete.made[0].pick({ name: "Club 2020", vicinity: "Onehunga" }));
    expect(onChange).toHaveBeenLastCalledWith("Club 2020, Onehunga");
  });

  it("does not submit the form when Enter picks a suggestion", async () => {
    const submitted = vi.fn((event: SubmitEvent) => event.preventDefault());
    const user = userEvent.setup();
    render(<Field />);
    document.querySelector("form")?.addEventListener("submit", submitted);
    await waitFor(() => expect(FakeAutocomplete.made).toHaveLength(1));
    const list = FakeAutocomplete.made[0].suggestions;
    list.style.display = "block";
    list.appendChild(document.createElement("div"));

    await user.type(screen.getByLabelText("Address"), "57{Enter}");
    expect(submitted).not.toHaveBeenCalled();

    // With no suggestions showing, Enter submits as in any other field.
    list.style.display = "none";
    await user.type(screen.getByLabelText("Address"), "{Enter}");
    expect(submitted).toHaveBeenCalledTimes(1);
  });

  it("takes its Autocomplete and suggestion list down when the field goes", async () => {
    const { unmount } = render(<Field />);
    await waitFor(() => expect(FakeAutocomplete.made).toHaveLength(1));
    const [autocomplete] = FakeAutocomplete.made;

    unmount();

    expect(maps.clearInstanceListeners).toHaveBeenCalledWith(autocomplete);
    expect(autocomplete.suggestions.isConnected).toBe(false);
  });

  it("makes none when the field goes before Maps has loaded", async () => {
    let finish: (value: unknown) => void = () => {};
    maps.importLibrary.mockImplementation(
      (name: string) =>
        new Promise((resolve) => {
          if (name === "places") finish = () => resolve({ Autocomplete: FakeAutocomplete });
          else resolve({ event: { clearInstanceListeners: maps.clearInstanceListeners } });
        }),
    );
    const { unmount } = render(<Field />);
    await waitFor(() => expect(maps.importLibrary).toHaveBeenCalledWith("places"));

    unmount();
    await act(async () => finish(undefined));

    expect(FakeAutocomplete.made).toHaveLength(0);
  });
});
