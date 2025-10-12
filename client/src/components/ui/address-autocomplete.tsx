import { useEffect, useRef, useState } from "react";
import { Input } from "./input";

interface AddressAutocompleteProps {
  value?: string;
  onChange: (address: string, timezone?: string) => void;
  placeholder?: string;
}

// Global flag to track if Google Maps is loaded
let googleMapsLoaded = false;
let googleMapsLoadingPromise: Promise<void> | null = null;

const loadGoogleMapsScript = (apiKey: string): Promise<void> => {
  if (googleMapsLoaded) {
    return Promise.resolve();
  }

  if (googleMapsLoadingPromise) {
    return googleMapsLoadingPromise;
  }

  googleMapsLoadingPromise = new Promise((resolve, reject) => {
    // Check if already loaded
    if (window.google?.maps?.places) {
      googleMapsLoaded = true;
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&callback=initGoogleMaps`;
    script.async = true;
    script.defer = true;

    (window as any).initGoogleMaps = () => {
      googleMapsLoaded = true;
      resolve();
    };

    script.onerror = () => {
      reject(new Error("Failed to load Google Maps script"));
    };

    document.head.appendChild(script);
  });

  return googleMapsLoadingPromise;
};

export function AddressAutocomplete({ value, onChange, placeholder }: AddressAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);

  useEffect(() => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

    if (!apiKey) {
      console.warn("Google Maps API key not configured");
      setError("API key not configured");
      return;
    }

    loadGoogleMapsScript(apiKey)
      .then(() => {
        setIsLoaded(true);
        setError(null);
      })
      .catch((error) => {
        console.error("Error loading Google Maps API:", error);
        setError("Failed to load Google Maps");
      });
  }, []);

  useEffect(() => {
    if (!isLoaded || !inputRef.current) return;

    autocompleteRef.current = new google.maps.places.Autocomplete(inputRef.current, {
      types: ["establishment", "geocode"], // Support businesses and addresses
      componentRestrictions: { country: "nz" }, // Default to New Zealand, can be made configurable
    });

    autocompleteRef.current.addListener("place_changed", () => {
      const place = autocompleteRef.current?.getPlace();

      // Extract timezone from place
      let timezone: string | undefined;
      if (place?.geometry?.location) {
        const lat = place.geometry.location.lat();
        const lng = place.geometry.location.lng();

        // Use Geocoding API to get timezone
        fetch(`https://maps.googleapis.com/maps/api/timezone/json?location=${lat},${lng}&timestamp=${Math.floor(Date.now() / 1000)}&key=${import.meta.env.VITE_GOOGLE_MAPS_API_KEY}`)
          .then(res => res.json())
          .then(data => {
            if (data.timeZoneId) {
              timezone = data.timeZoneId;

              if (place?.formatted_address) {
                onChange(place.formatted_address, timezone);
              } else if (place?.name && place?.vicinity) {
                onChange(`${place.name}, ${place.vicinity}`, timezone);
              }
            } else {
              // Fallback without timezone
              if (place?.formatted_address) {
                onChange(place.formatted_address);
              } else if (place?.name && place?.vicinity) {
                onChange(`${place.name}, ${place.vicinity}`);
              }
            }
          })
          .catch(() => {
            // Fallback without timezone on error
            if (place?.formatted_address) {
              onChange(place.formatted_address);
            } else if (place?.name && place?.vicinity) {
              onChange(`${place.name}, ${place.vicinity}`);
            }
          });
      } else {
        // No geometry, just update address without timezone
        if (place?.formatted_address) {
          onChange(place.formatted_address);
        } else if (place?.name && place?.vicinity) {
          onChange(`${place.name}, ${place.vicinity}`);
        }
      }
    });

    return () => {
      if (autocompleteRef.current) {
        google.maps.event.clearInstanceListeners(autocompleteRef.current);
      }
    };
  }, [isLoaded, onChange]);

  if (error) {
    return (
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || "Enter address manually"}
      />
    );
  }

  return (
    <Input
      ref={inputRef}
      defaultValue={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder || "Start typing an address..."}
    />
  );
}
