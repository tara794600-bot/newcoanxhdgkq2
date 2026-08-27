import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SITE_BASE_URL = (process.env.SITE_URL || process.env.VITE_SITE_URL || 'https://www.naranfintech.com').replace(
  /\/+$/,
  '',
)
const DEFAULT_IMAGE_URL = `${SITE_BASE_URL}/logo.png`
const DESCRIPTION_MAX_LENGTH = 155
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

const normalizeSeoText = (value) =>
  toTrimmedString(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const getDescriptionExcerpt = (description, fallback) => {
  const source = normalizeSeoText(description) || normalizeSeoText(fallback)

  if (source.length <= DESCRIPTION_MAX_LENGTH) {
    return source
  }

  const clipped = source.slice(0, DESCRIPTION_MAX_LENGTH).trim()
  const lastSpaceIndex = clipped.lastIndexOf(' ')
  const readableClip =
    lastSpaceIndex >= Math.floor(DESCRIPTION_MAX_LENGTH * 0.6)
      ? clipped.slice(0, lastSpaceIndex).trim()
      : clipped

  return `${readableClip}...`
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
    return html.replace(rootRegex, root)
  }

  return html.replace('</body>', `  ${root}\n  </body>`)
}

const replaceOrInsertBootstrapData = (html, data) => {
  const tag = `<script id="company-page-data">window.__COMPANY_PAGE_DATA__=${escapeJsonForHtml(data)}</script>`
  const regex = /<script\s+[^>]*id=["']company-page-data["'][^>]*>[\s\S]*?<\/script>/i

  if (regex.test(html)) {
    return html.replace(regex, tag)
  }

  return upsertHeadTag(html, tag)
}

const renderDescriptionParagraphs = (description) => {
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

const toAbsoluteUrl = (value) => {
  const trimmedValue = toTrimmedString(value)

  if (!trimmedValue) {
    return ''
  }

  try {
    return new URL(trimmedValue, `${SITE_BASE_URL}/`).toString()
  } catch {
    return trimmedValue
  }
}

const upsertHeadTag = (html, tag) => {
  if (!html.includes('</head>')) {
    return `${html}\n${tag}`
  }

  return html.replace('</head>', `    ${tag}\n  </head>`)
}

const replaceOrInsertMeta = (html, attribute, key, content) => {
  const tag = `<meta ${attribute}="${escapeHtml(key)}" content="${escapeHtml(content)}" />`
  const regex = new RegExp(`<meta\\s+[^>]*${attribute}=["']${escapeRegExp(key)}["'][^>]*>`, 'i')

  if (regex.test(html)) {
    return html.replace(regex, tag)
  }

  return upsertHeadTag(html, tag)
}

const replaceOrInsertCanonical = (html, href) => {
  const tag = `<link rel="canonical" href="${escapeHtml(href)}" />`
  const regex = /<link\s+[^>]*rel=["']canonical["'][^>]*>/i

  if (regex.test(html)) {
    return html.replace(regex, tag)
  }

  return upsertHeadTag(html, tag)
}

const replaceOrInsertRouteStructuredData = (html, data) => {
  const json = JSON.stringify(data).replace(/</g, '\\u003c')
  const tag = `<script id="route-structured-data" type="application/ld+json">${json}</script>`
  const regex = /<script\s+[^>]*id=["']route-structured-data["'][^>]*>[\s\S]*?<\/script>/i

  if (regex.test(html)) {
    return html.replace(regex, tag)
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

const getCompaniesBreadcrumbStructuredData = (canonicalUrl, companyCase = null) => ({
  '@type': 'BreadcrumbList',
  itemListElement: [
    {
      '@type': 'ListItem',
      position: 1,
      name: SEARCH_RESULT_SITE_NAME,
      item: `${SITE_BASE_URL}/`,
    },
    {
      '@type': 'ListItem',
      position: 2,
      name: SEARCH_RESULT_SECTION_NAME,
      item: `${SITE_BASE_URL}${COMPANIES_PAGE_PATH}`,
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
    image: image || DEFAULT_IMAGE_URL,
    isPublic: data.isPublic !== false,
    datePublished: toIsoDateTime(data.createdAt),
    dateModified: toIsoDateTime(data.updatedAt ?? data.createdAt),
  }
}

const getCompanyCase = async (id) => {
  const app = getFirebaseApp()
  const snapshot = await getFirestore(app).collection('companyCases').doc(id).get()

  if (!snapshot.exists) {
    return null
  }

  const companyCase = mapCompanyCase(snapshot)
  return companyCase?.isPublic === false ? null : companyCase
}

const getCompaniesPage = async ({ page, searchQuery }) => {
  const app = getFirebaseApp()
  const collectionRef = getFirestore(app).collection('companyCases')
  let items = []
  let totalCount = 0

  if (searchQuery) {
    const snapshot = await collectionRef.orderBy('createdAt', 'desc').get()
    const normalizedSearchQuery = searchQuery.toLocaleLowerCase('ko-KR')
    const matchedItems = snapshot.docs
      .map(mapCompanyCase)
      .filter(Boolean)
      .filter((item) => item.isPublic !== false)
      .filter((item) =>
        [item.name, item.service, item.description].some((value) =>
          value.toLocaleLowerCase('ko-KR').includes(normalizedSearchQuery),
        ),
      )

    totalCount = matchedItems.length
    const startIndex = (page - 1) * COMPANY_CASES_PER_PAGE
    items = matchedItems.slice(startIndex, startIndex + COMPANY_CASES_PER_PAGE)
  } else {
    const privateSnapshot = await collectionRef.where('isPublic', '==', false).limit(1).get()

    if (privateSnapshot.empty) {
      const countSnapshot = await collectionRef.count().get()
      totalCount = countSnapshot.data().count

      if (totalCount > 0) {
        const offset = (page - 1) * COMPANY_CASES_PER_PAGE
        const snapshot = await collectionRef
          .orderBy('createdAt', 'desc')
          .offset(offset)
          .limit(COMPANY_CASES_PER_PAGE)
          .get()
        items = snapshot.docs.map(mapCompanyCase).filter(Boolean)
      }
    } else {
      const snapshot = await collectionRef.orderBy('createdAt', 'desc').get()
      const publicItems = snapshot.docs
        .map(mapCompanyCase)
        .filter(Boolean)
        .filter((item) => item.isPublic !== false)

      totalCount = publicItems.length
      const startIndex = (page - 1) * COMPANY_CASES_PER_PAGE
      items = publicItems.slice(startIndex, startIndex + COMPANY_CASES_PER_PAGE)
    }
  }

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

const renderCompaniesServerContent = (pageData) => {
  const cards = pageData.items.length
    ? pageData.items
        .map(
          (item) => `<a class="company-card company-card-filled company-card-link" href="${escapeHtml(
            `/companies/${encodeURIComponent(item.id)}`,
          )}">
            <div class="company-card-thumb-wrap">
              <img src="${escapeHtml(toAbsoluteUrl(item.image) || DEFAULT_IMAGE_URL)}" alt="${escapeHtml(
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

const renderCompanyCaseServerContent = (companyCase) => {
  const imageUrl = toAbsoluteUrl(companyCase.image) || DEFAULT_IMAGE_URL

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
        </div>
      </section>
    </main>
  </div>`
}

export const buildCompaniesPageHtml = (html, pageData) => {
  const isSearchPage = Boolean(pageData.searchQuery)
  const pagePath = isSearchPage ? COMPANIES_PAGE_PATH : getCompaniesPagePath(pageData.page)
  const canonicalUrl = `${SITE_BASE_URL}${pagePath}`
  const title = isSearchPage
    ? `${pageData.searchQuery} 검색 | 사기업체 게시판 | 법무법인 나란`
    : pageData.page > 1
      ? `사기업체 게시판 ${pageData.page}페이지 | 법무법인 나란`
      : COMPANIES_PAGE_TITLE

  let nextHtml = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`)
  nextHtml = replaceOrInsertMeta(nextHtml, 'name', 'description', COMPANIES_PAGE_DESCRIPTION)
  nextHtml = replaceOrInsertMeta(nextHtml, 'name', 'keywords', COMPANIES_PAGE_KEYWORDS)
  nextHtml = replaceOrInsertMeta(
    nextHtml,
    'name',
    'robots',
    isSearchPage
      ? 'noindex,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1'
      : 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1',
  )
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
          numberOfItems: pageData.totalCount,
          itemListElement: pageData.items.map((item, index) => ({
            '@type': 'ListItem',
            position: (pageData.page - 1) * COMPANY_CASES_PER_PAGE + index + 1,
            name: item.name,
            url: `${SITE_BASE_URL}/companies/${encodeURIComponent(item.id)}`,
          })),
        },
      },
      getCompaniesBreadcrumbStructuredData(canonicalUrl),
    ],
  })
  nextHtml = replaceOrInsertBootstrapData(nextHtml, {
    kind: 'list',
    items: pageData.items,
    page: pageData.page,
    searchQuery: pageData.searchQuery,
    totalCount: pageData.totalCount,
    totalPages: pageData.totalPages,
  })
  nextHtml = replaceRootContent(nextHtml, renderCompaniesServerContent(pageData))
  nextHtml = removeHomepageOnlyStructuredData(nextHtml)

  return nextHtml
}

export const buildCompanyCasePageHtml = (html, companyCase) => {
  const path = `/companies/${encodeURIComponent(companyCase.id)}`
  const canonicalUrl = `${SITE_BASE_URL}${path}`
  const imageUrl = toAbsoluteUrl(companyCase.image) || DEFAULT_IMAGE_URL
  const title = `${companyCase.name} | 사기업체 게시판 | 법무법인 나란`
  const description = getDescriptionExcerpt(
    companyCase.description,
    `${companyCase.name} 관련 ${companyCase.service} 피해 사례와 피해회복 상담 정보를 확인하세요.`,
  )
  const keywords = `${companyCase.name}, ${companyCase.service}, ${companyCase.name} 사기, 사기업체 게시판, 사기 피해 사례, 피해회복 상담, 법무법인 나란`

  let nextHtml = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`)
  nextHtml = replaceOrInsertMeta(nextHtml, 'name', 'description', description)
  nextHtml = replaceOrInsertMeta(nextHtml, 'name', 'keywords', keywords)
  nextHtml = replaceOrInsertMeta(nextHtml, 'property', 'og:type', 'article')
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
        about: [companyCase.name, companyCase.service, '사기 피해 사례', '피해회복 상담'],
      },
      getCompaniesBreadcrumbStructuredData(canonicalUrl, companyCase),
    ],
  })

  nextHtml = replaceOrInsertBootstrapData(nextHtml, {
    kind: 'detail',
    item: companyCase,
  })
  nextHtml = replaceRootContent(nextHtml, renderCompanyCaseServerContent(companyCase))
  nextHtml = removeHomepageOnlyStructuredData(nextHtml)

  return nextHtml
}

export const buildNotFoundPageHtml = (html, requestedPath) => {
  const canonicalUrl = `${SITE_BASE_URL}${requestedPath}`
  const title = '페이지를 찾을 수 없습니다 | 법무법인 나란'
  const content = `<div class="app-shell"><main><section class="section-wrap companies-grid-wrap"><h1>페이지를 찾을 수 없습니다.</h1><p class="company-detail-deleted-message">삭제되었으나 해당 내용으로 피해 보신 분들은 즉시 1551-7203으로 연락 바랍니다.</p><a class="company-detail-back" href="/companies">사기업체 게시판으로 이동</a></section></main></div>`

  let nextHtml = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`)
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
      const companyCase = await getCompanyCase(id)

      if (!companyCase) {
        const requestedPath = `/companies/${encodeURIComponent(id)}`
        return sendHtml(req, res, 404, buildNotFoundPageHtml(indexHtml, requestedPath), 'no-store')
      }

      return sendHtml(
        req,
        res,
        200,
        buildCompanyCasePageHtml(indexHtml, companyCase),
        'public, s-maxage=300, stale-while-revalidate=3600',
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
      searchQuery ? 'private, no-store' : 'public, s-maxage=300, stale-while-revalidate=3600',
    )
  } catch (error) {
    console.error('[api/company-page] error', error)
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Retry-After', '60')
    return res.status(503).send('Service Unavailable')
  }
}
