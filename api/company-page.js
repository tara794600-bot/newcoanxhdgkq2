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

const getCompanyCase = async (id) => {
  const app = getFirebaseApp()
  const snapshot = await getFirestore(app).collection('companyCases').doc(id).get()

  if (!snapshot.exists) {
    return null
  }

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
    image,
  }
}

const applyCompaniesPageSeo = (html) => {
  const canonicalUrl = `${SITE_BASE_URL}${COMPANIES_PAGE_PATH}`

  let nextHtml = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(COMPANIES_PAGE_TITLE)}</title>`)
  nextHtml = replaceOrInsertMeta(nextHtml, 'name', 'description', COMPANIES_PAGE_DESCRIPTION)
  nextHtml = replaceOrInsertMeta(nextHtml, 'name', 'keywords', COMPANIES_PAGE_KEYWORDS)
  nextHtml = replaceOrInsertMeta(nextHtml, 'property', 'og:type', 'website')
  nextHtml = replaceOrInsertMeta(nextHtml, 'property', 'og:site_name', SEARCH_RESULT_SITE_NAME)
  nextHtml = replaceOrInsertMeta(nextHtml, 'property', 'og:title', COMPANIES_PAGE_TITLE)
  nextHtml = replaceOrInsertMeta(nextHtml, 'property', 'og:description', COMPANIES_PAGE_DESCRIPTION)
  nextHtml = replaceOrInsertMeta(nextHtml, 'property', 'og:url', canonicalUrl)
  nextHtml = replaceOrInsertMeta(nextHtml, 'property', 'og:image', DEFAULT_IMAGE_URL)
  nextHtml = replaceOrInsertMeta(nextHtml, 'name', 'twitter:title', COMPANIES_PAGE_TITLE)
  nextHtml = replaceOrInsertMeta(nextHtml, 'name', 'twitter:description', COMPANIES_PAGE_DESCRIPTION)
  nextHtml = replaceOrInsertCanonical(nextHtml, canonicalUrl)
  nextHtml = replaceOrInsertRouteStructuredData(nextHtml, {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        name: COMPANIES_PAGE_TITLE,
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
          description: '금융사기 의심 업체 및 사기 피해 사례를 모아 확인하는 게시판입니다.',
        },
      },
      getCompaniesBreadcrumbStructuredData(canonicalUrl),
    ],
  })

  return nextHtml
}

const applyCompanyCaseSeo = (html, companyCase) => {
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

  return nextHtml
}

const getRequestCompanyCaseId = (req) => {
  const queryId = Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id

  if (queryId) {
    return toTrimmedString(queryId)
  }

  try {
    const url = new URL(req.url, SITE_BASE_URL)
    return toTrimmedString(url.searchParams.get('id'))
  } catch {
    return ''
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD')
    return res.status(405).end('Method Not Allowed')
  }

  try {
    const id = getRequestCompanyCaseId(req)
    const indexHtml = await getIndexHtml()
    let companyCase = null

    if (id) {
      try {
        companyCase = await getCompanyCase(id)
      } catch (error) {
        console.error('[api/company-page] Firestore read failed', error)
      }
    }

    const html = companyCase ? applyCompanyCaseSeo(indexHtml, companyCase) : applyCompaniesPageSeo(indexHtml)

    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', companyCase ? 'public, s-maxage=300, stale-while-revalidate=3600' : 'public, s-maxage=60')

    if (req.method === 'HEAD') {
      return res.status(200).end()
    }

    return res.status(200).send(html)
  } catch (error) {
    console.error('[api/company-page] error', error)
    return res.status(500).send('Internal Server Error')
  }
}
