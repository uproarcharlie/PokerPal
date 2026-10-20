import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The look every text box and native select shares (its edge, fill, focus ring, disabled state), so a
 * select drawn by the browser matches the fields beside it and a theme restyles them once (P3REV3-CQ-10).
 */
export const FIELD_CLASS =
  "flex h-10 w-full rounded-md border border-control bg-background px-3 py-2 text-base ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          FIELD_CLASS,
          "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-placeholder",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
