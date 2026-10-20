import * as React from "react"

import { cn } from "@/lib/utils"
import { FIELD_CLASS } from "./input"

/**
 * The browser's own select, drawn like the text boxes: for a long list (time zones) or a short one on a
 * public page, where the phone's picker is quickest. Takes <option>s and <optgroup>s as children.
 */
const NativeSelect = React.forwardRef<HTMLSelectElement, React.ComponentProps<"select">>(
  ({ className, ...props }, ref) => (
    <select ref={ref} className={cn(FIELD_CLASS, "text-foreground", className)} {...props} />
  )
)
NativeSelect.displayName = "NativeSelect"

export { NativeSelect }
