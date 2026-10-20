import { useMemo, type ComponentProps } from "react";
import { NativeSelect } from "@/components/ui/native-select";
import { timeZoneGroups, timeZoneLabel } from "../time-zones";

interface TimeZoneSelectProps extends Omit<ComponentProps<"select">, "value" | "onChange" | "children"> {
  value: string;
  onChange: (zone: string) => void;
}

/**
 * The club's IANA time zone, which every date and start time on its pages is shown in. A native select:
 * hundreds of zones are quickest to pick from the phone's own picker, and typing a letter jumps to it.
 */
export function TimeZoneSelect({ value, onChange, className, ...props }: TimeZoneSelectProps) {
  const groups = useMemo(() => timeZoneGroups(value), [value]);
  return (
    <NativeSelect {...props} value={value} onChange={(event) => onChange(event.target.value)} className={className}>
      <optgroup label="New Zealand and nearby">
        {groups.nearby.map((zone) => (
          <option key={zone} value={zone}>
            {timeZoneLabel(zone)}
          </option>
        ))}
      </optgroup>
      {groups.other.length > 0 ? (
        <optgroup label="All time zones">
          {groups.other.map((zone) => (
            <option key={zone} value={zone}>
              {timeZoneLabel(zone)}
            </option>
          ))}
        </optgroup>
      ) : null}
    </NativeSelect>
  );
}
