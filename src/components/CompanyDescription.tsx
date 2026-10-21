import { useEffect, useMemo } from 'react'
import { isRichDescription, sanitizeRichHtml } from '../../shared/rich-text.js'
import { ensureRichTextFonts } from './richTextFonts'
import './CompanyPostEditor.css'

type Props = { description: string; className?: string }

// Older posts are plain text; posts from the blog-style editor are sanitized HTML.
export function CompanyDescription({ description, className = 'company-detail-description' }: Props) {
  const html = useMemo(() => (isRichDescription(description) ? sanitizeRichHtml(description) : ''), [description])

  useEffect(() => {
    if (html.includes('font-family')) {
      ensureRichTextFonts()
    }
  }, [html])

  if (!html) {
    return <p className={className}>{description}</p>
  }

  return <div className={`${className} se-viewer`} dangerouslySetInnerHTML={{ __html: html }} />
}
