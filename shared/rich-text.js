// Company descriptions written with the blog-style editor are stored as HTML inside
// this wrapper. Older posts are plain text, so every reader checks the wrapper first.
// This module runs in the browser and in the serverless functions, so it must not
// rely on the DOM.
export const RICH_DESCRIPTION_OPEN = '<div class="se-main-container">'
export const RICH_DESCRIPTION_CLOSE = '</div>'

export const isRichDescription = (value) =>
  typeof value === 'string' && value.trimStart().startsWith(RICH_DESCRIPTION_OPEN)

export const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  middot: '·',
  hellip: '…',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  times: '×',
  divide: '÷',
  copy: '©',
  reg: '®',
  trade: '™',
  bull: '•',
}

const decodeEntities = (value) =>
  value.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (entity, body) => {
    if (body[0] === '#') {
      const isHex = body[1] === 'x' || body[1] === 'X'
      const code = isHex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      const isValid = code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
      return isValid ? String.fromCodePoint(code) : ''
    }

    return NAMED_ENTITIES[body.toLowerCase()] ?? entity
  })

// Comments, doctype/CDATA, a tag (attribute values may contain ">"), a stray "<", or text.
const TOKEN_PATTERN =
  /<!--[\s\S]*?(?:-->|$)|<![^>]*>?|<\?[^>]*>?|<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|<|[^<]+/g
const ATTRIBUTE_PATTERN = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

const ALLOWED_TAGS = new Set([
  'p', 'br', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'sub', 'sup',
  'h2', 'h3', 'h4', 'blockquote', 'cite', 'ul', 'ol', 'li', 'a', 'img', 'figure', 'figcaption',
  'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'pre', 'code',
])
const VOID_TAGS = new Set(['br', 'hr', 'img'])
// Their content is never shown as text, so it is dropped together with the tag.
const DROPPED_CONTENT_TAGS = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'textarea', 'select',
  'svg', 'math', 'head', 'title', 'xmp', 'noembed', 'noframes', 'frameset', 'frame',
])
// The editor stores font sizes on <font> while typing; it is kept as a <span>.
const RENAMED_TAGS = { font: 'span' }

const COLOR_VALUE =
  /^(#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}%?\s*,\s*\d{1,3}%?\s*,\s*\d{1,3}%?\s*(,\s*(0|1|0?\.\d+))?\s*\)|[a-z]{3,20})$/i
const TEXT_DECORATION_VALUE = /^(none|underline|line-through|underline line-through|line-through underline)$/
const STYLE_RULES = {
  color: COLOR_VALUE,
  'background-color': COLOR_VALUE,
  'font-size': /^\d{1,3}(\.\d{1,2})?(px|pt|em|rem|%)$/,
  'font-family': /^[\w\s,'"\-가-힣]{1,120}$/,
  'font-weight': /^(normal|bold|bolder|lighter|[1-9]00)$/,
  'font-style': /^(normal|italic|oblique)$/,
  'text-decoration': TEXT_DECORATION_VALUE,
  'text-decoration-line': TEXT_DECORATION_VALUE,
  'text-align': /^(left|right|center|justify|start|end)$/,
  'line-height': /^(normal|\d{1,2}(\.\d{1,2})?|\d{1,3}(\.\d{1,2})?(%|px|em))$/,
  'vertical-align': /^(baseline|sub|super|top|middle|bottom|text-top|text-bottom)$/,
  width: /^\d{1,4}(\.\d{1,2})?(px|%)$/,
}
const CLASS_TOKEN = /^se-[a-z0-9-]{1,40}$/
const DATA_ATTRIBUTE = /^data-se-[a-z0-9-]{1,30}$/
const MAX_DATA_ATTRIBUTE_LENGTH = 2000

const sanitizeStyle = (value) =>
  value
    .split(';')
    .map((declaration) => {
      const separatorIndex = declaration.indexOf(':')
      if (separatorIndex === -1) return ''
      const property = declaration.slice(0, separatorIndex).trim().toLowerCase()
      const propertyValue = declaration.slice(separatorIndex + 1).trim().replace(/\s*!important$/i, '')
      const rule = STYLE_RULES[property]
      return rule && rule.test(propertyValue) ? `${property}: ${propertyValue}` : ''
    })
    .filter(Boolean)
    .join('; ')

const toSafeUrl = (value, allowedSchemes) => {
  const url = value.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  const compactUrl = url.replace(/\s/g, '')

  if (allowedSchemes.test(compactUrl)) return url
  // Same-site paths and fragments only; "//host" would leave the site.
  if (/^(\/(?!\/)|#)/.test(compactUrl)) return url
  return ''
}

const LINK_SCHEMES = /^(https?:|mailto:|tel:)/i
const IMAGE_SCHEMES = /^https?:/i

const sanitizeAttributes = (tagName, rawAttributes) => {
  const attributes = []
  let href = ''
  ATTRIBUTE_PATTERN.lastIndex = 0
  let match

  while ((match = ATTRIBUTE_PATTERN.exec(rawAttributes))) {
    const name = match[1].toLowerCase()
    const value = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '')

    if (name === 'class') {
      const classes = value.split(/\s+/).filter((token) => CLASS_TOKEN.test(token))
      if (classes.length) attributes.push(['class', classes.join(' ')])
    } else if (name === 'style') {
      const style = sanitizeStyle(value)
      if (style) attributes.push(['style', style])
    } else if (DATA_ATTRIBUTE.test(name)) {
      if (value.length <= MAX_DATA_ATTRIBUTE_LENGTH) attributes.push([name, value])
    } else if (tagName === 'a' && name === 'href') {
      href = toSafeUrl(value, LINK_SCHEMES)
      if (href) attributes.push(['href', href])
    } else if (tagName === 'a' && name === 'title') {
      attributes.push(['title', value.slice(0, 300)])
    } else if (tagName === 'img' && name === 'src') {
      const src = toSafeUrl(value, IMAGE_SCHEMES)
      if (src) attributes.push(['src', src])
    } else if (tagName === 'img' && name === 'alt') {
      attributes.push(['alt', value.slice(0, 300)])
    } else if ((tagName === 'td' || tagName === 'th') && (name === 'colspan' || name === 'rowspan')) {
      if (/^\d{1,2}$/.test(value)) attributes.push([name, value])
    }
  }

  // Links in scam reports must never pass ranking signals to the reported sites.
  if (tagName === 'a' && /^https?:/i.test(href)) {
    attributes.push(['target', '_blank'], ['rel', 'nofollow noopener noreferrer'])
  }

  return attributes
}

const renderAttributes = (attributes) =>
  attributes.map(([name, value]) => ` ${name}="${escapeHtml(value)}"`).join('')

// Rebuilds the markup from an allow-list so that only known tags, attributes, styles
// and URL schemes survive, whatever the input looked like.
export const sanitizeRichHtml = (html) => {
  const source = typeof html === 'string' ? html : ''
  const output = []
  const openTags = []
  let droppedTag = ''
  let match

  TOKEN_PATTERN.lastIndex = 0

  while ((match = TOKEN_PATTERN.exec(source))) {
    const [token, rawName, rawAttributes = ''] = match

    if (droppedTag) {
      if (rawName && token.startsWith('</') && rawName.toLowerCase() === droppedTag) droppedTag = ''
      continue
    }

    if (!rawName) {
      // Comments and declarations are dropped; a lone "<" is text.
      if (token[0] === '<' && token.length > 1) continue
      output.push(escapeHtml(decodeEntities(token)))
      continue
    }

    const sourceName = rawName.toLowerCase()
    const isClosing = token.startsWith('</')

    if (DROPPED_CONTENT_TAGS.has(sourceName)) {
      if (!isClosing && !/\/\s*>$/.test(token)) droppedTag = sourceName
      continue
    }

    const name = RENAMED_TAGS[sourceName] ?? sourceName

    if (!ALLOWED_TAGS.has(name)) continue

    if (isClosing) {
      const openIndex = openTags.lastIndexOf(name)
      if (openIndex === -1) continue
      while (openTags.length > openIndex) output.push(`</${openTags.pop()}>`)
      continue
    }

    const attributes = sanitizeAttributes(name, rawAttributes)

    if (name === 'img' && !attributes.some(([attributeName]) => attributeName === 'src')) continue

    output.push(`<${name}${renderAttributes(attributes)}>`)
    if (!VOID_TAGS.has(name)) openTags.push(name)
  }

  while (openTags.length) output.push(`</${openTags.pop()}>`)

  return output.join('')
}

const BLOCK_TAGS = new Set([
  'p', 'div', 'h2', 'h3', 'h4', 'blockquote', 'cite', 'ul', 'ol', 'li', 'figure', 'figcaption',
  'hr', 'table', 'tr', 'pre',
])

export const richHtmlToPlainText = (html) => {
  const source = typeof html === 'string' ? html : ''
  let text = ''
  let droppedTag = ''
  let match

  // Block edges start a new line once; <br> always adds one, so empty paragraphs
  // still read as blank lines.
  const breakLine = () => {
    if (text && !text.endsWith('\n')) text += '\n'
  }

  TOKEN_PATTERN.lastIndex = 0

  while ((match = TOKEN_PATTERN.exec(source))) {
    const [token, rawName] = match

    if (droppedTag) {
      if (rawName && token.startsWith('</') && rawName.toLowerCase() === droppedTag) droppedTag = ''
      continue
    }

    if (!rawName) {
      if (token[0] === '<' && token.length > 1) continue
      text += decodeEntities(token)
      continue
    }

    const name = rawName.toLowerCase()

    if (DROPPED_CONTENT_TAGS.has(name)) {
      if (!token.startsWith('</') && !/\/\s*>$/.test(token)) droppedTag = name
    } else if (name === 'br') {
      text += '\n'
    } else if (BLOCK_TAGS.has(name)) {
      breakLine()
    } else if (name === 'td' || name === 'th') {
      text += ' '
    }
  }

  return text
    .replace(/ /g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v\r]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Plain text for search, meta descriptions and RSS, whichever format was stored.
export const descriptionToPlainText = (description) => {
  const value = typeof description === 'string' ? description : ''
  return isRichDescription(value) ? richHtmlToPlainText(value) : value
}

export const prependRichParagraph = (description, text) => {
  const body = description.trimStart().slice(RICH_DESCRIPTION_OPEN.length)
  return `${RICH_DESCRIPTION_OPEN}<p class="se-intro">${escapeHtml(text)}</p><p><br></p>${body}`
}

export const getRichImageSources = (description) => {
  if (!isRichDescription(description)) return []

  return Array.from(
    sanitizeRichHtml(description).matchAll(/<img\b[^>]*?\ssrc="([^"]*)"/g),
    (imageMatch) => decodeEntities(imageMatch[1]),
  )
}
