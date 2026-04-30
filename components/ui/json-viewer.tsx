'use client'

import JsonView from '@uiw/react-json-view'
import type * as React from 'react'

type JsonViewerProps = {
  value: unknown
  collapsed?: boolean | number
}

const jsonViewerTheme: React.CSSProperties & Record<string, string | number> = {
  '--w-rjv-font-family': 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
  '--w-rjv-background-color': 'transparent',
  '--w-rjv-color': 'hsl(var(--foreground))',
  '--w-rjv-key-string': 'hsl(var(--primary))',
  '--w-rjv-line-color': 'hsl(var(--border))',
  '--w-rjv-arrow-color': 'hsl(var(--muted-foreground))',
  '--w-rjv-edit-color': 'hsl(var(--primary))',
  '--w-rjv-info-color': 'hsl(var(--muted-foreground))',
  '--w-rjv-update-color': 'hsl(var(--primary))',
  '--w-rjv-copied-color': 'hsl(var(--primary))',
  '--w-rjv-copied-success-color': 'hsl(var(--loss))',
  '--w-rjv-curlybraces-color': 'hsl(var(--muted-foreground))',
  '--w-rjv-colon-color': 'hsl(var(--foreground))',
  '--w-rjv-brackets-color': 'hsl(var(--muted-foreground))',
  '--w-rjv-quotes-color': 'hsl(var(--muted-foreground))',
  '--w-rjv-quotes-string-color': 'hsl(var(--profit))',
  '--w-rjv-type-string-color': 'hsl(var(--profit))',
  '--w-rjv-type-int-color': 'hsl(var(--primary))',
  '--w-rjv-type-float-color': 'hsl(var(--primary))',
  '--w-rjv-type-bigint-color': 'hsl(var(--primary))',
  '--w-rjv-type-boolean-color': 'hsl(var(--accent))',
  '--w-rjv-type-date-color': 'hsl(var(--primary))',
  '--w-rjv-type-url-color': 'hsl(var(--primary))',
  '--w-rjv-type-null-color': 'hsl(var(--destructive))',
  '--w-rjv-type-nan-color': 'hsl(var(--destructive))',
  '--w-rjv-type-undefined-color': 'hsl(var(--muted-foreground))',
}

function normalizeJsonValue(value: unknown): object {
  if (value !== null && typeof value === 'object') return value
  return { value }
}

export default function JsonViewer({ value, collapsed = 2 }: JsonViewerProps) {
  return (
    <div className="max-h-[28rem] overflow-auto p-3 text-[11px] leading-5 [&_*]:break-words">
      <JsonView
        key={String(collapsed)}
        value={normalizeJsonValue(value)}
        collapsed={collapsed}
        displayDataTypes={false}
        displayObjectSize
        enableClipboard
        shortenTextAfterLength={0}
        style={jsonViewerTheme}
      />
    </div>
  )
}
