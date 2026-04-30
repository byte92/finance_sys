'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

type MarkdownMessageProps = {
  content: string
}

export default function MarkdownMessage({ content }: MarkdownMessageProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ children, href }) => (
          <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
            {children}
          </a>
        ),
        code: ({ children, className }) => {
          const inline = !className
          if (inline) {
            return <code className="rounded bg-background/80 px-1 py-0.5 font-mono text-[0.86em]">{children}</code>
          }
          return <code className={`${className ?? ''} font-mono text-xs`}>{children}</code>
        },
        pre: ({ children }) => (
          <pre className="my-2 max-w-full overflow-x-auto rounded-md border border-border bg-background/85 p-3 text-xs leading-5">
            {children}
          </pre>
        ),
        table: ({ children }) => (
          <div className="my-2 max-w-full overflow-x-auto">
            <table className="w-full border-collapse text-xs">{children}</table>
          </div>
        ),
        th: ({ children }) => <th className="border border-border bg-background/70 px-2 py-1 text-left font-medium">{children}</th>,
        td: ({ children }) => <td className="border border-border px-2 py-1 align-top">{children}</td>,
      }}
    >
      {content}
    </ReactMarkdown>
  )
}
