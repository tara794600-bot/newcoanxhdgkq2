import { getCompanyKeyword } from './company-slug.js'
import { descriptionToPlainText } from './rich-text.js'

// Search metadata for a company detail page, shared by the server render and the client.
export const SEO_BRAND_NAME = '법무법인 나란'

// List pages only route crawlers to detail pages; indexing them lets the board outrank
// the detail page for a company keyword. Search result pages were already noindex.
export const COMPANY_LIST_ROBOTS = 'noindex,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1'
export const COMPANY_DETAIL_ROBOTS = 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1'

const DESCRIPTION_MAX_LENGTH = 155

const text = (value) => (typeof value === 'string' ? value.trim() : '')

const toPlainSeoText = (value) =>
  String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    // Emoji markers in post bodies (📌, ✅, ⚖️ ...) only add noise to search snippets.
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const clipDescription = (value) => {
  if (value.length <= DESCRIPTION_MAX_LENGTH) return value

  const clipped = value.slice(0, DESCRIPTION_MAX_LENGTH).trim()
  const lastSpaceIndex = clipped.lastIndexOf(' ')
  const readableClip =
    lastSpaceIndex >= Math.floor(DESCRIPTION_MAX_LENGTH * 0.6) ? clipped.slice(0, lastSpaceIndex).trim() : clipped

  return `${readableClip}...`
}

// `companyCase` is the public (resolved) post: `name` is the display title and
// `sourceName` the name the admin typed, e.g. "vogashop.net 사칭".
export const getCompanyDetailSeo = (companyCase) => {
  const sourceName = text(companyCase.sourceName) || text(companyCase.name).split(' | ')[0]
  const keyword = getCompanyKeyword(sourceName) || sourceName
  const service = text(companyCase.service)
  // Searchers type "<name> 사기", so the title leads with the name and that word.
  const lead = sourceName.includes('사기') ? sourceName : `${sourceName} 사기 의심`
  const title = `${lead} | ${service ? `${service} ` : ''}사례 정리 | ${SEO_BRAND_NAME}`
  const description = clipDescription(
    toPlainSeoText(descriptionToPlainText(companyCase.description)) ||
      `${sourceName} 관련 ${service} 사례와 피해회복 상담 정보를 확인하세요.`,
  )
  const keywords = Array.from(
    new Set(
      [keyword, `${keyword} 사기`, `${keyword} 사칭`, `${keyword} 피해`, `${keyword} 피해회복`, service, SEO_BRAND_NAME]
        .map(text)
        .filter(Boolean),
    ),
  ).join(', ')

  return { title, description, keywords, keyword, sourceName }
}
