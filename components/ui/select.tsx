'use client'

import * as React from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'

type SelectProps = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'children'> & {
  children: React.ReactNode
  containerClassName?: string
  placeholder?: React.ReactNode
  onChange?: (event: React.ChangeEvent<HTMLSelectElement>) => void
}

type ParsedOption = {
  value: string
  label: React.ReactNode
  disabled?: boolean
}

export const Select = React.forwardRef<HTMLButtonElement, SelectProps>(
  ({ className, containerClassName, children, onChange, value, defaultValue, disabled, placeholder, ...props }, ref) => {
    const options = React.useMemo(() => parseOptions(children), [children])
    const initialValue = defaultValue !== undefined ? String(defaultValue) : (options[0]?.value ?? '')
    const [internalValue, setInternalValue] = React.useState<string>(initialValue)
    const currentValue = value !== undefined ? String(value) : internalValue

    const selectedOption = options.find((option) => option.value === currentValue)

    const handleValueChange = (nextValue: string) => {
      if (value === undefined) {
        setInternalValue(nextValue)
      }

      onChange?.({
        target: { value: nextValue },
        currentTarget: { value: nextValue },
      } as React.ChangeEvent<HTMLSelectElement>)
    }

    return (
      <div className={cn('relative w-full', containerClassName)}>
        <SelectPrimitive.Root value={currentValue} onValueChange={handleValueChange} disabled={disabled}>
          <SelectPrimitive.Trigger
            ref={ref}
            className={cn(
              'flex h-9 w-full items-center justify-between rounded-md border border-input bg-surface px-3 py-1 text-sm text-foreground shadow-sm',
              'focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
              className,
            )}
            aria-label={typeof props['aria-label'] === 'string' ? props['aria-label'] : undefined}
            id={props.id}
            name={props.name}
          >
            <SelectPrimitive.Value placeholder={selectedOption?.label ?? placeholder} />
            <SelectPrimitive.Icon asChild>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            </SelectPrimitive.Icon>
          </SelectPrimitive.Trigger>

          <SelectPrimitive.Portal>
            <SelectPrimitive.Content
              position="popper"
              sideOffset={8}
              className="z-50 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-border bg-card text-foreground shadow-2xl"
            >
              <SelectPrimitive.ScrollUpButton className="flex items-center justify-center py-1 text-muted-foreground">
                <ChevronUp className="h-4 w-4" />
              </SelectPrimitive.ScrollUpButton>
              <SelectPrimitive.Viewport className="p-1">
                {options.map((option) => (
                  <SelectPrimitive.Item
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled}
                    className="relative flex cursor-default select-none items-center rounded-lg py-2 pl-8 pr-3 text-sm text-foreground outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-secondary data-[highlighted]:text-foreground"
                  >
                    <span className="absolute left-2 inline-flex h-4 w-4 items-center justify-center">
                      <SelectPrimitive.ItemIndicator>
                        <Check className="h-4 w-4 text-primary" />
                      </SelectPrimitive.ItemIndicator>
                    </span>
                    <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                  </SelectPrimitive.Item>
                ))}
              </SelectPrimitive.Viewport>
              <SelectPrimitive.ScrollDownButton className="flex items-center justify-center py-1 text-muted-foreground">
                <ChevronDown className="h-4 w-4" />
              </SelectPrimitive.ScrollDownButton>
            </SelectPrimitive.Content>
          </SelectPrimitive.Portal>
        </SelectPrimitive.Root>
      </div>
    )
  }
)

Select.displayName = 'Select'

function parseOptions(children: React.ReactNode): ParsedOption[] {
  const parsed: ParsedOption[] = []
  type OptionLikeElement = React.ReactElement<{
    value?: unknown
    children?: React.ReactNode
    disabled?: boolean
  }>

  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return

    if (typeof child.type === 'string' && child.type === 'option') {
      const optionChild = child as OptionLikeElement
      parsed.push({
        value: String(optionChild.props.value ?? ''),
        label: optionChild.props.children,
        disabled: Boolean(optionChild.props.disabled),
      })
      return
    }

    if (typeof child.type === 'string' && child.type === 'optgroup') {
      const optgroupChild = child as OptionLikeElement
      React.Children.forEach(optgroupChild.props.children, (nestedChild) => {
        if (!React.isValidElement(nestedChild)) return
        if (typeof nestedChild.type === 'string' && nestedChild.type === 'option') {
          const optionChild = nestedChild as OptionLikeElement
          parsed.push({
            value: String(optionChild.props.value ?? ''),
            label: optionChild.props.children,
            disabled: Boolean(optionChild.props.disabled),
          })
        }
      })
    }
  })

  return parsed
}
