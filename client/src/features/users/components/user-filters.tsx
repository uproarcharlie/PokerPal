import { useId } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { optionOf, ROLE_OPTIONS, TYPE_OPTIONS, type UserFilter } from "../user-filter";

/** Search box and type and role choices above the user list; they stack on a phone. */
export function UserFilters({ value, onChange }: { value: UserFilter; onChange: (filter: UserFilter) => void }) {
  const searchId = useId();
  const typeId = useId();
  const roleId = useId();
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-end">
      <div className="flex-1 space-y-1">
        <Label htmlFor={searchId} className="text-foreground">
          Search
        </Label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            id={searchId}
            type="search"
            placeholder="Search users..."
            className="pl-9"
            value={value.search}
            onChange={(event) => onChange({ ...value, search: event.target.value })}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor={typeId} className="text-foreground">
          Type
        </Label>
        <Select value={value.type} onValueChange={(next) => onChange({ ...value, type: optionOf(TYPE_OPTIONS, next) ?? "all" })}>
          <SelectTrigger id={typeId} className="w-full md:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TYPE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor={roleId} className="text-foreground">
          Role
        </Label>
        <Select value={value.role} onValueChange={(next) => onChange({ ...value, role: optionOf(ROLE_OPTIONS, next) ?? "all" })}>
          <SelectTrigger id={roleId} className="w-full md:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROLE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
