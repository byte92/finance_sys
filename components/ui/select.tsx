import * as React from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  containerClassName?: string
}

const Select = React.forwardRef<
  HTMLSelectElement,
  SelectProps
>(({ className, containerClassName, children, ...props }, ref) => (
  <div className={cn("relative w-full", containerClassName)}>
    <select
      ref={ref}
      className={cn(
        "flex h-9 w-full appearance-none rounded-md border border-input bg-surface px-3 pr-10 py-1 text-sm text-foreground shadow-sm",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      {children}
    </select>
    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground">
      <ChevronDown className="h-4 w-4" />
    </span>
  </div>
))
Select.displayName = "Select"

export { Select }
