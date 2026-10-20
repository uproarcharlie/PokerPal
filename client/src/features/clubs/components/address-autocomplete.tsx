import { forwardRef, useEffect, useImperativeHandle, useRef, type ComponentProps, type KeyboardEvent } from "react";
import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import { Input } from "@/components/ui/input";

/** The Maps key this build was given, or null: then the field is a plain text input. */
function mapsKey(): string | null {
  const key: unknown = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  return typeof key === "string" && key.trim() ? key.trim() : null;
}

let configured = false;

/** Loads Places once per page; rejects when Maps cannot load (no network, a CSP block, a bad key). */
async function loadPlaces(key: string) {
  if (!configured) {
    setOptions({ key, v: "weekly" });
    configured = true;
  }
  const [places, core] = await Promise.all([importLibrary("places"), importLibrary("core")]);
  return { Autocomplete: places.Autocomplete, event: core.event };
}

/** The address of a picked suggestion: Google's formatted one, else "<name>, <vicinity>". */
function placeAddress(place: google.maps.places.PlaceResult): string | null {
  if (place.formatted_address) return place.formatted_address;
  if (place.name && place.vicinity) return `${place.name}, ${place.vicinity}`;
  return null;
}

const isShowing = (element: HTMLElement) => element.isConnected && element.style.display !== "none" && element.childElementCount > 0;

export interface AddressAutocompleteProps extends Omit<ComponentProps<"input">, "value" | "onChange" | "defaultValue" | "ref"> {
  value: string | null | undefined;
  onChange: (address: string) => void;
}

/**
 * An address field: always a working, controlled text input, which Google Places suggestions are added
 * to when Maps loads. One Autocomplete is made per mount (never per keystroke) and is taken down, with
 * its suggestion list, when the field goes. The ref reaches the input, so a form spreading `{...field}`
 * can focus it on a validation error, as every other field (P3REV6-CQ-07).
 */
export const AddressAutocomplete = forwardRef<HTMLInputElement, AddressAutocompleteProps>(function AddressAutocomplete(
  { value, onChange, placeholder = "Start typing an address...", onKeyDown, ...props },
  ref,
) {
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => input.current as HTMLInputElement, []);
  // The latest callback, so the Autocomplete made once always reports to the current form.
  const report = useRef(onChange);
  useEffect(() => {
    report.current = onChange;
  });
  // The suggestion lists this field's Autocomplete added to the page.
  const suggestions = useRef<HTMLElement[]>([]);

  useEffect(() => {
    const key = mapsKey();
    const element = input.current;
    if (!key || !element) return;
    let unmounted = false;
    let takeDown: (() => void) | null = null;

    loadPlaces(key)
      .then(({ Autocomplete, event }) => {
        if (unmounted) return;
        const before = new Set(document.querySelectorAll(".pac-container"));
        const autocomplete = new Autocomplete(element, {
          componentRestrictions: { country: "nz" },
          fields: ["formatted_address", "name", "vicinity"],
        });
        const added = Array.from(document.querySelectorAll<HTMLElement>(".pac-container")).filter((list) => !before.has(list));
        suggestions.current = added;
        autocomplete.addListener("place_changed", () => {
          const address = placeAddress(autocomplete.getPlace());
          if (address) report.current(address);
        });
        takeDown = () => {
          event.clearInstanceListeners(autocomplete);
          for (const list of added) list.remove();
        };
      })
      .catch(() => {
        // Maps is unavailable here; the plain field already works.
      });

    return () => {
      unmounted = true;
      takeDown?.();
      suggestions.current = [];
    };
  }, []);

  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Enter picks the highlighted suggestion; it must not also submit the form.
    if (event.key === "Enter" && suggestions.current.some(isShowing)) event.preventDefault();
    onKeyDown?.(event);
  };

  return (
    <Input
      {...props}
      ref={input}
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={keyDown}
      placeholder={placeholder}
    />
  );
});
