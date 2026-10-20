import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/app/theme";

/**
 * The staff screens' light/dark switch; the ThemeController applies and remembers the choice. Its
 * name is what it says ("Dark Mode" switches to dark), so speech and the screen agree.
 */
export function ThemeToggle() {
  const { preference, setPreference } = useTheme();
  const next = preference === "light" ? "dark" : "light";
  const Icon = next === "dark" ? Moon : Sun;

  return (
    <Button variant="ghost" size="sm" onClick={() => setPreference(next)} className="w-full justify-start">
      <Icon className="mr-3 h-4 w-4" aria-hidden="true" />
      <span>{next === "dark" ? "Dark Mode" : "Light Mode"}</span>
    </Button>
  );
}
