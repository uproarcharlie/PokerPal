import { useId } from "react";
import type { ClubDto } from "@shared/api/public";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface ClubPickerProps {
  clubs: readonly ClubDto[];
  value: string;
  onChange: (clubId: string) => void;
}

/** Which of the clubs the viewer runs to list the players of. */
export function ClubPicker({ clubs, value, onChange }: ClubPickerProps) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
      <Label htmlFor={id} className="text-foreground">
        Select Club
      </Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full sm:w-72">
          <SelectValue placeholder="Choose a club to view its players" />
        </SelectTrigger>
        <SelectContent>
          {clubs.map((club) => (
            <SelectItem key={club.id} value={club.id}>
              {club.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
