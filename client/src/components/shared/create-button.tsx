import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CreateButtonProps {
  label: string;
  /** The e2e specs find each create button by its test id. */
  testId: string;
  onClick: () => void;
  disabled?: boolean;
}

/** "Create …" on a list page: in its header, and again in its empty state. */
export function CreateButton({ label, testId, onClick, disabled }: CreateButtonProps) {
  return (
    <Button onClick={onClick} disabled={disabled} data-testid={testId}>
      <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
      {label}
    </Button>
  );
}
