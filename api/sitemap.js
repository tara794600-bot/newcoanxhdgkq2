import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const SITE_BASE_URL = (process.env.SITE_URL || process.env.VITE_SITE_URL || 'https://www.naranfintech.com').replace(
  /\/+$/,
  '',
)

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

const escapeXml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

const toDateString = (value) => {
  if (value && typeof value.toDate === 'function') {
    return value.toDate().toISOString().slice(0, 10)
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }

  if (typeof value === 'string' && value.trim()) {
    const parsedDate = new Date(value)

    if (!Number.isNaN(parsedDate.getTime())) {
      return parsedDate.toISOString().slice(0, 10)
    }
  }

  return new Date().toISOString().slice(0, 10)
}

const getCompanyCaseUrls = async () => {
  const app = getFirebaseApp()
  const snapshot = await getFirestore(app).collection('companyCases').get()

  return snapshot.docs
    .map((snapshotDoc) => {
      const data = snapshotDoc.data() ?? {}
      const name = toTrimmedString(data.name)
      const service = toTrimmedString(data.service)
      const description = toTrimmedString(data.description)

      if (!name || !service || !description) {
        return null
      }

      return {
        loc: `${SITE_BASE_URL}/companies/${encodeURIComponent(snapshotDoc.id)}`,
        lastmod: toDateString(data.updatedAt ?? data.createdAt),
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.loc.localeCompare(b.loc))
}

const renderUrl = ({ loc, lastmod, changefreq, priority }) => `  <url>
    <loc>${escapeXml(loc)}</loc>
    <lastmod>${escapeXml(lastmod)}</lastmod>
    <changefreq>${escapeXml(changefreq)}</changefreq>
    <priority>${escapeXml(priority)}</priority>
  </url>`

const renderSitemap = (companyUrls) => {
  const today = new Date().toISOString().slice(0, 10)
  const urls = [
    {
      loc: `${SITE_BASE_URL}/`,
      lastmod: '2026-05-08',
      changefreq: 'weekly',
      priority: '1.0',
    },
    {
      loc: `${SITE_BASE_URL}/lawyers`,
      lastmod: '2026-05-08',
      changefreq: 'monthly',
      priority: '0.8',
    },
    {
      loc: `${SITE_BASE_URL}/companies`,
      lastmod: today,
      changefreq: 'daily',
      priority: '0.8',
    },
    ...companyUrls.map((item) => ({
      ...item,
      changefreq: 'weekly',
      priority: '0.7',
    })),
    {
      loc: `${SITE_BASE_URL}/rss.xml`,
      lastmod: today,
      changefreq: 'daily',
      priority: '0.3',
    },
  ]

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(renderUrl).join('\n')}
</urlset>
`
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD')
    return res.status(405).end('Method Not Allowed')
  }

  let companyUrls = []

  try {
    companyUrls = await getCompanyCaseUrls()
  } catch (error) {
    console.error('[api/sitemap] Firestore read failed', error)
  }

  const sitemap = renderSitemap(companyUrls)

  res.setHeader('Content-Type', 'application/xml; charset=utf-8')
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600')

  if (req.method === 'HEAD') {
    return res.status(200).end()
  }

  return res.status(200).send(sitemap)
}
