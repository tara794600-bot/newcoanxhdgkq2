export const RICH_DESCRIPTION_OPEN: string
export const RICH_DESCRIPTION_CLOSE: string
export function isRichDescription(value: unknown): boolean
export function escapeHtml(value: unknown): string
export function sanitizeRichHtml(html: unknown): string
export function richHtmlToPlainText(html: unknown): string
export function descriptionToPlainText(description: unknown): string
export function prependRichParagraph(description: string, text: string): string
export function getRichImageSources(description: string): string[]
