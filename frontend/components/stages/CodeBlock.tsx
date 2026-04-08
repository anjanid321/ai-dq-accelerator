'use client'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'

interface Props {
  code: string
  language?: string
}

export function CodeBlock({ code, language = 'python' }: Props) {
  return (
    <SyntaxHighlighter
      language={language}
      style={vscDarkPlus}
      customStyle={{
        margin: 0,
        borderRadius: '0.375rem',
        fontSize: '11px',
        lineHeight: '1.5',
        background: 'transparent',
        padding: '0.5rem',
      }}
      codeTagProps={{ style: { fontFamily: 'ui-monospace, monospace' } }}
    >
      {code}
    </SyntaxHighlighter>
  )
}
