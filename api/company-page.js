import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { randomInt } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CONTENT_SITE, matchesCompanySearch, resolveCompanyContent } from '../shared/company-content.js'
import {
  assignCompanySlugs,
  findCompanyBySlug,
  getCompanyCasePath,
  toCompanyTimeValue,
} from '../shared/company-slug.js'
import { COMPANY_DETAIL_ROBOTS, COMPANY_LIST_ROBOTS, getCompanyDetailSeo } from '../shared/company-seo.js'
import { isRichDescription, sanitizeRichHtml } from '../shared/rich-text.js'

const SITE_BASE_URL = CONTENT_SITE.url
const RELATED_COMPANY_CASE_LIMIT = 10
const SEARCH_RESULT_SITE_NAME = '법무법인나란'
const SEARCH_RESULT_SECTION_NAME = '핀테크전문'
const COMPANIES_PAGE_PATH = '/companies'
const COMPANIES_PAGE_TITLE = '사기업체 게시판 | 법무법인 나란'
const COMPANIES_PAGE_DESCRIPTION =
  '투자사기, 부업사기, 로맨스스캠 등 실제 사기업체 사례를 게시판 형식으로 확인하고 피해회복 상담을 신청하세요.'
const COMPANIES_PAGE_KEYWORDS =
  '사기업체 게시판, 사기업체 사례 게시판, 사기 업체 게시판, 사기 피해 게시판, 사기업체 목록, 사기 피해 사례, 피해회복 상담, 법무법인 나란'
const COMPANY_CASES_PER_PAGE = 40
const COMPANY_SEARCH_MAX_LENGTH = 120
const PAGINATION_CRAWL_SEGMENTS = 8
const COMPANY_PHONE_NUMBER = '1551-7203'
const COMPANY_PHONE_TEL = `tel:${COMPANY_PHONE_NUMBER.replace(/[^0-9+]/g, '')}`
// Posts written before this domain moved to its own Firebase project (2026-10-16)
// stay in the previous project and are still linked from search results. Its
// companyCases are publicly readable with the web API key it ships to browsers.
const LEGACY_COMPANY_CASES_URL =
  'https://firestore.googleapis.com/v1/projects/newcoanxhdgkq/databases/(default)/documents/companyCases'
const LEGACY_FIREBASE_API_KEY = 'AIzaSyBFn70MUVeEnfUxwrNVdc1o8Q-xP3g6OkM'
const LEGACY_REQUEST_TIMEOUT_MS = 5000

let companyCasesCache = null
let companyCasesCacheVersion = ''
let companyCasesRequest = null
let companyIndexCache = null
let companyIndexCacheVersion = ''
let companyIndexRequest = null

const toTrimmedString = (value) => (typeof value === 'string' ? value.trim() : '')

const parseJsonEnv = (key) => {
  const rawValue = process.env[key]

  if (!rawValue || !rawValue.trim()) {
    return null
  }

  try {
    const parsed = JSON.parse(rawValue)

    if (parsed && typeof parsed.private_key === 'string') {
      parsed.private_key = parsed.private_key.replace(/\\n/g, '\n')
    }

    return parsed
  } catch (error) {
    throw new Error(`${key} 환경변수가 JSON 형식이 아닙니다.`)
  }
}

const getFirebaseApp = () => {
  if (getApps().length > 0) {
    return getApps()[0]
  }

  const serviceAccount =
    parseJsonEnv('FIREBASE_SERVICE_ACCOUNT_JSON') ??
    parseJsonEnv('GOOGLE_SERVICE_ACCOUNT_JSON')

  if (!serviceAccount) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON 환경변수를 설정해주세요.')
  }

  return initializeApp({
    credential: cert(serviceAccount),
  })
}

const getIndexHtml = async () => {
  const apiDir = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.join(process.cwd(), 'dist', 'app-shell.html'),
    path.join(apiDir, '..', 'dist', 'app-shell.html'),
    path.join(process.cwd(), 'dist', 'index.html'),
    path.join(apiDir, '..', 'dist', 'index.html'),
  ]

  if (process.env.NODE_ENV !== 'production') {
    candidates.push(path.join(process.cwd(), 'index.html'))
  }

  let lastError = null

  for (const candidate of candidates) {
    try {
      return await readFile(candidate, 'utf8')
    } catch (error) {
      lastError = error
    }
  }

  throw lastError ?? new Error('index.html 파일을 찾을 수 없습니다.')
}

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const escapeJsonForHtml = (value) => JSON.stringify(value).replace(/</g, '\\u003c')

const replaceRootContent = (html, content) => {
  const rootRegex = /<div\s+id=["']root["']\s*>[\s\S]*?<\/div>/i
  const root = `<div id="root">${content}</div>`

  if (rootRegex.test(html)) {
    return html.replace(rootRegex, () => root)
  }

  return html.replace('</body>', () => `  ${root}\n  </body>`)
}

const replaceOrInsertBootstrapData = (html, data) => {
  const tag = `<script id="company-page-data">window.__COMPANY_PAGE_DATA__=${escapeJsonForHtml(data)}</script>`
  const regex = /<script\s+[^>]*id=["']company-page-data["'][^>]*>[\s\S]*?<\/script>/i

  if (regex.test(html)) {
    return html.replace(regex, () => tag)
  }

  return upsertHeadTag(html, tag)
}

const renderDescriptionParagraphs = (description) => {
  if (isRichDescription(description)) {
    return `<div class="company-detail-description se-viewer">${sanitizeRichHtml(description)}</div>`
  }

  const paragraphs = String(description)
    .split(/\r?\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)

  if (paragraphs.length === 0) {
    return '<p class="company-detail-description"></p>'
  }

  return paragraphs
    .map((paragraph) => `<p class="company-detail-description">${escapeHtml(paragraph)}</p>`)
    .join('\n')
}

const getCompaniesPagePath = (page, searchQuery = '') => {
  const params = new URLSearchParams()

  if (page > 1) {
    params.set('page', String(page))
  }

  if (searchQuery) {
    params.set('q', searchQuery)
  }

  const queryString = params.toString()
  return queryString ? `${COMPANIES_PAGE_PATH}?${queryString}` : COMPANIES_PAGE_PATH
}

const getPaginationItems = (totalPages, currentPage) => {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1)
  }

  const visiblePages = new Set([1, totalPages, currentPage, currentPage - 1, currentPage + 1])
  const crawlInterval = Math.ceil((totalPages - 1) / PAGINATION_CRAWL_SEGMENTS)

  for (let page = 1 + crawlInterval; page < totalPages; page += crawlInterval) {
    visiblePages.add(page)
  }

  if (currentPage <= 4) {
    const leadingPages = [2, 3, 4]
    leadingPages.forEach((page) => visiblePages.add(page))
  } else if (currentPage >= totalPages - 3) {
    const trailingPages = [totalPages - 3, totalPages - 2, totalPages - 1]
    trailingPages.forEach((page) => visiblePages.add(page))
  }

  const pages = Array.from(visiblePages)
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((a, b) => a - b)

  return pages.reduce((items, page, index) => {
    const previousPage = pages[index - 1]

    if (previousPage && page - previousPage > 1) {
      items.push(page - previousPage === 2 ? previousPage + 1 : `ellipsis-${page}`)
    }

    items.push(page)
    return items
  }, [])
}

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const toAbsoluteUrl = (value, baseUrl = SITE_BASE_URL) => {
  const trimmedValue = toTrimmedString(value)

  if (!trimmedValue) {
    return ''
  }

  try {
    return new URL(trimmedValue, `${baseUrl}/`).toString()
  } catch {
    return trimmedValue
  }
}

const upsertHeadTag = (html, tag) => {
  if (!html.includes('</head>')) {
    return `${html}\n${tag}`
  }

  return html.replace('</head>', () => `    ${tag}\n  </head>`)
}

const replaceOrInsertMeta = (html, attribute, key, content) => {
  const tag = `<meta ${attribute}="${escapeHtml(key)}" content="${escapeHtml(content)}" />`
  const regex = new RegExp(`<meta\\s+[^>]*${attribute}=["']${escapeRegExp(key)}["'][^>]*>`, 'i')

  if (regex.test(html)) {
    return html.replace(regex, () => tag)
  }

  return upsertHeadTag(html, tag)
}

const replaceOrInsertCanonical = (html, href) => {
  const tag = `<link rel="canonical" href="${escapeHtml(href)}" />`
  const regex = /<link\s+[^>]*rel=["']canonical["'][^>]*>/i

  if (regex.test(html)) {
    return html.replace(regex, () => tag)
  }

  return upsertHeadTag(html, tag)
}

const replaceOrInsertRouteStructuredData = (html, data) => {
  const json = JSON.stringify(data).replace(/</g, '\\u003c')
  const tag = `<script id="route-structured-data" type="application/ld+json">${json}</script>`
  const regex = /<script\s+[^>]*id=["']route-structured-data["'][^>]*>[\s\S]*?<\/script>/i

  if (regex.test(html)) {
    return html.replace(regex, () => tag)
  }

  return upsertHeadTag(html, tag)
}

const removeHomepageOnlyStructuredData = (html) =>
  html.replace(
    /\s*<script\s+[^>]*id=["']homepage-faq-structured-data["'][^>]*>[\s\S]*?<\/script>/i,
    '',
  )

const toIsoDateTime = (value) => {
  if (value && typeof value.toDate === 'function') {
    return value.toDate().toISOString()
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString()
  }

  if (typeof value === 'string' && value.trim()) {
    const parsedDate = new Date(value)

    if (!Number.isNaN(parsedDate.getTime())) {
      return parsedDate.toISOString()
    }
  }

  return ''
}

const getCompaniesBreadcrumbStructuredData = (canonicalUrl, companyCase = null, baseUrl = SITE_BASE_URL) => ({
  '@type': 'BreadcrumbList',
  itemListElement: [
    {
      '@type': 'ListItem',
      position: 1,
      name: SEARCH_RESULT_SITE_NAME,
      item: `${baseUrl}/`,
    },
    {
      '@type': 'ListItem',
      position: 2,
      name: SEARCH_RESULT_SECTION_NAME,
      item: `${baseUrl}${COMPANIES_PAGE_PATH}`,
    },
    ...(companyCase
      ? [
          {
            '@type': 'ListItem',
            position: 3,
            name: companyCase.name,
            item: canonicalUrl,
          },
        ]
      : []),
  ],
})

const mapCompanyCase = (snapshot) => {
  const data = snapshot.data() ?? {}
  const name = toTrimmedString(data.name)
  const service = toTrimmedString(data.service)
  const description = toTrimmedString(data.description)
  const image = toTrimmedString(data.image) || toTrimmedString(data.imageUrl)

  if (!name || !service || !description) {
    return null
  }

  return {
    id: snapshot.id,
    name,
    service,
    description,
    image: image || '/logo.png',
    isPublic: data.isPublic !== false,
    isSearchBlocked: data.isSearchBlocked === true,
    datePublished: toIsoDateTime(data.createdAt),
    dateModified: toIsoDateTime(data.updatedAt ?? data.createdAt),
  }
}

export const shuffleCompanyCases = (items, getRandomIndex = randomInt) => {
  const shuffledItems = [...items]

  for (let index = shuffledItems.length - 1; index > 0; index -= 1) {
    const randomIndex = getRandomIndex(index + 1)
    ;[shuffledItems[index], shuffledItems[randomIndex]] = [shuffledItems[randomIndex], shuffledItems[index]]
  }

  return shuffledItems
}

const getCompanyCasesVersion = async (collectionRef) => {
  const [countSnapshot, latestUpdateSnapshot] = await Promise.all([
    collectionRef.count().get(),
    collectionRef.orderBy('updatedAt', 'desc').limit(1).get(),
  ])
  const latestUpdate = latestUpdateSnapshot.docs[0]
  const latestUpdatedAt = latestUpdate ? toIsoDateTime(latestUpdate.data()?.updatedAt) : ''

  return `${countSnapshot.data().count}:${latestUpdate?.id ?? ''}:${latestUpdatedAt}`
}

// Slugs are assigned over every named post (any visibility) so that hiding or
// showing a post never moves another post's URL. The client uses the same rule.
const INDEX_FIELDS = ['name', 'service', 'createdAt', 'isPublic', 'isSearchBlocked']

const buildCompanyIndex = (docs) => {
  const entries = docs
    .map((snapshot) => {
      const data = snapshot.data() ?? {}
      return {
        id: snapshot.id,
        name: toTrimmedString(data.name),
        service: toTrimmedString(data.service),
        createdAt: data.createdAt,
        isListed: data.isPublic !== false && data.isSearchBlocked !== true,
      }
    })
    .filter((entry) => entry.name)

  return { entries, slugs: assignCompanySlugs(entries) }
}

const getCachedCompanyCases = async (collectionRef, currentVersion) => {
  // Cache originals only; apply the news introduction after reading this cache.
  if (companyCasesCache && currentVersion === companyCasesCacheVersion) {
    return companyCasesCache
  }

  if (!companyCasesRequest) {
    companyCasesRequest = collectionRef
      .get()
      .then((snapshot) => {
        const index = buildCompanyIndex(snapshot.docs)
        const items = snapshot.docs
          .map(mapCompanyCase)
          .filter(Boolean)
          .map((item) => ({ ...item, slug: index.slugs.get(item.id) ?? item.id }))
        return { index, items }
      })
      .then((cache) => {
        companyCasesCache = cache
        companyCasesCacheVersion = currentVersion
        return cache
      })
      .finally(() => {
        companyCasesRequest = null
      })
  }

  return companyCasesRequest
}

// Detail pages only need names to resolve a slug, so they avoid loading every post body.
const getCompanyIndex = async (collectionRef, currentVersion) => {
  if (companyCasesCache && currentVersion === companyCasesCacheVersion) {
    return companyCasesCache.index
  }

  if (companyIndexCache && currentVersion === companyIndexCacheVersion) {
    return companyIndexCache
  }

  if (!companyIndexRequest) {
    companyIndexRequest = collectionRef
      .select(...INDEX_FIELDS)
      .get()
      .then((snapshot) => {
        companyIndexCache = buildCompanyIndex(snapshot.docs)
        companyIndexCacheVersion = currentVersion
        return companyIndexCache
      })
      .finally(() => {
        companyIndexRequest = null
      })
  }

  return companyIndexRequest
}

// Same-type posts first (often other names used by the same scheme), then the posts
// published closest in time. Deterministic, so a page keeps the same links between crawls.
const selectRelatedCompanyCases = (index, currentId) => {
  const current = index.entries.find((entry) => entry.id === currentId)

  if (!current) {
    return []
  }

  const currentTime = toCompanyTimeValue(current.createdAt)

  return index.entries
    .filter((entry) => entry.id !== currentId && entry.isListed && entry.service)
    .map((entry) => ({
      entry,
      sameService: entry.service === current.service ? 0 : 1,
      distance: Math.abs(toCompanyTimeValue(entry.createdAt) - currentTime),
    }))
    .sort((a, b) => a.sameService - b.sameService || a.distance - b.distance || (a.entry.id < b.entry.id ? -1 : 1))
    .slice(0, RELATED_COMPANY_CASE_LIMIT)
    .map(({ entry }) => ({
      id: entry.id,
      slug: index.slugs.get(entry.id) ?? entry.id,
      name: entry.name,
      service: entry.service,
    }))
}

const fromFirestoreRestValue = (value = {}) => {
  if ('stringValue' in value) return value.stringValue
  if ('booleanValue' in value) return value.booleanValue
  if ('timestampValue' in value) return value.timestampValue
  return undefined
}

const getLegacyCompanyCase = async (id) => {
  const response = await fetch(
    `${LEGACY_COMPANY_CASES_URL}/${encodeURIComponent(id)}?key=${LEGACY_FIREBASE_API_KEY}`,
    { signal: AbortSignal.timeout(LEGACY_REQUEST_TIMEOUT_MS) },
  )

  // Missing, invalid or no longer shared posts are an ordinary not-found page.
  if ([400, 403, 404].includes(response.status)) {
    return null
  }

  // Other failures surface as 503 so crawlers retry instead of dropping the page.
  if (!response.ok) {
    throw new Error(`이전 Firebase 게시글 조회 실패 (${response.status})`)
  }

  const { fields = {} } = await response.json()
  const data = Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, fromFirestoreRestValue(value)]),
  )

  return mapCompanyCase({ id, data: () => data })
}

const isPossibleDocumentId = (value) =>
  value.length <= 1500 && !value.includes('/') && value !== '.' && value !== '..' && !/^__.*__$/.test(value)

// Resolves /companies/{segment}: a keyword slug, an old random-id URL (redirected to
// its slug), or a post that only exists in the previous Firebase project.
const getCompanyCase = async (segment) => {
  const app = getFirebaseApp()
  const collectionRef = getFirestore(app).collection('companyCases')
  const version = await getCompanyCasesVersion(collectionRef)
  const index = await getCompanyIndex(collectionRef, version)
  const match = findCompanyBySlug(index.entries, index.slugs, segment)

  if (match?.redirect) {
    return { redirectTo: getCompanyCasePath(match) }
  }

  if (match) {
    const companyCase = mapCompanyCase(await collectionRef.doc(match.id).get())
    return companyCase
      ? { companyCase: { ...companyCase, slug: match.slug }, related: selectRelatedCompanyCases(index, match.id) }
      : null
  }

  if (!isPossibleDocumentId(segment)) {
    return null
  }

  const snapshot = await collectionRef.doc(segment).get()

  if (snapshot.exists) {
    // Exists without a name, so it has no slug; mapCompanyCase rejects it as incomplete.
    const companyCase = mapCompanyCase(snapshot)
    return companyCase ? { companyCase, related: [] } : null
  }

  const legacyCompanyCase = await getLegacyCompanyCase(segment)
  return legacyCompanyCase ? { companyCase: legacyCompanyCase, related: [] } : null
}

const getCompaniesPage = async ({ page, searchQuery }) => {
  const app = getFirebaseApp()
  const collectionRef = getFirestore(app).collection('companyCases')
  const version = await getCompanyCasesVersion(collectionRef)
  const { items: allCompanyCases } = await getCachedCompanyCases(collectionRef, version)
  const publicItems = allCompanyCases.filter((item) => item.isPublic !== false && item.isSearchBlocked !== true)
  let matchedItems = publicItems

  if (searchQuery) {
    matchedItems = publicItems.filter((item) => matchesCompanySearch(item, searchQuery))
  }

  const totalCount = matchedItems.length
  const startIndex = (page - 1) * COMPANY_CASES_PER_PAGE
  const items = shuffleCompanyCases(matchedItems).slice(startIndex, startIndex + COMPANY_CASES_PER_PAGE)

  return {
    items,
    page,
    searchQuery,
    totalCount,
    totalPages: Math.max(1, Math.ceil(totalCount / COMPANY_CASES_PER_PAGE)),
  }
}

const renderPagination = ({ page, totalPages, searchQuery }) => {
  if (totalPages <= 1) {
    return ''
  }

  const renderPageLink = (targetPage, label, extraClass = '') => {
    const className = `company-page-button${extraClass ? ` ${extraClass}` : ''}${
      targetPage === page ? ' is-active' : ''
    }`
    const href = escapeHtml(getCompaniesPagePath(targetPage, searchQuery))
    const ariaCurrent = targetPage === page ? ' aria-current="page"' : ''
    return `<a class="${className}" href="${href}"${ariaCurrent}>${escapeHtml(label)}</a>`
  }

  const previous =
    page > 1
      ? renderPageLink(page - 1, '‹', 'company-page-arrow')
      : '<span class="company-page-button company-page-arrow is-disabled" aria-hidden="true">‹</span>'
  const next =
    page < totalPages
      ? renderPageLink(page + 1, '›', 'company-page-arrow')
      : '<span class="company-page-button company-page-arrow is-disabled" aria-hidden="true">›</span>'
  const pages = getPaginationItems(totalPages, page)
    .map((item) =>
      typeof item === 'number'
        ? renderPageLink(item, String(item))
        : '<span class="company-page-ellipsis" aria-hidden="true">...</span>',
    )
    .join('\n')

  return `<nav class="company-pagination" aria-label="사기업체 게시물 페이지">
    ${previous}
    ${pages}
    ${next}
  </nav>`
}

const renderCompaniesServerContent = (pageData, baseUrl) => {
  const cards = pageData.items.length
    ? pageData.items
        .map(
          (item) => `<a class="company-card company-card-filled company-card-link" href="${escapeHtml(
            getCompanyCasePath(item),
          )}">
            <div class="company-card-thumb-wrap">
              <img src="${escapeHtml(toAbsoluteUrl(item.image, baseUrl) || `${baseUrl}/logo.png`)}" alt="${escapeHtml(
                `${item.name} 이미지`,
              )}" class="company-card-image" loading="lazy" />
            </div>
            <p class="company-card-name">${escapeHtml(item.name)}</p>
          </a>`,
        )
        .join('\n')
    : '<p class="companies-empty">검색 결과가 없습니다.</p>'
  const searchValue = escapeHtml(pageData.searchQuery)

  return `<div class="app-shell">
    <main>
      <section class="companies-page" aria-label="사기업체 사례">
        <div class="section-wrap companies-grid-wrap">
          <nav aria-label="경로"><a href="/">홈</a> &gt; <a href="/companies">사기업체 게시판</a></nav>
          <h1>${escapeHtml(
            pageData.searchQuery
              ? `“${pageData.searchQuery}” 검색 결과`
              : pageData.page > 1
                ? `사기업체 게시판 ${pageData.page}페이지`
                : '사기업체 게시판',
          )}</h1>
          <form class="company-search-row" action="/companies" method="get" role="search">
            <label class="visually-hidden" for="server-company-search">사기업체 검색</label>
            <div class="company-search-field">
              <input id="server-company-search" name="q" type="search" value="${searchValue}" placeholder="사기업체명 검색" maxlength="${COMPANY_SEARCH_MAX_LENGTH}" autocomplete="off" />
              ${pageData.searchQuery ? '<a class="company-search-clear" href="/companies" aria-label="검색어 지우기">×</a>' : ''}
            </div>
          </form>
          <div class="companies-grid">${cards}</div>
          ${renderPagination(pageData)}
        </div>
      </section>
    </main>
  </div>`
}

// Links between detail pages let crawlers reach each post from its neighbours instead
// of only through the board, which is what the reference site does for every name.
const renderRelatedCompanyCases = (related) =>
  related.length
    ? `<section class="company-related" aria-labelledby="company-related-title">
            <h2 id="company-related-title">함께 확인하면 좋은 사칭 사례</h2>
            <ul class="company-related-list">
              ${related
                .map(
                  (item) => `<li><a class="company-related-link" href="${escapeHtml(getCompanyCasePath(item))}"><strong>${escapeHtml(
                    item.name,
                  )}</strong><span>${escapeHtml(item.service)}</span></a></li>`,
                )
                .join('\n              ')}
            </ul>
          </section>`
    : ''

const renderCompanyCaseServerContent = (companyCase, baseUrl, related = []) => {
  const imageUrl = toAbsoluteUrl(companyCase.image, baseUrl) || `${baseUrl}/logo.png`

  return `<div class="app-shell">
    <main>
      <section class="companies-page" aria-label="사기업체 상세 사례">
        <div class="section-wrap companies-grid-wrap">
          <nav aria-label="경로"><a href="/">홈</a> &gt; <a href="/companies">사기업체 게시판</a> &gt; <span>${escapeHtml(
            companyCase.name,
          )}</span></nav>
          <article class="company-detail">
            <a class="company-detail-back" href="/companies">목록으로</a>
            <div class="company-detail-layout">
              <div class="company-detail-image-wrap">
                <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(companyCase.name)} 이미지" />
              </div>
              <div class="company-detail-copy">
                <p class="company-detail-service">${escapeHtml(companyCase.service)}</p>
                <h1>${escapeHtml(companyCase.name)}</h1>
                ${renderDescriptionParagraphs(companyCase.description)}
              </div>
            </div>
          </article>
          ${renderRelatedCompanyCases(related)}
        </div>
      </section>
    </main>
  </div>`
}

const renderPhoneCompanyCaseServerContent = (companyCase) => `<div class="app-shell">
  <main>
    <section class="companies-page" aria-label="삭제된 사기업체 상세 사례">
      <div class="section-wrap companies-grid-wrap">
        <nav aria-label="경로"><a href="/">홈</a> &gt; <a href="/companies">사기업체 게시판</a> &gt; <span>${escapeHtml(
          companyCase.name,
        )}</span></nav>
        <div class="company-detail company-detail-empty">
          <p class="company-detail-deleted-message">현재 페이지는 삭제되었습니다.<br />해당 내용으로 사칭 피해를 보신 분들은 즉시 ${COMPANY_PHONE_NUMBER}으로 연락 바랍니다.</p>
          <a class="company-detail-call" href="${COMPANY_PHONE_TEL}">전화연결</a>
          <a class="company-detail-back" href="/companies">목록으로</a>
        </div>
      </div>
    </section>
  </main>
</div>`

export const buildCompaniesPageHtml = (html, pageData) => {
  const DEFAULT_IMAGE_URL = `${SITE_BASE_URL}/logo.png`
  const renderPageData = {
    ...pageData,
    items: pageData.items
      .map((item) => resolveCompanyContent(item))
      .filter((item) => item.isPublic !== false && item.isSearchBlocked !== true),
  }
  const isSearchPage = Boolean(renderPageData.searchQuery)
  const pagePath = isSearchPage ? COMPANIES_PAGE_PATH : getCompaniesPagePath(renderPageData.page)
  const canonicalUrl = `${SITE_BASE_URL}${pagePath}`
  const title = isSearchPage
    ? `${renderPageData.searchQuery} 검색 | 사기업체 게시판 | 법무법인 나란`
    : renderPageData.page > 1
      ? `사기업체 게시판 ${renderPageData.page}페이지 | 법무법인 나란`
      : COMPANIES_PAGE_TITLE

  let nextHtml = html.replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${escapeHtml(title)}</title>`)
  nextHtml = replaceOrInsertMeta(nextHtml, 'name', 'description', COMPANIES_PAGE_DESCRIPTION)
  nextHtml = replaceOrInsertMeta(nextHtml, 'name', 'keywords', COMPANIES_PAGE_KEYWORDS)
  // Every list page stays crawlable but out of the index, so a company keyword search
  // lands on that company's detail page instead of the board.
  nextHtml = replaceOrInsertMeta(nextHtml, 'name', 'robots', COMPANY_LIST_ROBOTS)
  nextHtml = replaceOrInsertMeta(nextHtml, 'property', 'og:type', 'website')
  nextHtml = replaceOrInsertMeta(nextHtml, 'property', 'og:site_name', SEARCH_RESULT_SITE_NAME)
  nextHtml = replaceOrInsertMeta(nextHtml, 'property', 'og:title', title)
  nextHtml = replaceOrInsertMeta(nextHtml, 'property', 'og:description', COMPANIES_PAGE_DESCRIPTION)
  nextHtml = replaceOrInsertMeta(nextHtml, 'property', 'og:url', canonicalUrl)
  nextHtml = replaceOrInsertMeta(nextHtml, 'property', 'og:image', DEFAULT_IMAGE_URL)
  nextHtml = replaceOrInsertMeta(nextHtml, 'name', 'twitter:title', title)
  nextHtml = replaceOrInsertMeta(nextHtml, 'name', 'twitter:description', COMPANIES_PAGE_DESCRIPTION)
  nextHtml = replaceOrInsertCanonical(nextHtml, canonicalUrl)
  nextHtml = replaceOrInsertRouteStructuredData(nextHtml, {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        name: title,
        description: COMPANIES_PAGE_DESCRIPTION,
        url: canonicalUrl,
        inLanguage: 'ko-KR',
        isPartOf: {
          '@type': 'WebSite',
          name: SEARCH_RESULT_SITE_NAME,
          url: SITE_BASE_URL,
        },
        about: ['사기업체 게시판', '사기 피해 사례', '피해회복 상담'],
        mainEntity: {
          '@type': 'ItemList',
          name: '사기업체 사례 게시판',
          numberOfItems: renderPageData.totalCount,
          itemListElement: renderPageData.items.map((item, index) => ({
            '@type': 'ListItem',
            position: (renderPageData.page - 1) * COMPANY_CASES_PER_PAGE + index + 1,
            name: item.name,
            url: `${SITE_BASE_URL}${getCompanyCasePath(item)}`,
          })),
        },
      },
      getCompaniesBreadcrumbStructuredData(canonicalUrl, null, SITE_BASE_URL),
    ],
  })
  nextHtml = replaceOrInsertBootstrapData(nextHtml, {
    kind: 'list',
    items: renderPageData.items,
    page: renderPageData.page,
    searchQuery: renderPageData.searchQuery,
    totalCount: renderPageData.totalCount,
    totalPages: renderPageData.totalPages,
  })
  nextHtml = replaceRootContent(nextHtml, renderCompaniesServerContent(renderPageData, SITE_BASE_URL))
  nextHtml = removeHomepageOnlyStructuredData(nextHtml)

  return nextHtml
}

export const buildCompanyCasePageHtml = (html, rawCompanyCase, related = []) => {
  const companyCase = resolveCompanyContent(rawCompanyCase)
  const DEFAULT_IMAGE_URL = `${SITE_BASE_URL}/logo.png`
  const path = getCompanyCasePath(companyCase)
  const canonicalUrl = `${SITE_BASE_URL}${path}`
  const imageUrl = toAbsoluteUrl(companyCase.image, SITE_BASE_URL) || DEFAULT_IMAGE_URL
  const { title, description, keywords, keyword } = getCompanyDetailSeo(companyCase)
  const visibleRelated = companyCase.isPublic === false ? [] : related

  let nextHtml = html.replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${escapeHtml(title)}</title>`)
  nextHtml = replaceOrInsertMeta(nextHtml, 'name', 'description', description)
  nextHtml = replaceOrInsertMeta(nextHtml, 'name', 'keywords', keywords)
  nextHtml = replaceOrInsertMeta(nextHtml, 'name', 'robots', COMPANY_DETAIL_ROBOTS)
  nextHtml = replaceOrInsertMeta(nextHtml, 'property', 'og:type', 'article')
  if (companyCase.datePublished) {
    nextHtml = replaceOrInsertMeta(nextHtml, 'property', 'article:published_time', companyCase.datePublished)
  }
  if (companyCase.dateModified) {
    nextHtml = replaceOrInsertMeta(nextHtml, 'property', 'article:modified_time', companyCase.dateModified)
  }
  nextHtml = replaceOrInsertMeta(nextHtml, 'property', 'og:site_name', SEARCH_RESULT_SITE_NAME)
  nextHtml = replaceOrInsertMeta(nextHtml, 'property', 'og:title', title)
  nextHtml = replaceOrInsertMeta(nextHtml, 'property', 'og:description', description)
  nextHtml = replaceOrInsertMeta(nextHtml, 'property', 'og:url', canonicalUrl)
  nextHtml = replaceOrInsertMeta(nextHtml, 'property', 'og:image', imageUrl)
  nextHtml = replaceOrInsertMeta(nextHtml, 'name', 'twitter:card', 'summary_large_image')
  nextHtml = replaceOrInsertMeta(nextHtml, 'name', 'twitter:title', title)
  nextHtml = replaceOrInsertMeta(nextHtml, 'name', 'twitter:description', description)
  nextHtml = replaceOrInsertMeta(nextHtml, 'name', 'twitter:image', imageUrl)
  nextHtml = replaceOrInsertCanonical(nextHtml, canonicalUrl)
  nextHtml = replaceOrInsertRouteStructuredData(nextHtml, {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article',
        headline: companyCase.name,
        name: title,
        description,
        url: canonicalUrl,
        inLanguage: 'ko-KR',
        image: imageUrl,
        articleSection: companyCase.service,
        keywords,
        ...(companyCase.datePublished ? { datePublished: companyCase.datePublished } : {}),
        ...(companyCase.dateModified ? { dateModified: companyCase.dateModified } : {}),
        mainEntityOfPage: {
          '@type': 'WebPage',
          '@id': canonicalUrl,
        },
        author: {
          '@type': 'Organization',
          name: '법무법인 나란',
          url: SITE_BASE_URL,
        },
        publisher: {
          '@type': 'Organization',
          name: '법무법인 나란',
          url: SITE_BASE_URL,
        },
        about: [
          { '@type': 'Thing', name: keyword },
          companyCase.service,
          '사기 피해 사례',
          '피해회복 상담',
        ],
      },
      getCompaniesBreadcrumbStructuredData(canonicalUrl, companyCase, SITE_BASE_URL),
    ],
  })

  nextHtml = replaceOrInsertBootstrapData(nextHtml, {
    kind: 'detail',
    item: companyCase,
    related: visibleRelated,
  })
  nextHtml = replaceRootContent(
    nextHtml,
    companyCase.isPublic === false
      ? renderPhoneCompanyCaseServerContent(companyCase)
      : renderCompanyCaseServerContent(companyCase, SITE_BASE_URL, visibleRelated),
  )
  nextHtml = removeHomepageOnlyStructuredData(nextHtml)

  return nextHtml
}

export const buildNotFoundPageHtml = (html, requestedPath) => {
  const canonicalUrl = `${SITE_BASE_URL}${requestedPath}`
  const title = '페이지를 찾을 수 없습니다 | 법무법인 나란'
  const content = `<div class="app-shell"><main><section class="section-wrap companies-grid-wrap"><h1>페이지를 찾을 수 없습니다.</h1><p class="company-detail-deleted-message">현재 페이지는 삭제되었습니다.<br />해당 내용으로 사칭 피해를 보신 분들은 즉시 1551-7203으로 연락 바랍니다.</p><a class="company-detail-back" href="/companies">사기업체 게시판으로 이동</a></section></main></div>`

  let nextHtml = html.replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${escapeHtml(title)}</title>`)
  nextHtml = replaceOrInsertMeta(nextHtml, 'name', 'description', '요청한 페이지를 찾을 수 없습니다.')
  nextHtml = replaceOrInsertMeta(nextHtml, 'name', 'robots', 'noindex,follow')
  nextHtml = replaceOrInsertCanonical(nextHtml, canonicalUrl)
  nextHtml = replaceRootContent(nextHtml, content)
  nextHtml = removeHomepageOnlyStructuredData(nextHtml)
  nextHtml = nextHtml.replace(/<script\s+[^>]*type=["']module["'][^>]*><\/script>/i, '')
  return nextHtml
}

const getRequestCompanyCaseId = (req) => {
  const queryId = Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id

  if (queryId) {
    try {
      return decodeURIComponent(toTrimmedString(queryId))
    } catch {
      return toTrimmedString(queryId)
    }
  }

  try {
    const url = new URL(req.url, SITE_BASE_URL)
    return toTrimmedString(url.searchParams.get('id'))
  } catch {
    return ''
  }
}

const getRequestQueryValue = (req, key) => {
  const queryValue = Array.isArray(req.query?.[key]) ? req.query[key][0] : req.query?.[key]

  if (queryValue !== undefined && queryValue !== null) {
    return toTrimmedString(queryValue)
  }

  try {
    const url = new URL(req.url, SITE_BASE_URL)
    return toTrimmedString(url.searchParams.get(key))
  } catch {
    return ''
  }
}

const getRequestPage = (req) => {
  const rawPage = getRequestQueryValue(req, 'page')

  if (!rawPage) {
    return { page: 1, valid: true }
  }

  if (!/^\d+$/.test(rawPage)) {
    return { page: 1, valid: false }
  }

  const page = Number.parseInt(rawPage, 10)
  return { page, valid: Number.isSafeInteger(page) && page >= 1 }
}

const sendHtml = (req, res, status, html, cacheControl) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', cacheControl)

  if (req.method === 'HEAD') {
    return res.status(status).end()
  }

  return res.status(status).send(html)
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD')
    return res.status(405).end('Method Not Allowed')
  }

  try {
    const id = getRequestCompanyCaseId(req)
    const indexHtml = await getIndexHtml()

    if (id) {
      const result = await getCompanyCase(id)

      if (!result) {
        const requestedPath = `/companies/${encodeURIComponent(id)}`
        return sendHtml(req, res, 404, buildNotFoundPageHtml(indexHtml, requestedPath), 'no-store')
      }

      // Old random-id URLs that search engines already indexed move permanently
      // to the keyword URL, carrying their ranking with them.
      if (result.redirectTo) {
        res.setHeader('Location', result.redirectTo)
        res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600')
        return res.status(301).end()
      }

      const { companyCase, related } = result

      return sendHtml(
        req,
        res,
        200,
        buildCompanyCasePageHtml(indexHtml, companyCase, related),
        companyCase.isPublic === false
          ? 'private, no-store'
          : 'public, s-maxage=300, stale-while-revalidate=3600',
      )
    }

    const requestedPage = getRequestPage(req)
    const searchQuery = getRequestQueryValue(req, 'q').slice(0, COMPANY_SEARCH_MAX_LENGTH)

    if (!requestedPage.valid) {
      return sendHtml(req, res, 404, buildNotFoundPageHtml(indexHtml, COMPANIES_PAGE_PATH), 'no-store')
    }

    const pageData = await getCompaniesPage({ page: requestedPage.page, searchQuery })

    if (pageData.totalCount > 0 && pageData.page > pageData.totalPages) {
      return sendHtml(
        req,
        res,
        404,
        buildNotFoundPageHtml(indexHtml, getCompaniesPagePath(pageData.page, searchQuery)),
        'no-store',
      )
    }

    return sendHtml(
      req,
      res,
      200,
      buildCompaniesPageHtml(indexHtml, pageData),
      'private, no-store',
    )
  } catch (error) {
    console.error('[api/company-page] error', error)
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Retry-After', '60')
    return res.status(503).send('Service Unavailable')
  }
}
