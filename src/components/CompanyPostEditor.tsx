import {
  type ChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import {
  RICH_DESCRIPTION_CLOSE,
  RICH_DESCRIPTION_OPEN,
  descriptionToPlainText,
  escapeHtml,
  isRichDescription,
  sanitizeRichHtml,
} from '../../shared/rich-text.js'
import { CompanyContentPreview } from './CompanyContentPreview'
import { RICH_TEXT_FONTS, ensureRichTextFonts, getRichTextFontLabel } from './richTextFonts'
import './CompanyPostEditor.css'

type VisibilityOption<T extends string> = { value: T; label: string; description: string }

type Props<T extends string> = {
  isEditing: boolean
  busy: boolean
  errorMessage: string
  title: string
  titleMaxLength: number
  onTitleChange: (value: string) => void
  service: string
  serviceMaxLength: number
  serviceSuggestions: string[]
  onServiceChange: (value: string) => void
  visibility: T
  visibilityOptions: readonly VisibilityOption<T>[]
  onVisibilityChange: (value: T) => void
  coverFile: File | null
  coverUrl: string
  onCoverFileChange: (file: File | null) => void
  description: string
  onDescriptionChange: (value: string) => void
  uploadImage: (file: File) => Promise<string>
  onPublish: (event: FormEvent<HTMLFormElement>) => void
  onClose: () => void
}

type MenuId =
  | 'sticker'
  | 'quote'
  | 'divider'
  | 'table'
  | 'textStyle'
  | 'font'
  | 'size'
  | 'color'
  | 'background'
  | 'align'
  | 'lineHeight'
  | 'list'
  | 'symbol'
  | 'link'
  | 'drafts'
  | 'publish'

type DialogState =
  | { kind: 'place' }
  | { kind: 'oglink' }
  | { kind: 'schedule' }
  | { kind: 'formula'; target: HTMLElement | null; source: string }

type BlockStyle = 'p' | 'h3' | 'blockquote'
type Alignment = 'left' | 'center' | 'right' | 'justify'
type ComponentKind = 'image' | 'table' | 'quote' | 'divider' | 'formula' | 'other'

type FormatState = {
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  superscript: boolean
  subscript: boolean
  align: Alignment
  block: BlockStyle
  fontSize: number
  fontLabel: string
  list: '' | 'ul' | 'ol'
  link: boolean
}

type ActiveComponent = {
  kind: ComponentKind
  variant: string
  selected: boolean
  top: number
  right: number
}

type StoredDraft = {
  id: string
  savedAt: number
  title: string
  service: string
  visibility: string
  html: string
}

type Toast = { message: string; tone: 'info' | 'error' }

const DEFAULT_FONT_SIZE = 16
const FONT_SIZES = [11, 13, 15, 16, 19, 24, 28, 30, 34, 38]
const LINE_HEIGHTS = ['1', '1.3', '1.5', '1.8', '2', '2.5', '3']
const TEXT_STYLES: { value: BlockStyle; label: string }[] = [
  { value: 'p', label: '본문' },
  { value: 'h3', label: '소제목' },
  { value: 'blockquote', label: '인용구' },
]
const ALIGNMENTS: { value: Alignment; label: string; command: string }[] = [
  { value: 'left', label: '왼쪽 정렬', command: 'justifyLeft' },
  { value: 'center', label: '가운데 정렬', command: 'justifyCenter' },
  { value: 'right', label: '오른쪽 정렬', command: 'justifyRight' },
  { value: 'justify', label: '양쪽 정렬', command: 'justifyFull' },
]
const COLOR_PALETTE = [
  ['#000000', '#333333', '#555555', '#777777', '#999999', '#bbbbbb', '#dddddd', '#ffffff'],
  ['#ff0010', '#ff9300', '#ffd400', '#00a84b', '#0078cb', '#004e82', '#6a3fd1', '#c42ca8'],
  ['#ffdfe1', '#ffefd9', '#fff8cc', '#dcf3e6', '#d9ecfa', '#d4e1eb', '#e7dff8', '#f6dcf1'],
  ['#ff9ca3', '#ffc985', '#ffe97f', '#7fd3a5', '#7fbbe5', '#7fa6c0', '#b49ee8', '#e19bd2'],
  ['#b2000b', '#b26700', '#b29400', '#00753a', '#00548e', '#00375b', '#4a2c92', '#891f75'],
]
const SYMBOLS = Array.from(
  '※☆★○●◎◇◆□■△▲▽▼→←↑↓↔↕◁◀▷▶♤♠♡♥♧♣⊙◈▣◐◑▒▤▥▨▧▦▩♨☏☎☜☞¶†‡♭♩♪♬㉿㈜№™℡®©°′″℃€£¥±×÷≠≤≥∞∴∵∑√∫≒≡「」『』【】《》〈〉·…',
)
const STICKER_GROUPS = [
  { label: '표정', items: ['😀', '😁', '😂', '🤣', '😊', '😍', '🥰', '😎', '🤔', '😮', '😢', '😭', '😡', '🤯', '😱', '🥺', '😴', '🤗'] },
  { label: '손짓', items: ['👍', '👎', '👏', '🙌', '🙏', '✌️', '👌', '🤝', '💪', '👉', '☝️', '✋'] },
  { label: '동물', items: ['🐶', '🐱', '🐰', '🐻', '🐼', '🦊', '🐯', '🐷', '🐸', '🐵', '🐥', '🐧'] },
  { label: '기호', items: ['❤️', '💔', '⭐', '🔥', '🎉', '💯', '✅', '❌', '⚠️', '🚫', '📌', '💰', '📞', '📢', '🔔', '💡', '🔒', '🚨'] },
]
const QUOTE_STYLES = [
  { value: 'default', label: '따옴표' },
  { value: 'line', label: '버티컬 라인' },
  { value: 'bubble', label: '말풍선' },
  { value: 'underline', label: '라인&따옴표' },
  { value: 'postit', label: '포스트잇' },
  { value: 'frame', label: '프레임' },
]
const DIVIDER_STYLES = ['line1', 'line2', 'line3', 'line4', 'line5', 'line6', 'line7', 'line8']
const IMAGE_SIZES = [
  { value: 'small', label: '작게' },
  { value: 'medium', label: '중간' },
  { value: 'full', label: '문서 너비' },
]
const TABLE_PICKER_SIZE = 8
const MAX_DRAFTS = 20
const DRAFT_STORAGE_KEY = 'naran-company-post-drafts'
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']
const ISLAND_SELECTOR = '.se-quote-text, .se-quote-cite, .se-caption, .se-code-source, .se-table-content td, .se-table-content th'
const ISLAND_PLACEHOLDERS: [string, string][] = [
  ['.se-quote-text', '내용을 입력하세요.'],
  ['.se-quote-cite', '출처 입력'],
  ['.se-caption', '사진 설명을 입력하세요.'],
  ['.se-code-source', '소스코드를 입력하세요.'],
]
const INLINE_TAGS = new Set(['A', 'B', 'BR', 'CODE', 'DEL', 'EM', 'FONT', 'I', 'S', 'SPAN', 'STRIKE', 'STRONG', 'SUB', 'SUP', 'U'])
const FORMULA_SYMBOLS: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', theta: 'θ', lambda: 'λ', mu: 'μ',
  pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ',
  Theta: 'Θ', Lambda: 'Λ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Omega: 'Ω', times: '×', div: '÷',
  pm: '±', cdot: '·', le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈',
  infty: '∞', sum: '∑', prod: '∏', int: '∫', partial: '∂', to: '→', rightarrow: '→',
  leftarrow: '←', Rightarrow: '⇒', degree: '°', percent: '%',
}

const DEFAULT_FORMAT: FormatState = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  superscript: false,
  subscript: false,
  align: 'left',
  block: 'p',
  fontSize: DEFAULT_FONT_SIZE,
  fontLabel: RICH_TEXT_FONTS[0].label,
  list: '',
  link: false,
}

const keepSelection = (event: ReactMouseEvent) => event.preventDefault()

const createFromHtml = (html: string): HTMLElement => {
  const template = document.createElement('template')
  template.innerHTML = html.trim()
  return template.content.firstElementChild as HTMLElement
}

const createEmptyParagraph = () => {
  const paragraph = document.createElement('p')
  paragraph.append(document.createElement('br'))
  return paragraph
}

const isComponent = (node: Element | null) => Boolean(node?.classList.contains('se-component'))

const isEmptyTextBlock = (node: Element) =>
  node.tagName === 'P' && !node.textContent?.trim() && !node.querySelector('img')

const getElement = (node: Node | null): HTMLElement | null =>
  node instanceof HTMLElement ? node : (node?.parentElement ?? null)

const getEditingHost = (node: Node | null) => getElement(node)?.closest<HTMLElement>('[contenteditable="true"]') ?? null

const placeCaret = (element: HTMLElement, atEnd = false) => {
  const range = document.createRange()
  range.selectNodeContents(element)
  range.collapse(!atEnd)
  getEditingHost(element)?.focus({ preventScroll: true })
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

const getTopLevelBlock = (body: HTMLElement, node: Node | null): HTMLElement | null => {
  let current = node

  while (current && current.parentNode !== body) {
    current = current.parentNode
  }

  return current instanceof HTMLElement ? current : null
}

const prepareComponents = (root: HTMLElement) => {
  const components = root.matches('.se-component') ? [root] : []
  components.push(...root.querySelectorAll<HTMLElement>('.se-component'))
  components.forEach((element) => {
    element.contentEditable = 'false'
  })
  root.querySelectorAll<HTMLElement>(ISLAND_SELECTOR).forEach((element) => {
    element.contentEditable = 'true'
  })

  for (const [selector, placeholder] of ISLAND_PLACEHOLDERS) {
    root.querySelectorAll<HTMLElement>(selector).forEach((element) => {
      element.dataset.placeholder = placeholder
    })
  }
}

// Components can't hold the caret, so every one of them keeps a paragraph after it.
const ensureParagraphsAroundComponents = (body: HTMLElement) => {
  Array.from(body.children).forEach((child) => {
    if (isComponent(child) && (!child.nextElementSibling || isComponent(child.nextElementSibling))) {
      child.after(createEmptyParagraph())
    }
  })

  if (!body.lastElementChild || isComponent(body.lastElementChild)) {
    body.append(createEmptyParagraph())
  }
}

const wrapStrayInlineNodes = (body: HTMLElement) => {
  const isStray = (node: ChildNode) =>
    (node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim())) ||
    (node instanceof HTMLElement && INLINE_TAGS.has(node.tagName))

  if (!Array.from(body.childNodes).some(isStray)) {
    return
  }

  const selection = window.getSelection()
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null
  const anchor = range ? { node: range.startContainer, offset: range.startOffset } : null
  let paragraph: HTMLParagraphElement | null = null

  for (const node of Array.from(body.childNodes)) {
    if (!isStray(node)) {
      paragraph = null
      continue
    }

    if (!paragraph) {
      paragraph = document.createElement('p')
      body.insertBefore(paragraph, node)
    }

    paragraph.append(node)
  }

  if (anchor && anchor.node.isConnected && selection) {
    const nextRange = document.createRange()
    nextRange.setStart(anchor.node, Math.min(anchor.offset, anchor.node.textContent?.length ?? 0))
    nextRange.collapse(true)
    selection.removeAllRanges()
    selection.addRange(nextRange)
  }
}

const normalizeEditorDom = (body: HTMLElement, pendingFontSize: number) => {
  // fontSize is applied as <font size="7"> and converted here so the caret stays put.
  body.querySelectorAll<HTMLElement>('font[size]').forEach((font) => {
    if (font.getAttribute('size') === '7') {
      font.style.fontSize = `${pendingFontSize}px`
    }
    font.removeAttribute('size')
  })

  body.querySelectorAll<HTMLElement>(ISLAND_SELECTOR).forEach((island) => {
    if (!island.textContent && !island.querySelector('img') && island.innerHTML) {
      island.innerHTML = ''
    }
  })

  wrapStrayInlineNodes(body)
  ensureParagraphsAroundComponents(body)
}

const isBodyVisuallyEmpty = (body: HTMLElement) =>
  !body.textContent?.trim() && !body.querySelector('img, hr, table, ul, ol, h3, blockquote, .se-component')

const toEditorHtml = (description: string) => {
  if (isRichDescription(description)) {
    const sanitized = sanitizeRichHtml(description)
    const inner =
      sanitized.startsWith(RICH_DESCRIPTION_OPEN) && sanitized.endsWith(RICH_DESCRIPTION_CLOSE)
        ? sanitized.slice(RICH_DESCRIPTION_OPEN.length, -RICH_DESCRIPTION_CLOSE.length)
        : sanitized
    return inner || '<p><br></p>'
  }

  // Plain-text posts become one paragraph per line.
  const paragraphs = description
    .split(/\r?\n/)
    .map((line) => (line.trim() ? `<p>${escapeHtml(line)}</p>` : '<p><br></p>'))
  return paragraphs.join('') || '<p><br></p>'
}

const serializeEditorBody = (body: HTMLElement) => {
  const clone = body.cloneNode(true) as HTMLElement

  while (clone.lastElementChild && isEmptyTextBlock(clone.lastElementChild)) {
    clone.lastElementChild.remove()
  }

  while (clone.firstElementChild && isEmptyTextBlock(clone.firstElementChild)) {
    clone.firstElementChild.remove()
  }

  const hasContent = Boolean(clone.textContent?.trim()) || Boolean(clone.querySelector('img, hr, table, .se-component'))

  // contenteditable, placeholders and selection classes are dropped by the sanitizer.
  return hasContent ? sanitizeRichHtml(`${RICH_DESCRIPTION_OPEN}${clone.innerHTML}${RICH_DESCRIPTION_CLOSE}`) : ''
}

const queryCommandState = (command: string) => {
  try {
    return document.queryCommandState(command)
  } catch {
    return false
  }
}

const readFormatState = (body: HTMLElement, range: Range): FormatState => {
  const element = getElement(range.startContainer) ?? body
  const computed = window.getComputedStyle(element)
  const align: Alignment = queryCommandState('justifyCenter')
    ? 'center'
    : queryCommandState('justifyRight')
      ? 'right'
      : queryCommandState('justifyFull')
        ? 'justify'
        : 'left'

  return {
    bold: queryCommandState('bold'),
    italic: queryCommandState('italic'),
    underline: queryCommandState('underline'),
    strike: queryCommandState('strikeThrough'),
    superscript: queryCommandState('superscript'),
    subscript: queryCommandState('subscript'),
    align,
    block: element.closest('h3') ? 'h3' : element.closest('blockquote:not(.se-quote-body)') ? 'blockquote' : 'p',
    fontSize: Math.round(parseFloat(computed.fontSize)) || DEFAULT_FONT_SIZE,
    fontLabel: getRichTextFontLabel(computed.fontFamily),
    list: element.closest('ul') ? 'ul' : element.closest('ol') ? 'ol' : '',
    link: Boolean(element.closest('a')),
  }
}

const getComponentKind = (element: HTMLElement): ComponentKind => {
  if (element.classList.contains('se-image')) return 'image'
  if (element.classList.contains('se-table')) return 'table'
  if (element.classList.contains('se-quote')) return 'quote'
  if (element.classList.contains('se-hr')) return 'divider'
  if (element.classList.contains('se-formula')) return 'formula'
  return 'other'
}

const measureComponent = (element: HTMLElement, documentElement: HTMLElement, selected: boolean): ActiveComponent => {
  const documentRect = documentElement.getBoundingClientRect()
  const rect = element.getBoundingClientRect()
  const variantClass = Array.from(element.classList).find((className) => className.startsWith('se-image-size-'))

  return {
    kind: getComponentKind(element),
    variant: variantClass?.slice('se-image-size-'.length) ?? '',
    selected,
    top: rect.top - documentRect.top,
    right: documentRect.right - rect.right,
  }
}

const setVariantClass = (element: HTMLElement, prefix: string, variant: string) => {
  Array.from(element.classList)
    .filter((className) => className.startsWith(prefix))
    .forEach((className) => element.classList.remove(className))
  element.classList.add(`${prefix}${variant}`)
}

const normalizeUrl = (value: string) => {
  const trimmed = value.trim()

  if (!trimmed) return ''

  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`

  try {
    const url = new URL(withScheme)
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol) ? url.href : ''
  } catch {
    return ''
  }
}

const renderFormulaHtml = (source: string) => {
  let index = 0

  const readGroup = (): string => {
    if (source[index] !== '{') {
      return readToken()
    }

    index += 1
    let html = ''

    while (index < source.length && source[index] !== '}') {
      html += readToken()
    }

    index += 1
    return html
  }

  const readToken = (): string => {
    const char = source[index]

    if (char === undefined) return ''
    if (char === '{') return readGroup()

    if (char === '\\') {
      const command = /^\\([a-zA-Z]+)/.exec(source.slice(index))

      if (!command) {
        index += 2
        return escapeHtml(source[index - 1] ?? '')
      }

      index += command[0].length

      if (command[1] === 'frac') {
        const numerator = readGroup()
        const denominator = readGroup()
        return `<span class="se-formula-frac"><span class="se-formula-num">${numerator}</span><span class="se-formula-den">${denominator}</span></span>`
      }

      if (command[1] === 'sqrt') {
        return `<span class="se-formula-sqrt">√<span class="se-formula-radicand">${readGroup()}</span></span>`
      }

      return escapeHtml(FORMULA_SYMBOLS[command[1]] ?? command[1])
    }

    index += 1

    if (char === '^') return `<sup>${readGroup()}</sup>`
    if (char === '_') return `<sub>${readGroup()}</sub>`
    return escapeHtml(char)
  }

  let html = ''

  while (index < source.length) {
    html += readToken()
  }

  return html
}

const formatScheduleDate = (date: string, time: string) => {
  const [year, month, day] = date.split('-').map(Number)

  if (!year || !month || !day) return ''

  const weekday = WEEKDAYS[new Date(year, month - 1, day).getDay()]
  return `${year}. ${month}. ${day}.(${weekday})${time ? ` ${time}` : ''}`
}

const toDateInputValue = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

const isStoredDraft = (value: unknown): value is StoredDraft => {
  if (!value || typeof value !== 'object') return false
  const draft = value as Partial<StoredDraft>
  return (
    typeof draft.id === 'string' &&
    typeof draft.savedAt === 'number' &&
    typeof draft.title === 'string' &&
    typeof draft.service === 'string' &&
    typeof draft.visibility === 'string' &&
    typeof draft.html === 'string'
  )
}

const readDrafts = (): StoredDraft[] => {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(DRAFT_STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter(isStoredDraft) : []
  } catch {
    return []
  }
}

const writeDrafts = (drafts: StoredDraft[]) => {
  try {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(drafts))
    return true
  } catch {
    return false
  }
}

const formatDraftTime = (timestamp: number) => {
  const date = new Date(timestamp)
  return `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}. ${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes(),
  ).padStart(2, '0')}`
}

const ICON_PATHS: Record<string, ReactNode> = {
  photo: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="8.5" cy="10" r="1.6" />
      <path d="m21 16-5-5-8 8" />
    </>
  ),
  sticker: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 14.5c.9 1.2 2.1 1.8 3.5 1.8s2.6-.6 3.5-1.8" />
      <path d="M9 9.5h.01M15 9.5h.01" strokeWidth="2.4" />
    </>
  ),
  quote: (
    <path d="M10 7H6.5A1.5 1.5 0 0 0 5 8.5V12h4v1.5C9 15 8 16 6.5 16.5M19 7h-3.5A1.5 1.5 0 0 0 14 8.5V12h4v1.5c0 1.5-1 2.5-2.5 3" />
  ),
  divider: (
    <>
      <path d="M3 12h18" />
      <path d="M7 7h10M7 17h10" opacity="0.45" />
    </>
  ),
  place: (
    <>
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
      <circle cx="12" cy="10" r="2.3" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2" />
    </>
  ),
  schedule: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  code: <path d="m8.5 8-4 4 4 4M15.5 8l4 4-4 4M13.5 5.5l-3 13" />,
  table: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
      <path d="M3.5 9.5h17M3.5 14.5h17M9.5 4.5v15M14.5 4.5v15" />
    </>
  ),
  formula: <path d="M17 5H7l5.5 7L7 19h10" />,
  alignLeft: <path d="M4 6h16M4 10h10M4 14h16M4 18h10" />,
  alignCenter: <path d="M4 6h16M7 10h10M4 14h16M7 18h10" />,
  alignRight: <path d="M4 6h16M10 10h10M4 14h16M10 18h10" />,
  alignJustify: <path d="M4 6h16M4 10h16M4 14h16M4 18h16" />,
  lineHeight: (
    <>
      <path d="M11 6h9M11 12h9M11 18h9" />
      <path d="m4 8 2-2.5L8 8M4 16l2 2.5L8 16M6 5.5v13" />
    </>
  ),
  listBullet: (
    <>
      <path d="M10 7h10M10 12h10M10 17h10" />
      <path d="M5 7h.01M5 12h.01M5 17h.01" strokeWidth="2.6" />
    </>
  ),
  listNumber: (
    <>
      <path d="M10 7h10M10 12h10M10 17h10" />
      <path d="M4.5 5.5 6 5v4M4.5 14.5c0-.8.7-1.3 1.4-1.3s1.3.5 1.3 1.2c0 1-2.7 1.8-2.7 3.1h2.8" />
    </>
  ),
  symbol: <path d="M6 19h4v-2.5A6 6 0 0 1 12 5a6 6 0 0 1 2 11.5V19h4" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  back: <path d="M15 5l-7 7 7 7" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  camera: (
    <>
      <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5Z" />
      <circle cx="12" cy="13" r="3.2" />
    </>
  ),
}

function Icon({ name }: { name: keyof typeof ICON_PATHS }) {
  return (
    <svg
      className="se-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICON_PATHS[name]}
    </svg>
  )
}

type ToolbarMenuProps = {
  id: MenuId
  openMenu: MenuId | null
  onToggle: (id: MenuId) => void
  label: string
  trigger: ReactNode
  buttonClassName?: string
  popupClassName?: string
  active?: boolean
  caret?: boolean
  children: ReactNode
}

function ToolbarMenu({
  id,
  openMenu,
  onToggle,
  label,
  trigger,
  buttonClassName = 'se-toolbar-button',
  popupClassName = '',
  active = false,
  caret = false,
  children,
}: ToolbarMenuProps) {
  const isOpen = openMenu === id

  return (
    <div className="se-menu" data-se-menu={id}>
      <button
        type="button"
        className={`${buttonClassName}${isOpen ? ' is-open' : ''}${active ? ' is-active' : ''}`}
        title={label}
        aria-label={label}
        aria-haspopup="true"
        aria-expanded={isOpen}
        onMouseDown={keepSelection}
        onClick={() => onToggle(id)}
      >
        {trigger}
        {caret ? <span className="se-caret" aria-hidden="true" /> : null}
      </button>
      {isOpen ? <div className={`se-popup ${popupClassName}`}>{children}</div> : null}
    </div>
  )
}

type DialogFrameProps = {
  title: string
  confirmLabel?: string
  confirmDisabled: boolean
  onCancel: () => void
  onConfirm: () => void
  children: ReactNode
}

function DialogFrame({ title, confirmLabel = '확인', confirmDisabled, onCancel, onConfirm, children }: DialogFrameProps) {
  return (
    <div className="se-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <form
        className="se-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onSubmit={(event) => {
          event.preventDefault()
          if (!confirmDisabled) onConfirm()
        }}
      >
        <div className="se-dialog-head">
          <strong>{title}</strong>
          <button type="button" className="se-dialog-close" onClick={onCancel} aria-label="닫기">
            <Icon name="close" />
          </button>
        </div>
        <div className="se-dialog-body">{children}</div>
        <div className="se-dialog-foot">
          <button type="button" className="se-dialog-cancel" onClick={onCancel}>
            취소
          </button>
          <button type="submit" className="se-dialog-confirm" disabled={confirmDisabled}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  )
}

function PlaceDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: (name: string, address: string) => void }) {
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')

  return (
    <DialogFrame
      title="장소"
      confirmDisabled={!name.trim()}
      onCancel={onCancel}
      onConfirm={() => onConfirm(name.trim(), address.trim())}
    >
      <label className="se-field">
        장소명
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="예: 서울중앙지방법원" maxLength={80} autoFocus />
      </label>
      <label className="se-field">
        주소
        <input
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          placeholder="예: 서울특별시 서초구 서초중앙로 157"
          maxLength={160}
        />
      </label>
      <p className="se-field-help">장소 카드를 누르면 네이버 지도 검색 결과로 연결됩니다.</p>
    </DialogFrame>
  )
}

function LinkCardDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void
  onConfirm: (url: string, title: string, summary: string) => void
}) {
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const normalizedUrl = normalizeUrl(url)

  return (
    <DialogFrame
      title="링크"
      confirmDisabled={!normalizedUrl}
      onCancel={onCancel}
      onConfirm={() => onConfirm(normalizedUrl, title.trim(), summary.trim())}
    >
      <label className="se-field">
        URL
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="URL을 입력하세요."
          maxLength={1000}
          autoFocus
        />
      </label>
      <label className="se-field">
        제목 (선택)
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="링크 제목" maxLength={120} />
      </label>
      <label className="se-field">
        설명 (선택)
        <input value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="링크 설명" maxLength={200} />
      </label>
      {url && !normalizedUrl ? <p className="se-field-error">올바른 URL을 입력해주세요.</p> : null}
    </DialogFrame>
  )
}

type ScheduleValue = {
  title: string
  startDate: string
  startTime: string
  endDate: string
  endTime: string
  place: string
  memo: string
}

function ScheduleDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: (value: ScheduleValue) => void }) {
  const [value, setValue] = useState<ScheduleValue>(() => {
    const today = toDateInputValue(new Date())
    return { title: '', startDate: today, startTime: '', endDate: today, endTime: '', place: '', memo: '' }
  })
  const update = (key: keyof ScheduleValue) => (event: ChangeEvent<HTMLInputElement>) =>
    setValue((current) => ({ ...current, [key]: event.target.value }))

  return (
    <DialogFrame
      title="일정"
      confirmDisabled={!value.title.trim() || !value.startDate}
      onCancel={onCancel}
      onConfirm={() => onConfirm(value)}
    >
      <label className="se-field">
        일정명
        <input value={value.title} onChange={update('title')} placeholder="일정명을 입력하세요." maxLength={80} autoFocus />
      </label>
      <div className="se-field-row">
        <label className="se-field">
          시작일
          <input type="date" value={value.startDate} onChange={update('startDate')} />
        </label>
        <label className="se-field">
          시간
          <input type="time" value={value.startTime} onChange={update('startTime')} />
        </label>
      </div>
      <div className="se-field-row">
        <label className="se-field">
          종료일
          <input type="date" value={value.endDate} onChange={update('endDate')} />
        </label>
        <label className="se-field">
          시간
          <input type="time" value={value.endTime} onChange={update('endTime')} />
        </label>
      </div>
      <label className="se-field">
        장소 (선택)
        <input value={value.place} onChange={update('place')} placeholder="장소" maxLength={120} />
      </label>
      <label className="se-field">
        메모 (선택)
        <input value={value.memo} onChange={update('memo')} placeholder="메모" maxLength={200} />
      </label>
    </DialogFrame>
  )
}

function FormulaDialog({
  initialSource,
  onCancel,
  onConfirm,
}: {
  initialSource: string
  onCancel: () => void
  onConfirm: (source: string) => void
}) {
  const [source, setSource] = useState(initialSource)
  const previewHtml = useMemo(() => renderFormulaHtml(source), [source])

  return (
    <DialogFrame title="수식" confirmDisabled={!source.trim()} onCancel={onCancel} onConfirm={() => onConfirm(source.trim())}>
      <label className="se-field">
        수식 입력
        <textarea
          value={source}
          onChange={(event) => setSource(event.target.value)}
          placeholder={'예: x^2 + y_1 = \\frac{a}{b}'}
          rows={3}
          maxLength={500}
          autoFocus
        />
      </label>
      <p className="se-field-help">
        ^ 위첨자, _ 아래첨자, \frac{'{a}{b}'} 분수, \sqrt{'{x}'} 루트, \alpha \pi \times \le 등의 기호를 쓸 수 있습니다.
      </p>
      <div className="se-formula-preview">
        {source.trim() ? (
          <span className="se-formula-body" dangerouslySetInnerHTML={{ __html: previewHtml }} />
        ) : (
          <span className="se-formula-preview-empty">미리보기</span>
        )}
      </div>
    </DialogFrame>
  )
}

export function CompanyPostEditor<T extends string>({
  isEditing,
  busy,
  errorMessage,
  title,
  titleMaxLength,
  onTitleChange,
  service,
  serviceMaxLength,
  serviceSuggestions,
  onServiceChange,
  visibility,
  visibilityOptions,
  onVisibilityChange,
  coverFile,
  coverUrl,
  onCoverFileChange,
  description,
  onDescriptionChange,
  uploadImage,
  onPublish,
  onClose,
}: Props<T>) {
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const documentRef = useRef<HTMLDivElement | null>(null)
  const titleRef = useRef<HTMLTextAreaElement | null>(null)
  const photoInputRef = useRef<HTMLInputElement | null>(null)
  const coverInputRef = useRef<HTMLInputElement | null>(null)
  const savedRangeRef = useRef<Range | null>(null)
  const selectedElementRef = useRef<HTMLElement | null>(null)
  const pendingFontSizeRef = useRef(DEFAULT_FONT_SIZE)
  // The body is edited in place; the prop only seeds it when the editor opens.
  const initialDescriptionRef = useRef(description)
  const draftIdRef = useRef('')

  const [openMenu, setOpenMenu] = useState<MenuId | null>(null)
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [format, setFormat] = useState<FormatState>(DEFAULT_FORMAT)
  const [isBodyEmpty, setIsBodyEmpty] = useState(() => {
    const description = initialDescriptionRef.current
    return !descriptionToPlainText(description).trim() && !/<(img|hr|table)\b/i.test(description)
  })
  const [activeComponent, setActiveComponent] = useState<ActiveComponent | null>(null)
  const [uploadCount, setUploadCount] = useState(0)
  const [toast, setToast] = useState<Toast | null>(null)
  const [drafts, setDrafts] = useState<StoredDraft[]>(readDrafts)
  const [isDirty, setIsDirty] = useState(false)
  const [lastColor, setLastColor] = useState('#ff0010')
  const [lastBackground, setLastBackground] = useState('#fff8cc')
  const [customColor, setCustomColor] = useState('#0078cb')
  const [stickerGroup, setStickerGroup] = useState(0)
  const [tableHover, setTableHover] = useState({ rows: 3, cols: 3 })
  const [linkInput, setLinkInput] = useState('')

  const coverPreviewUrl = useMemo(() => (coverFile ? URL.createObjectURL(coverFile) : ''), [coverFile])
  const coverSrc = coverPreviewUrl || coverUrl
  const selectedVisibility = visibilityOptions.find((option) => option.value === visibility)

  useLayoutEffect(() => {
    const body = bodyRef.current

    if (!body) return

    body.innerHTML = toEditorHtml(initialDescriptionRef.current)
    prepareComponents(body)
    ensureParagraphsAroundComponents(body)
    document.execCommand('defaultParagraphSeparator', false, 'p')
    ensureRichTextFonts()
  }, [])

  useEffect(() => () => {
    if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl)
  }, [coverPreviewUrl])

  useLayoutEffect(() => {
    const titleElement = titleRef.current

    if (titleElement) {
      titleElement.style.height = 'auto'
      titleElement.style.height = `${titleElement.scrollHeight}px`
    }
  }, [title])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  useEffect(() => {
    const handleSelectionChange = () => {
      const body = bodyRef.current
      const selection = window.getSelection()

      if (!body || !selection || selection.rangeCount === 0) return

      const range = selection.getRangeAt(0)

      if (!body.contains(range.commonAncestorContainer)) return

      savedRangeRef.current = range.cloneRange()
      setFormat(readFormatState(body, range))

      // Show the component toolbar while the caret is inside a table cell, quote, etc.
      const component = getElement(range.startContainer)?.closest(ISLAND_SELECTOR)?.closest<HTMLElement>('.se-component') ?? null
      const current = selectedElementRef.current

      if (component && component !== current && documentRef.current) {
        current?.classList.remove('is-selected')
        selectedElementRef.current = component
        setActiveComponent(measureComponent(component, documentRef.current, false))
      } else if (!component && current && !current.classList.contains('is-selected')) {
        selectedElementRef.current = null
        setActiveComponent(null)
      }
    }

    document.addEventListener('selectionchange', handleSelectionChange)
    return () => document.removeEventListener('selectionchange', handleSelectionChange)
  }, [])

  useEffect(() => {
    if (!openMenu) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null

      if (!target?.closest(`[data-se-menu="${openMenu}"]`)) {
        setOpenMenu(null)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [openMenu])

  useEffect(() => {
    if (!toast) return

    const timer = window.setTimeout(() => setToast(null), 2600)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (!isDirty) return

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isDirty])

  useEffect(() => {
    const handleResize = () => {
      const element = selectedElementRef.current
      const documentElement = documentRef.current

      if (!element || !documentElement || !element.isConnected) return

      setActiveComponent(measureComponent(element, documentElement, element.classList.contains('is-selected')))
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const showToast = (message: string, tone: Toast['tone'] = 'info') => setToast({ message, tone })

  const markDirty = () => setIsDirty(true)

  const emitChange = () => {
    const body = bodyRef.current

    if (!body) return

    onDescriptionChange(serializeEditorBody(body))
    setIsBodyEmpty(isBodyVisuallyEmpty(body))
  }

  const selectComponent = (element: HTMLElement | null, selected = true) => {
    const body = bodyRef.current
    body?.querySelectorAll('.is-selected').forEach((node) => node.classList.remove('is-selected'))
    selectedElementRef.current = element

    if (!element || !documentRef.current) {
      setActiveComponent(null)
      return
    }

    if (selected) {
      element.classList.add('is-selected')
    }

    setActiveComponent(measureComponent(element, documentRef.current, selected))
  }

  const refreshActiveComponent = () => {
    const element = selectedElementRef.current

    if (!element) return

    if (!element.isConnected) {
      selectComponent(null)
      return
    }

    selectComponent(element, element.classList.contains('is-selected'))
  }

  const afterChange = () => {
    const body = bodyRef.current

    if (!body) return

    normalizeEditorDom(body, pendingFontSizeRef.current)
    emitChange()
    refreshActiveComponent()
    markDirty()

    const selection = window.getSelection()

    if (selection?.rangeCount && body.contains(selection.getRangeAt(0).commonAncestorContainer)) {
      setFormat(readFormatState(body, selection.getRangeAt(0)))
    }
  }

  const restoreSelection = () => {
    const body = bodyRef.current

    if (!body) return null

    let range = savedRangeRef.current

    if (!range || !body.contains(range.commonAncestorContainer)) {
      range = document.createRange()
      range.selectNodeContents(body.lastElementChild ?? body)
      range.collapse(false)
    }

    ;(getEditingHost(range.startContainer) ?? body).focus({ preventScroll: true })
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    return range
  }

  const runCommand = (command: string, value?: string) => {
    restoreSelection()
    document.execCommand('styleWithCSS', false, 'true')
    document.execCommand(command, false, value)
    afterChange()
  }

  const toggleMenu = (id: MenuId) => {
    setOpenMenu((current) => (current === id ? null : id))
  }

  const closeMenuAnd = (action: () => void) => () => {
    setOpenMenu(null)
    action()
  }

  const getSelectedBlocks = () => {
    const body = bodyRef.current
    const range = savedRangeRef.current

    if (!body || !range) return []

    return Array.from(body.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement && !isComponent(child) && range.intersectsNode(child),
    )
  }

  const applyTextStyle = (style: BlockStyle) => {
    const body = bodyRef.current
    const blocks = getSelectedBlocks().filter((block) => ['P', 'DIV', 'H2', 'H3', 'H4', 'BLOCKQUOTE'].includes(block.tagName))

    if (!body || !blocks.length) return

    const replacements = blocks.map((block) => {
      const replacement = document.createElement(style)
      const blockStyle = block.getAttribute('style')

      if (blockStyle) replacement.setAttribute('style', blockStyle)
      replacement.append(...Array.from(block.childNodes))
      if (!replacement.childNodes.length) replacement.append(document.createElement('br'))
      block.replaceWith(replacement)
      return replacement
    })

    const range = document.createRange()
    range.setStart(replacements[0], 0)
    range.setEnd(replacements[replacements.length - 1], replacements[replacements.length - 1].childNodes.length)
    body.focus({ preventScroll: true })
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
    savedRangeRef.current = range.cloneRange()
    afterChange()
  }

  const applyFontSize = (size: number) => {
    restoreSelection()
    pendingFontSizeRef.current = size
    document.execCommand('styleWithCSS', false, 'false')
    document.execCommand('fontSize', false, '7')
    document.execCommand('styleWithCSS', false, 'true')
    afterChange()
  }

  const applyLineHeight = (value: string) => {
    getSelectedBlocks().forEach((block) => {
      block.style.lineHeight = value
    })
    restoreSelection()
    afterChange()
  }

  const applyColor = (color: string) => {
    setLastColor(color)
    runCommand('foreColor', color)
  }

  const applyBackground = (color: string) => {
    if (color !== 'transparent') setLastBackground(color)
    restoreSelection()
    document.execCommand('styleWithCSS', false, 'true')

    if (!document.execCommand('hiliteColor', false, color)) {
      document.execCommand('backColor', false, color)
    }

    afterChange()
  }

  const applyLink = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const url = normalizeUrl(linkInput)

    if (!url) {
      showToast('올바른 URL을 입력해주세요.', 'error')
      return
    }

    setOpenMenu(null)
    setLinkInput('')
    const range = restoreSelection()

    if (range?.collapsed) {
      document.execCommand('insertHTML', false, `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>&nbsp;`)
      afterChange()
      return
    }

    runCommand('createLink', url)
  }

  const removeComponent = (element: HTMLElement) => {
    const next = element.nextElementSibling instanceof HTMLElement ? element.nextElementSibling : null
    element.remove()
    selectComponent(null)

    const body = bodyRef.current

    if (body) {
      ensureParagraphsAroundComponents(body)
      const target = next?.isConnected ? next : body.lastElementChild
      if (target instanceof HTMLElement && !isComponent(target)) placeCaret(target)
    }

    afterChange()
  }

  const insertComponent = (element: HTMLElement, focusSelector?: string) => {
    const body = bodyRef.current

    if (!body) return

    prepareComponents(element)
    const range = savedRangeRef.current
    let anchor =
      selectedElementRef.current?.isConnected
        ? selectedElementRef.current
        : range && body.contains(range.startContainer)
          ? getTopLevelBlock(body, range.startContainer)
          : null

    if (anchor && anchor.parentElement !== body) anchor = null

    if (anchor && isEmptyTextBlock(anchor)) {
      anchor.replaceWith(element)
    } else if (anchor) {
      anchor.after(element)
    } else {
      body.append(element)
    }

    let next = element.nextElementSibling

    if (!(next instanceof HTMLElement) || isComponent(next)) {
      next = createEmptyParagraph()
      element.after(next)
    }

    selectComponent(null)
    const focusTarget = focusSelector ? element.querySelector<HTMLElement>(focusSelector) : null
    placeCaret(focusTarget ?? (next as HTMLElement))

    const selection = window.getSelection()
    if (selection?.rangeCount) savedRangeRef.current = selection.getRangeAt(0).cloneRange()

    afterChange()
    element.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }

  const handlePhotoFiles = async (files: File[]) => {
    const images = files.filter((file) => file.type.startsWith('image/'))

    if (!images.length) {
      showToast('이미지 파일만 올릴 수 있습니다.', 'error')
      return
    }

    setUploadCount((count) => count + images.length)

    for (const file of images) {
      try {
        const url = await uploadImage(file)
        insertComponent(
          createFromHtml(
            `<figure class="se-component se-image se-image-size-full"><img src="${escapeHtml(url)}" alt=""><figcaption class="se-caption"></figcaption></figure>`,
          ),
        )
      } catch (error) {
        console.error(error)
        showToast(error instanceof Error && error.message ? error.message : '사진 업로드에 실패했습니다.', 'error')
      } finally {
        setUploadCount((count) => count - 1)
      }
    }
  }

  const handlePhotoInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''

    if (files.length) void handlePhotoFiles(files)
  }

  const handleCoverInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null
    event.target.value = ''

    if (!file) return

    if (!file.type.startsWith('image/')) {
      showToast('이미지 파일만 대표 이미지로 쓸 수 있습니다.', 'error')
      return
    }

    onCoverFileChange(file)
    markDirty()
  }

  const insertSticker = (emoji: string) => {
    setOpenMenu(null)
    insertComponent(createFromHtml(`<div class="se-component se-sticker"><span class="se-sticker-item">${escapeHtml(emoji)}</span></div>`))
  }

  const insertQuote = (style: string) => {
    setOpenMenu(null)
    insertComponent(
      createFromHtml(
        `<div class="se-component se-quote se-quote-style-${style}"><blockquote class="se-quote-body"><div class="se-quote-text"></div><cite class="se-quote-cite"></cite></blockquote></div>`,
      ),
      '.se-quote-text',
    )
  }

  const insertDivider = (style: string) => {
    setOpenMenu(null)
    insertComponent(createFromHtml(`<div class="se-component se-hr se-hr-style-${style}"><hr></div>`))
  }

  const insertPlace = (name: string, address: string) => {
    setDialog(null)
    const mapUrl = `https://map.naver.com/p/search/${encodeURIComponent([name, address].filter(Boolean).join(' '))}`
    insertComponent(
      createFromHtml(
        `<div class="se-component se-place"><a class="se-place-link" href="${escapeHtml(mapUrl)}"><span class="se-place-icon"></span><span class="se-place-info"><strong class="se-place-name">${escapeHtml(
          name,
        )}</strong>${address ? `<span class="se-place-address">${escapeHtml(address)}</span>` : ''}</span><span class="se-place-map">지도 보기</span></a></div>`,
      ),
    )
  }

  const insertLinkCard = (url: string, linkTitle: string, summary: string) => {
    setDialog(null)
    let domain = url

    try {
      domain = new URL(url).hostname || url
    } catch {
      // normalizeUrl already validated the URL.
    }

    insertComponent(
      createFromHtml(
        `<div class="se-component se-oglink"><a class="se-oglink-link" href="${escapeHtml(url)}"><span class="se-oglink-info"><strong class="se-oglink-title">${escapeHtml(
          linkTitle || domain,
        )}</strong>${summary ? `<span class="se-oglink-summary">${escapeHtml(summary)}</span>` : ''}<span class="se-oglink-url">${escapeHtml(
          domain,
        )}</span></span><span class="se-oglink-thumb"></span></a></div>`,
      ),
    )
  }

  const insertSchedule = (value: ScheduleValue) => {
    setDialog(null)
    const [, month, day] = value.startDate.split('-').map(Number)
    const start = formatScheduleDate(value.startDate, value.startTime)
    const end = value.endDate ? formatScheduleDate(value.endDate, value.endTime) : ''
    const period = end && end !== start ? `${start} ~ ${end}` : start
    insertComponent(
      createFromHtml(
        `<div class="se-component se-schedule"><div class="se-schedule-date"><span class="se-schedule-month">${month}월</span><strong class="se-schedule-day">${day}</strong></div><div class="se-schedule-info"><strong class="se-schedule-title">${escapeHtml(
          value.title.trim(),
        )}</strong><span class="se-schedule-time">${escapeHtml(period)}</span>${
          value.place.trim() ? `<span class="se-schedule-place">${escapeHtml(value.place.trim())}</span>` : ''
        }${value.memo.trim() ? `<span class="se-schedule-memo">${escapeHtml(value.memo.trim())}</span>` : ''}</div></div>`,
      ),
    )
  }

  const insertCode = () => {
    insertComponent(
      createFromHtml('<div class="se-component se-code"><pre class="se-code-source"></pre></div>'),
      '.se-code-source',
    )
  }

  const insertTable = (rows: number, cols: number) => {
    setOpenMenu(null)
    const row = `<tr>${'<td></td>'.repeat(cols)}</tr>`
    insertComponent(
      createFromHtml(`<div class="se-component se-table"><table class="se-table-content"><tbody>${row.repeat(rows)}</tbody></table></div>`),
      'td',
    )
  }

  const saveFormula = (source: string, target: HTMLElement | null) => {
    setDialog(null)
    const element = createFromHtml(
      `<div class="se-component se-formula" data-se-source="${escapeHtml(source)}"><span class="se-formula-body">${renderFormulaHtml(
        source,
      )}</span></div>`,
    )

    if (target?.isConnected) {
      prepareComponents(element)
      target.replaceWith(element)
      selectComponent(element)
      afterChange()
      return
    }

    insertComponent(element)
  }

  const getActiveCell = () => {
    const element = getElement(savedRangeRef.current?.startContainer ?? null)
    const cell = element?.closest<HTMLTableCellElement>('td, th')

    if (cell && selectedElementRef.current?.contains(cell)) return cell

    return selectedElementRef.current?.querySelector<HTMLTableCellElement>('td, th') ?? null
  }

  const createCell = (row: HTMLTableRowElement, index: number) => {
    const cell = row.insertCell(index)
    cell.contentEditable = 'true'
    return cell
  }

  const editTable = (action: 'addRow' | 'addColumn' | 'deleteRow' | 'deleteColumn') => {
    const component = selectedElementRef.current
    const cell = getActiveCell()
    const table = component?.querySelector('table')

    if (!component || !cell || !table) return

    const row = cell.parentElement as HTMLTableRowElement
    const columnIndex = cell.cellIndex
    let focusCell: HTMLElement | null = null

    if (action === 'addRow') {
      const newRow = table.insertRow(row.rowIndex + 1)
      Array.from(row.cells).forEach((_, index) => createCell(newRow, index))
      focusCell = newRow.cells[columnIndex] ?? null
    } else if (action === 'addColumn') {
      Array.from(table.rows).forEach((tableRow) => createCell(tableRow, Math.min(columnIndex + 1, tableRow.cells.length)))
      focusCell = row.cells[columnIndex + 1] ?? null
    } else if (action === 'deleteRow') {
      if (table.rows.length <= 1) {
        removeComponent(component)
        return
      }

      const nextRow = table.rows[row.rowIndex + 1] ?? table.rows[row.rowIndex - 1]
      row.remove()
      focusCell = nextRow?.cells[Math.min(columnIndex, nextRow.cells.length - 1)] ?? null
    } else {
      if (row.cells.length <= 1) {
        removeComponent(component)
        return
      }

      Array.from(table.rows).forEach((tableRow) => {
        if (tableRow.cells[columnIndex]) tableRow.deleteCell(columnIndex)
      })
      focusCell = row.cells[Math.min(columnIndex, row.cells.length - 1)] ?? null
    }

    if (focusCell) placeCaret(focusCell)
    afterChange()
  }

  const applyComponentVariant = (prefix: string, variant: string) => {
    const element = selectedElementRef.current

    if (!element) return

    setVariantClass(element, prefix, variant)
    afterChange()
  }

  const handleBodyInput = (event: FormEvent<HTMLDivElement>) => {
    const body = bodyRef.current

    if (!body) return

    // Rewriting the DOM mid-composition breaks Korean IME input.
    if (!(event.nativeEvent as InputEvent).isComposing) {
      normalizeEditorDom(body, pendingFontSizeRef.current)
    }

    emitChange()
    refreshActiveComponent()
    markDirty()
  }

  const handleBodyClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const body = bodyRef.current
    const target = event.target instanceof HTMLElement ? event.target : null
    const component = target?.closest<HTMLElement>('.se-component')

    if (!body || !component || !body.contains(component)) {
      if (selectedElementRef.current) selectComponent(null)
      return
    }

    const inIsland = Boolean(target?.closest(ISLAND_SELECTOR))

    if (inIsland) {
      selectComponent(component, false)
      return
    }

    // Links inside cards must not navigate away from the editor.
    if (target?.closest('a')) event.preventDefault()

    selectComponent(component, true)
    component.tabIndex = -1
    component.focus({ preventScroll: true })
    window.getSelection()?.removeAllRanges()
  }

  const handleBodyKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const body = bodyRef.current
    const selected = selectedElementRef.current

    if (!body) return

    if (selected?.classList.contains('is-selected')) {
      if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault()
        removeComponent(selected)
        return
      }

      if (event.key === 'Enter' || event.key === 'ArrowDown' || event.key === 'ArrowRight') {
        event.preventDefault()
        let next = selected.nextElementSibling

        if (event.key === 'Enter' || !(next instanceof HTMLElement) || isComponent(next)) {
          next = createEmptyParagraph()
          selected.after(next)
        }

        selectComponent(null)
        placeCaret(next as HTMLElement)
        afterChange()
        return
      }

      if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        event.preventDefault()
        const previous = selected.previousElementSibling
        selectComponent(null)

        if (previous instanceof HTMLElement && !isComponent(previous)) {
          placeCaret(previous, true)
        } else {
          const paragraph = createEmptyParagraph()
          selected.before(paragraph)
          placeCaret(paragraph)
          afterChange()
        }
        return
      }

      if (!event.ctrlKey && !event.metaKey) event.preventDefault()
      return
    }

    const host = event.target instanceof HTMLElement ? event.target : null

    if (host && host !== body && host.matches(ISLAND_SELECTOR)) {
      if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
        event.preventDefault()
        document.execCommand('insertLineBreak')
        return
      }

      if (event.key === 'Tab' && host.matches('td, th')) {
        event.preventDefault()
        const cells = Array.from(host.closest('table')?.querySelectorAll<HTMLElement>('td, th') ?? [])
        const nextCell = cells[cells.indexOf(host) + (event.shiftKey ? -1 : 1)]
        if (nextCell) placeCaret(nextCell)
      }
    }
  }

  const handleBodyPaste = (event: ReactClipboardEvent<HTMLDivElement>) => {
    const body = bodyRef.current
    const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'))

    if (!body) return

    if (files.length) {
      event.preventDefault()
      void handlePhotoFiles(files)
      return
    }

    const host = getEditingHost(window.getSelection()?.anchorNode ?? null)

    if (host && host !== body) {
      event.preventDefault()
      document.execCommand('insertText', false, event.clipboardData.getData('text/plain'))
      return
    }

    const html = event.clipboardData.getData('text/html')

    if (html) {
      event.preventDefault()
      document.execCommand('insertHTML', false, sanitizeRichHtml(html))
      prepareComponents(body)
      afterChange()
    }
  }

  const handleBodyDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (event.dataTransfer.types.includes('Files')) event.preventDefault()
  }

  const handleBodyDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    const body = bodyRef.current
    const files = Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith('image/'))

    if (!body || !files.length) return

    event.preventDefault()
    const pointRange = (
      document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }
    ).caretRangeFromPoint?.(event.clientX, event.clientY)

    if (pointRange && body.contains(pointRange.startContainer)) {
      savedRangeRef.current = pointRange
      selectComponent(null)
    }

    void handlePhotoFiles(files)
  }

  const handleTitleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    onTitleChange(event.target.value.replace(/[\r\n]+/g, ' '))
    markDirty()
  }

  const handleTitleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return

    event.preventDefault()
    const first = bodyRef.current?.firstElementChild

    if (first instanceof HTMLElement && !isComponent(first)) {
      placeCaret(first)
    } else if (bodyRef.current) {
      const paragraph = createEmptyParagraph()
      bodyRef.current.prepend(paragraph)
      placeCaret(paragraph)
    }
  }

  const saveDraft = () => {
    const body = bodyRef.current
    const html = body ? serializeEditorBody(body) : ''

    if (!title.trim() && !html) {
      showToast('저장할 내용이 없습니다.', 'error')
      return
    }

    if (!draftIdRef.current) {
      draftIdRef.current = `draft-${Date.now()}`
    }

    const draft: StoredDraft = { id: draftIdRef.current, savedAt: Date.now(), title, service, visibility, html }
    const nextDrafts = [draft, ...drafts.filter((item) => item.id !== draft.id)].slice(0, MAX_DRAFTS)

    if (!writeDrafts(nextDrafts)) {
      showToast('브라우저 저장소를 사용할 수 없어 임시저장하지 못했습니다.', 'error')
      return
    }

    setDrafts(nextDrafts)
    setIsDirty(false)
    showToast('임시저장 되었습니다. (대표 이미지는 저장되지 않습니다)')
  }

  const loadDraft = (draft: StoredDraft) => {
    const body = bodyRef.current

    if (!body) return

    if (isDirty && !window.confirm('작성 중인 내용을 임시저장 글로 바꿀까요?')) return

    body.innerHTML = toEditorHtml(draft.html)
    prepareComponents(body)
    ensureParagraphsAroundComponents(body)
    selectComponent(null)
    savedRangeRef.current = null
    draftIdRef.current = draft.id
    onTitleChange(draft.title)
    onServiceChange(draft.service)

    const draftVisibility = visibilityOptions.find((option) => option.value === draft.visibility)
    if (draftVisibility) onVisibilityChange(draftVisibility.value)

    emitChange()
    setIsDirty(false)
    setOpenMenu(null)
    showToast('임시저장 글을 불러왔습니다.')
  }

  const deleteDraft = (id: string) => {
    const nextDrafts = drafts.filter((draft) => draft.id !== id)
    writeDrafts(nextDrafts)
    setDrafts(nextDrafts)

    if (draftIdRef.current === id) draftIdRef.current = ''
  }

  const handleClose = () => {
    if (busy) return

    if (isDirty && !window.confirm('작성 중인 내용이 저장되지 않았습니다. 글쓰기를 나갈까요?')) return

    onClose()
  }

  const handlePublishSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (uploadCount > 0) {
      event.preventDefault()
      showToast('사진 업로드가 끝난 뒤 발행해주세요.', 'error')
      return
    }

    onPublish(event)
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return

      if (dialog) {
        setDialog(null)
      } else if (openMenu) {
        setOpenMenu(null)
      } else if (selectedElementRef.current) {
        selectedElementRef.current.classList.remove('is-selected')
        selectedElementRef.current = null
        setActiveComponent(null)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [dialog, openMenu])

  const alignment = ALIGNMENTS.find((item) => item.value === format.align) ?? ALIGNMENTS[0]
  const alignIcon = { left: 'alignLeft', center: 'alignCenter', right: 'alignRight', justify: 'alignJustify' }[format.align]

  const componentToolbar = activeComponent ? (
    <div
      className="se-component-toolbar"
      style={{ top: Math.max(activeComponent.top - 46, 0), right: activeComponent.right }}
      onMouseDown={keepSelection}
    >
      {activeComponent.kind === 'image'
        ? IMAGE_SIZES.map((size) => (
            <button
              type="button"
              key={size.value}
              className={activeComponent.variant === size.value ? 'is-active' : ''}
              onClick={() => applyComponentVariant('se-image-size-', size.value)}
            >
              {size.label}
            </button>
          ))
        : null}
      {activeComponent.kind === 'quote'
        ? QUOTE_STYLES.map((style) => (
            <button type="button" key={style.value} onClick={() => applyComponentVariant('se-quote-style-', style.value)}>
              {style.label}
            </button>
          ))
        : null}
      {activeComponent.kind === 'divider'
        ? DIVIDER_STYLES.map((style, index) => (
            <button type="button" key={style} onClick={() => applyComponentVariant('se-hr-style-', style)}>
              {index + 1}
            </button>
          ))
        : null}
      {activeComponent.kind === 'table' ? (
        <>
          <button type="button" onClick={() => editTable('addRow')}>
            행 추가
          </button>
          <button type="button" onClick={() => editTable('addColumn')}>
            열 추가
          </button>
          <button type="button" onClick={() => editTable('deleteRow')}>
            행 삭제
          </button>
          <button type="button" onClick={() => editTable('deleteColumn')}>
            열 삭제
          </button>
        </>
      ) : null}
      {activeComponent.kind === 'formula' ? (
        <button
          type="button"
          onClick={() => {
            const target = selectedElementRef.current
            setDialog({ kind: 'formula', target, source: target?.dataset.seSource ?? '' })
          }}
        >
          편집
        </button>
      ) : null}
      <span className="se-component-toolbar-divider" aria-hidden="true" />
      <button
        type="button"
        className="se-component-toolbar-delete"
        onClick={() => {
          const element = selectedElementRef.current
          if (element) removeComponent(element)
        }}
      >
        삭제
      </button>
    </div>
  ) : null

  return createPortal(
    <div className="se-editor-root" role="dialog" aria-modal="true" aria-label={isEditing ? '사기업체 글 수정' : '사기업체 글쓰기'}>
      <header className="se-header">
        <div className="se-header-left">
          <button type="button" className="se-header-back" onClick={handleClose} aria-label="글쓰기 나가기" disabled={busy}>
            <Icon name="back" />
          </button>
          <strong className="se-header-title">
            사기업체 <span>{isEditing ? '글 수정' : '글쓰기'}</span>
          </strong>
        </div>
        <div className="se-header-right">
          <div className="se-draft" data-se-menu="drafts">
            <button type="button" className="se-draft-save" onClick={saveDraft} disabled={busy}>
              저장
            </button>
            <button
              type="button"
              className={`se-draft-count${openMenu === 'drafts' ? ' is-open' : ''}`}
              onClick={() => toggleMenu('drafts')}
              aria-label={`임시저장 글 ${drafts.length}개`}
            >
              {drafts.length}
            </button>
            {openMenu === 'drafts' ? (
              <div className="se-popup se-draft-layer">
                <strong className="se-draft-layer-title">임시저장 글</strong>
                {drafts.length ? (
                  <ul>
                    {drafts.map((draft) => (
                      <li key={draft.id}>
                        <button type="button" className="se-draft-item" onClick={() => loadDraft(draft)}>
                          <span>{draft.title || '(제목 없음)'}</span>
                          <small>{formatDraftTime(draft.savedAt)}</small>
                        </button>
                        <button type="button" className="se-draft-delete" onClick={() => deleteDraft(draft.id)} aria-label="임시저장 글 삭제">
                          <Icon name="close" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="se-draft-empty">임시저장된 글이 없습니다.</p>
                )}
              </div>
            ) : null}
          </div>
          <div className="se-publish" data-se-menu="publish">
            <button
              type="button"
              className={`se-publish-button${openMenu === 'publish' ? ' is-open' : ''}`}
              onClick={() => toggleMenu('publish')}
              disabled={busy}
            >
              {isEditing ? '수정' : '발행'}
              <span className="se-caret" aria-hidden="true" />
            </button>
            {openMenu === 'publish' ? (
              <form className="se-popup se-publish-layer" onSubmit={handlePublishSubmit}>
                <div className="se-publish-row">
                  <span className="se-publish-label">카테고리</span>
                  <div className="se-publish-control">
                    <input
                      type="text"
                      list="se-service-suggestions"
                      value={service}
                      onChange={(event) => {
                        onServiceChange(event.target.value)
                        markDirty()
                      }}
                      placeholder="유형 (예: 코인 리딩방 사기)"
                      maxLength={serviceMaxLength}
                      required
                    />
                    <datalist id="se-service-suggestions">
                      {serviceSuggestions.map((suggestion) => (
                        <option value={suggestion} key={suggestion} />
                      ))}
                    </datalist>
                  </div>
                </div>
                <div className="se-publish-row">
                  <span className="se-publish-label">공개 설정</span>
                  <div className="se-publish-control se-publish-radios">
                    {visibilityOptions.map((option) => (
                      <label className="se-radio" key={option.value}>
                        <input
                          type="radio"
                          name="se-visibility"
                          value={option.value}
                          checked={visibility === option.value}
                          onChange={() => {
                            onVisibilityChange(option.value)
                            markDirty()
                          }}
                        />
                        <span>{option.label}</span>
                      </label>
                    ))}
                    {selectedVisibility ? <small className="se-publish-help">{selectedVisibility.description}</small> : null}
                  </div>
                </div>
                <div className="se-publish-row">
                  <span className="se-publish-label">대표 이미지</span>
                  <div className="se-publish-control se-publish-cover">
                    {coverSrc ? (
                      <img src={coverSrc} alt="대표 이미지 미리보기" />
                    ) : (
                      <span className="se-publish-cover-empty">없음</span>
                    )}
                    <button type="button" onClick={() => coverInputRef.current?.click()}>
                      {coverSrc ? '변경' : '추가'}
                    </button>
                    {!coverSrc ? <small className="se-publish-help is-warning">목록 썸네일로 쓰일 이미지가 필요합니다.</small> : null}
                  </div>
                </div>
                <div className="se-publish-row se-publish-row-preview">
                  <CompanyContentPreview
                    name={title}
                    service={service}
                    description={description}
                  />
                </div>
                {errorMessage ? <p className="se-publish-error">{errorMessage}</p> : null}
                <div className="se-publish-foot">
                  <button type="submit" className="se-publish-submit" disabled={busy || uploadCount > 0}>
                    <Icon name="check" />
                    {busy ? (isEditing ? '수정 중...' : '발행 중...') : isEditing ? '수정' : '발행'}
                  </button>
                </div>
              </form>
            ) : null}
          </div>
        </div>
      </header>

      <div className="se-toolbar-wrap">
        <div className="se-component-bar" role="toolbar" aria-label="컴포넌트 추가">
          <button
            type="button"
            className="se-component-button"
            onMouseDown={keepSelection}
            onClick={() => photoInputRef.current?.click()}
          >
            <Icon name="photo" />
            <span>사진</span>
          </button>
          <ToolbarMenu
            id="sticker"
            openMenu={openMenu}
            onToggle={toggleMenu}
            label="스티커"
            buttonClassName="se-component-button"
            popupClassName="se-sticker-layer"
            trigger={
              <>
                <Icon name="sticker" />
                <span>스티커</span>
              </>
            }
          >
            <div className="se-sticker-tabs" role="tablist">
              {STICKER_GROUPS.map((group, index) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={stickerGroup === index}
                  className={stickerGroup === index ? 'is-active' : ''}
                  key={group.label}
                  onMouseDown={keepSelection}
                  onClick={() => setStickerGroup(index)}
                >
                  {group.label}
                </button>
              ))}
            </div>
            <div className="se-sticker-grid">
              {STICKER_GROUPS[stickerGroup].items.map((emoji) => (
                <button type="button" key={emoji} onMouseDown={keepSelection} onClick={() => insertSticker(emoji)} aria-label={`스티커 ${emoji}`}>
                  {emoji}
                </button>
              ))}
            </div>
          </ToolbarMenu>
          <ToolbarMenu
            id="quote"
            openMenu={openMenu}
            onToggle={toggleMenu}
            label="인용구"
            buttonClassName="se-component-button"
            popupClassName="se-style-layer"
            trigger={
              <>
                <Icon name="quote" />
                <span>인용구</span>
              </>
            }
          >
            {QUOTE_STYLES.map((style) => (
              <button
                type="button"
                className="se-style-option"
                key={style.value}
                onMouseDown={keepSelection}
                onClick={() => insertQuote(style.value)}
              >
                <span className={`se-quote-sample se-quote-sample-${style.value}`} aria-hidden="true">
                  인용구
                </span>
                <span>{style.label}</span>
              </button>
            ))}
          </ToolbarMenu>
          <ToolbarMenu
            id="divider"
            openMenu={openMenu}
            onToggle={toggleMenu}
            label="구분선"
            buttonClassName="se-component-button"
            popupClassName="se-style-layer se-divider-layer"
            trigger={
              <>
                <Icon name="divider" />
                <span>구분선</span>
              </>
            }
          >
            {DIVIDER_STYLES.map((style, index) => (
              <button
                type="button"
                className="se-style-option"
                key={style}
                onMouseDown={keepSelection}
                onClick={() => insertDivider(style)}
                aria-label={`구분선 ${index + 1}`}
              >
                <span className={`se-hr se-hr-style-${style} se-hr-sample`} aria-hidden="true">
                  <hr />
                </span>
              </button>
            ))}
          </ToolbarMenu>
          <button type="button" className="se-component-button" onMouseDown={keepSelection} onClick={() => setDialog({ kind: 'place' })}>
            <Icon name="place" />
            <span>장소</span>
          </button>
          <button type="button" className="se-component-button" onMouseDown={keepSelection} onClick={() => setDialog({ kind: 'oglink' })}>
            <Icon name="link" />
            <span>링크</span>
          </button>
          <button type="button" className="se-component-button" onMouseDown={keepSelection} onClick={() => setDialog({ kind: 'schedule' })}>
            <Icon name="schedule" />
            <span>일정</span>
          </button>
          <button type="button" className="se-component-button" onMouseDown={keepSelection} onClick={insertCode}>
            <Icon name="code" />
            <span>소스코드</span>
          </button>
          <ToolbarMenu
            id="table"
            openMenu={openMenu}
            onToggle={toggleMenu}
            label="표"
            buttonClassName="se-component-button"
            popupClassName="se-table-layer"
            trigger={
              <>
                <Icon name="table" />
                <span>표</span>
              </>
            }
          >
            <div className="se-table-picker" onMouseLeave={() => setTableHover({ rows: 3, cols: 3 })}>
              {Array.from({ length: TABLE_PICKER_SIZE * TABLE_PICKER_SIZE }, (_, index) => {
                const rows = Math.floor(index / TABLE_PICKER_SIZE) + 1
                const cols = (index % TABLE_PICKER_SIZE) + 1
                return (
                  <button
                    type="button"
                    key={index}
                    className={rows <= tableHover.rows && cols <= tableHover.cols ? 'is-active' : ''}
                    onMouseEnter={() => setTableHover({ rows, cols })}
                    onMouseDown={keepSelection}
                    onClick={() => insertTable(rows, cols)}
                    aria-label={`${rows}행 ${cols}열 표`}
                  />
                )
              })}
            </div>
            <span className="se-table-picker-label">
              {tableHover.rows} × {tableHover.cols}
            </span>
          </ToolbarMenu>
          <button
            type="button"
            className="se-component-button"
            onMouseDown={keepSelection}
            onClick={() => setDialog({ kind: 'formula', target: null, source: '' })}
          >
            <Icon name="formula" />
            <span>수식</span>
          </button>
        </div>

        <div className="se-property-bar" role="toolbar" aria-label="글자 서식">
          <ToolbarMenu
            id="textStyle"
            openMenu={openMenu}
            onToggle={toggleMenu}
            label="문단 스타일"
            buttonClassName="se-toolbar-button se-toolbar-select se-toolbar-select-style"
            popupClassName="se-list-layer"
            caret
            trigger={<span>{TEXT_STYLES.find((style) => style.value === format.block)?.label ?? '본문'}</span>}
          >
            {TEXT_STYLES.map((style) => (
              <button
                type="button"
                key={style.value}
                className={`se-list-option se-text-style-${style.value}${format.block === style.value ? ' is-active' : ''}`}
                onMouseDown={keepSelection}
                onClick={closeMenuAnd(() => applyTextStyle(style.value))}
              >
                {style.label}
              </button>
            ))}
          </ToolbarMenu>
          <span className="se-toolbar-divider" aria-hidden="true" />
          <ToolbarMenu
            id="font"
            openMenu={openMenu}
            onToggle={toggleMenu}
            label="글꼴"
            buttonClassName="se-toolbar-button se-toolbar-select se-toolbar-select-font"
            popupClassName="se-list-layer"
            caret
            trigger={<span>{format.fontLabel}</span>}
          >
            {RICH_TEXT_FONTS.map((font) => (
              <button
                type="button"
                key={font.label}
                className={`se-list-option${format.fontLabel === font.label ? ' is-active' : ''}`}
                style={{ fontFamily: font.value }}
                onMouseDown={keepSelection}
                onClick={closeMenuAnd(() => runCommand('fontName', font.value))}
              >
                {font.label}
              </button>
            ))}
          </ToolbarMenu>
          <ToolbarMenu
            id="size"
            openMenu={openMenu}
            onToggle={toggleMenu}
            label="글자 크기"
            buttonClassName="se-toolbar-button se-toolbar-select se-toolbar-select-size"
            popupClassName="se-list-layer se-size-layer"
            caret
            trigger={<span>{format.fontSize}</span>}
          >
            {FONT_SIZES.map((size) => (
              <button
                type="button"
                key={size}
                className={`se-list-option${format.fontSize === size ? ' is-active' : ''}`}
                onMouseDown={keepSelection}
                onClick={closeMenuAnd(() => applyFontSize(size))}
              >
                {size}
              </button>
            ))}
          </ToolbarMenu>
          <span className="se-toolbar-divider" aria-hidden="true" />
          <button
            type="button"
            className={`se-toolbar-button${format.bold ? ' is-active' : ''}`}
            title="굵게"
            aria-label="굵게"
            aria-pressed={format.bold}
            onMouseDown={keepSelection}
            onClick={() => runCommand('bold')}
          >
            <span className="se-glyph se-glyph-bold">B</span>
          </button>
          <button
            type="button"
            className={`se-toolbar-button${format.italic ? ' is-active' : ''}`}
            title="기울임"
            aria-label="기울임"
            aria-pressed={format.italic}
            onMouseDown={keepSelection}
            onClick={() => runCommand('italic')}
          >
            <span className="se-glyph se-glyph-italic">I</span>
          </button>
          <button
            type="button"
            className={`se-toolbar-button${format.underline ? ' is-active' : ''}`}
            title="밑줄"
            aria-label="밑줄"
            aria-pressed={format.underline}
            onMouseDown={keepSelection}
            onClick={() => runCommand('underline')}
          >
            <span className="se-glyph se-glyph-underline">U</span>
          </button>
          <button
            type="button"
            className={`se-toolbar-button${format.strike ? ' is-active' : ''}`}
            title="취소선"
            aria-label="취소선"
            aria-pressed={format.strike}
            onMouseDown={keepSelection}
            onClick={() => runCommand('strikeThrough')}
          >
            <span className="se-glyph se-glyph-strike">T</span>
          </button>
          <ToolbarMenu
            id="color"
            openMenu={openMenu}
            onToggle={toggleMenu}
            label="글자색"
            popupClassName="se-color-layer"
            trigger={
              <span className="se-glyph se-glyph-color">
                T<i style={{ background: lastColor }} />
              </span>
            }
          >
            <div className="se-color-grid">
              {COLOR_PALETTE.flat().map((color) => (
                <button
                  type="button"
                  key={color}
                  style={{ background: color }}
                  onMouseDown={keepSelection}
                  onClick={closeMenuAnd(() => applyColor(color))}
                  aria-label={`글자색 ${color}`}
                />
              ))}
            </div>
            <div className="se-color-custom">
              <input type="color" value={customColor} onChange={(event) => setCustomColor(event.target.value)} aria-label="직접 선택" />
              <button type="button" onMouseDown={keepSelection} onClick={closeMenuAnd(() => applyColor(customColor))}>
                적용
              </button>
            </div>
          </ToolbarMenu>
          <ToolbarMenu
            id="background"
            openMenu={openMenu}
            onToggle={toggleMenu}
            label="글자 배경색"
            popupClassName="se-color-layer"
            trigger={
              <span className="se-glyph se-glyph-background" style={{ background: lastBackground }}>
                T
              </span>
            }
          >
            <button
              type="button"
              className="se-color-none"
              onMouseDown={keepSelection}
              onClick={closeMenuAnd(() => applyBackground('transparent'))}
            >
              배경색 없음
            </button>
            <div className="se-color-grid">
              {COLOR_PALETTE.flat().map((color) => (
                <button
                  type="button"
                  key={color}
                  style={{ background: color }}
                  onMouseDown={keepSelection}
                  onClick={closeMenuAnd(() => applyBackground(color))}
                  aria-label={`배경색 ${color}`}
                />
              ))}
            </div>
            <div className="se-color-custom">
              <input type="color" value={customColor} onChange={(event) => setCustomColor(event.target.value)} aria-label="직접 선택" />
              <button type="button" onMouseDown={keepSelection} onClick={closeMenuAnd(() => applyBackground(customColor))}>
                적용
              </button>
            </div>
          </ToolbarMenu>
          <span className="se-toolbar-divider" aria-hidden="true" />
          <ToolbarMenu
            id="align"
            openMenu={openMenu}
            onToggle={toggleMenu}
            label={alignment.label}
            popupClassName="se-inline-layer"
            caret
            trigger={<Icon name={alignIcon} />}
          >
            {ALIGNMENTS.map((item) => (
              <button
                type="button"
                key={item.value}
                className={`se-toolbar-button${format.align === item.value ? ' is-active' : ''}`}
                title={item.label}
                aria-label={item.label}
                onMouseDown={keepSelection}
                onClick={closeMenuAnd(() => runCommand(item.command))}
              >
                <Icon name={{ left: 'alignLeft', center: 'alignCenter', right: 'alignRight', justify: 'alignJustify' }[item.value]} />
              </button>
            ))}
          </ToolbarMenu>
          <ToolbarMenu
            id="lineHeight"
            openMenu={openMenu}
            onToggle={toggleMenu}
            label="줄간격"
            popupClassName="se-list-layer se-size-layer"
            caret
            trigger={<Icon name="lineHeight" />}
          >
            {LINE_HEIGHTS.map((value) => (
              <button
                type="button"
                key={value}
                className="se-list-option"
                onMouseDown={keepSelection}
                onClick={closeMenuAnd(() => applyLineHeight(value))}
              >
                {Math.round(Number(value) * 100)}%
              </button>
            ))}
          </ToolbarMenu>
          <ToolbarMenu
            id="list"
            openMenu={openMenu}
            onToggle={toggleMenu}
            label="목록"
            popupClassName="se-list-layer"
            caret
            active={Boolean(format.list)}
            trigger={<Icon name={format.list === 'ol' ? 'listNumber' : 'listBullet'} />}
          >
            <button
              type="button"
              className={`se-list-option se-list-option-icon${format.list === 'ul' ? ' is-active' : ''}`}
              onMouseDown={keepSelection}
              onClick={closeMenuAnd(() => runCommand('insertUnorderedList'))}
            >
              <Icon name="listBullet" />
              글머리 기호
            </button>
            <button
              type="button"
              className={`se-list-option se-list-option-icon${format.list === 'ol' ? ' is-active' : ''}`}
              onMouseDown={keepSelection}
              onClick={closeMenuAnd(() => runCommand('insertOrderedList'))}
            >
              <Icon name="listNumber" />
              번호 매기기
            </button>
          </ToolbarMenu>
          <span className="se-toolbar-divider" aria-hidden="true" />
          <button
            type="button"
            className={`se-toolbar-button${format.superscript ? ' is-active' : ''}`}
            title="위첨자"
            aria-label="위첨자"
            aria-pressed={format.superscript}
            onMouseDown={keepSelection}
            onClick={() => runCommand('superscript')}
          >
            <span className="se-glyph">
              T<sup>T</sup>
            </span>
          </button>
          <button
            type="button"
            className={`se-toolbar-button${format.subscript ? ' is-active' : ''}`}
            title="아래첨자"
            aria-label="아래첨자"
            aria-pressed={format.subscript}
            onMouseDown={keepSelection}
            onClick={() => runCommand('subscript')}
          >
            <span className="se-glyph">
              T<sub>T</sub>
            </span>
          </button>
          <ToolbarMenu
            id="symbol"
            openMenu={openMenu}
            onToggle={toggleMenu}
            label="특수문자"
            popupClassName="se-symbol-layer"
            trigger={<Icon name="symbol" />}
          >
            <div className="se-symbol-grid">
              {SYMBOLS.map((symbol) => (
                <button type="button" key={symbol} onMouseDown={keepSelection} onClick={() => runCommand('insertText', symbol)}>
                  {symbol}
                </button>
              ))}
            </div>
          </ToolbarMenu>
          <ToolbarMenu
            id="link"
            openMenu={openMenu}
            onToggle={toggleMenu}
            label="링크"
            popupClassName="se-link-layer"
            active={format.link}
            trigger={<Icon name="link" />}
          >
            <form className="se-link-form" onSubmit={applyLink}>
              <input
                type="text"
                value={linkInput}
                onChange={(event) => setLinkInput(event.target.value)}
                placeholder="URL을 입력하세요."
                aria-label="링크 URL"
                autoFocus
              />
              <button type="submit">확인</button>
            </form>
            {format.link ? (
              <button type="button" className="se-link-remove" onMouseDown={keepSelection} onClick={closeMenuAnd(() => runCommand('unlink'))}>
                링크 해제
              </button>
            ) : null}
          </ToolbarMenu>
        </div>
      </div>

      {errorMessage && openMenu !== 'publish' ? <p className="se-editor-error">{errorMessage}</p> : null}

      <div className="se-canvas">
        <div className="se-document" ref={documentRef}>
          <section className={`se-title-section${coverSrc ? ' has-cover' : ''}`} style={coverSrc ? { backgroundImage: `url("${coverSrc}")` } : undefined}>
            <textarea
              ref={titleRef}
              className="se-title-input"
              value={title}
              onChange={handleTitleChange}
              onKeyDown={handleTitleKeyDown}
              placeholder="제목"
              aria-label="제목 (업체명)"
              maxLength={titleMaxLength}
              rows={1}
            />
            <button type="button" className="se-cover-button" onClick={() => coverInputRef.current?.click()}>
              <Icon name="camera" />
              {coverSrc ? '대표 이미지 변경' : '대표 이미지 추가'}
            </button>
          </section>

          <div className="se-body-wrap">
            {isBodyEmpty ? (
              <p className="se-body-placeholder" aria-hidden="true">
                피해 사례와 업체 정보를 자유롭게 기록해보세요!
              </p>
            ) : null}
            <div
              ref={bodyRef}
              className="se-viewer se-editor-body"
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-multiline="true"
              aria-label="본문"
              spellCheck={false}
              onInput={handleBodyInput}
              onKeyDown={handleBodyKeyDown}
              onPaste={handleBodyPaste}
              onDragOver={handleBodyDragOver}
              onDrop={handleBodyDrop}
              onClick={handleBodyClick}
            />
          </div>

          {componentToolbar}
        </div>
      </div>

      <input ref={photoInputRef} type="file" accept="image/*" multiple hidden onChange={handlePhotoInputChange} />
      <input ref={coverInputRef} type="file" accept="image/*" hidden onChange={handleCoverInputChange} />

      {uploadCount > 0 ? <div className="se-toast">사진을 업로드하고 있습니다...</div> : null}
      {toast && uploadCount === 0 ? <div className={`se-toast${toast.tone === 'error' ? ' is-error' : ''}`}>{toast.message}</div> : null}

      {dialog?.kind === 'place' ? <PlaceDialog onCancel={() => setDialog(null)} onConfirm={insertPlace} /> : null}
      {dialog?.kind === 'oglink' ? <LinkCardDialog onCancel={() => setDialog(null)} onConfirm={insertLinkCard} /> : null}
      {dialog?.kind === 'schedule' ? <ScheduleDialog onCancel={() => setDialog(null)} onConfirm={insertSchedule} /> : null}
      {dialog?.kind === 'formula' ? (
        <FormulaDialog
          initialSource={dialog.source}
          onCancel={() => setDialog(null)}
          onConfirm={(source) => saveFormula(source, dialog.target)}
        />
      ) : null}
    </div>,
    document.body,
  )
}
