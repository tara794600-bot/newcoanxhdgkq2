export type RichTextFont = { label: string; value: string }

// The value is written to the post as a CSS font-family, so it must stay stable.
export const RICH_TEXT_FONTS: RichTextFont[] = [
  { label: '기본서체', value: 'inherit' },
  { label: '나눔고딕', value: "'Nanum Gothic'" },
  { label: '나눔명조', value: "'Nanum Myeongjo'" },
  { label: '나눔바른고딕', value: "'NanumBarunGothic'" },
  { label: '나눔스퀘어', value: "'NanumSquare'" },
  { label: '마루부리', value: "'MaruBuri'" },
  { label: '나눔손글씨 펜', value: "'Nanum Pen Script'" },
  { label: '나눔손글씨 붓', value: "'Nanum Brush Script'" },
]

const FONT_STYLESHEETS = [
  'https://fonts.googleapis.com/css2?family=Nanum+Brush+Script&family=Nanum+Gothic:wght@400;700&family=Nanum+Myeongjo:wght@400;700&family=Nanum+Pen+Script&display=swap',
  'https://hangeul.pstatic.net/hangeul_static/css/nanum-barun-gothic.css',
  'https://hangeul.pstatic.net/hangeul_static/css/nanum-square.css',
  'https://hangeul.pstatic.net/hangeul_static/css/maru-buri.css',
]

export const ensureRichTextFonts = () => {
  if (typeof document === 'undefined') {
    return
  }

  for (const href of FONT_STYLESHEETS) {
    if (document.head.querySelector(`link[data-rich-text-font="${href}"]`)) {
      continue
    }

    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    link.dataset.richTextFont = href
    document.head.append(link)
  }
}

export const getRichTextFontLabel = (computedFontFamily: string): string => {
  const firstFamily = computedFontFamily.split(',')[0]?.replace(/["']/g, '').trim().toLowerCase() ?? ''
  const font = RICH_TEXT_FONTS.find(
    (item) => item.value !== 'inherit' && item.value.replace(/["']/g, '').toLowerCase() === firstFamily,
  )
  return font?.label ?? RICH_TEXT_FONTS[0].label
}
