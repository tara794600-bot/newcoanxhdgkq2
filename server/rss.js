import { resolveCompanyContent } from '../shared/company-content.js'
import { SEO_META_BY_ROUTE } from '../shared/page-meta.js'

export const RSS_ITEM_LIMIT = 500
const DESCRIPTION_MAX_LENGTH = 600
const text = (value) => typeof value === 'string' ? value.trim() : ''

const escapeXml = (value) => String(value)
  .replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;')

const toRssDate = (value) => {
  const date = value && typeof value.toDate === 'function'
    ? value.toDate()
    : value instanceof Date ? value : typeof value === 'string' && value.trim() ? new Date(value) : null

  return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toUTCString() : ''
}

export const getLatestRssCompanyCases = async (collectionRef) => {
  const items = []
  const orderedQuery = collectionRef.orderBy('createdAt', 'desc')
  let cursor = null

  // Continue past invalid/phone-only posts until 500 eligible details are found.
  // Legacy posts without visibility flags and search-blocked posts are included.
  while (items.length < RSS_ITEM_LIMIT) {
    const batchSize = RSS_ITEM_LIMIT - items.length
    const query = cursor ? orderedQuery.startAfter(cursor) : orderedQuery
    const snapshot = await query.limit(batchSize).get()

    for (const doc of snapshot.docs) {
      const data = doc.data() ?? {}
      const name = text(data.name)
      const service = text(data.service)
      const description = text(data.description)

      if (!name || !service || !description || data.isPublic === false) continue

      items.push({ id: doc.id, name, service, description, createdAt: data.createdAt })
    }

    if (snapshot.docs.length < batchSize) break
    // A document cursor preserves posts that share the same creation timestamp.
    cursor = snapshot.docs.at(-1)
  }

  return items
}

const getDescriptionExcerpt = (value) => {
  const characters = Array.from(value)
  return characters.length > DESCRIPTION_MAX_LENGTH
    ? `${characters.slice(0, DESCRIPTION_MAX_LENGTH).join('').trimEnd()}…`
    : value
}

export const renderRss = (companyCases, site, buildDate = new Date()) => {
  const items = companyCases.slice(0, RSS_ITEM_LIMIT).map((companyCase) => {
    const content = resolveCompanyContent(companyCase, site.id)
    const url = `${site.url}/companies/${encodeURIComponent(companyCase.id)}`
    const pubDate = toRssDate(companyCase.createdAt)

    return `    <item>
      <title>${escapeXml(content.name)}</title>
      <link>${escapeXml(url)}</link>
      <guid isPermaLink="true">${escapeXml(url)}</guid>
      <description>${escapeXml(getDescriptionExcerpt(content.description))}</description>
      <category>${escapeXml(companyCase.service)}</category>${pubDate ? `\n      <pubDate>${pubDate}</pubDate>` : ''}
    </item>`
  })

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(SEO_META_BY_ROUTE.home.title)}</title>
    <link>${escapeXml(site.url)}/</link>
    <atom:link href="${escapeXml(site.url)}/rss.xml" rel="self" type="application/rss+xml" />
    <description>${escapeXml(SEO_META_BY_ROUTE.companies.description)}</description>
    <language>ko-KR</language>
    <lastBuildDate>${toRssDate(buildDate)}</lastBuildDate>
    <ttl>5</ttl>
${items.join('\n')}
  </channel>
</rss>
`
}
