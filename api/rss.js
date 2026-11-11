import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { assignCompanySlugs } from '../shared/company-slug.js'
import { getLatestRssCompanyCases, renderRss } from '../server/rss.js'

const parseJsonEnv = (key) => {
  const value = process.env[key]
  if (!value?.trim()) return null

  let account
  try {
    account = JSON.parse(value)
  } catch {
    throw new Error(`${key} 환경변수가 JSON 형식이 아닙니다.`)
  }

  if (account && typeof account.private_key === 'string') {
    account.private_key = account.private_key.replace(/\\n/g, '\n')
  }
  return account
}

const loadCompanyCases = async () => {
  let app = getApps()[0]
  if (!app) {
    const account = parseJsonEnv('FIREBASE_SERVICE_ACCOUNT_JSON') ?? parseJsonEnv('GOOGLE_SERVICE_ACCOUNT_JSON')
    if (!account) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON 환경변수를 설정해주세요.')
    app = initializeApp({ credential: cert(account) })
  }
  const collectionRef = getFirestore(app).collection('companyCases')
  const [items, nameSnapshot] = await Promise.all([
    getLatestRssCompanyCases(collectionRef),
    // Keyword URLs depend on every post's name, not just the 500 in the feed.
    collectionRef.select('name', 'createdAt').get(),
  ])
  const slugs = assignCompanySlugs(
    nameSnapshot.docs
      .map((doc) => {
        const data = doc.data() ?? {}
        return { id: doc.id, name: typeof data.name === 'string' ? data.name.trim() : '', createdAt: data.createdAt }
      })
      .filter((entry) => entry.name),
  )
  return items.map((item) => ({ ...item, slug: slugs.get(item.id) ?? item.id }))
}

export const createRssHandler = (loadItems = loadCompanyCases) => async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD')
    return res.status(405).end('Method Not Allowed')
  }

  try {
    const companyCases = await loadItems()
    const rss = renderRss(companyCases)
    res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8')
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300')

    if (req.method === 'HEAD') return res.status(200).end()
    return res.status(200).send(rss)
  } catch (error) {
    console.error('[api/rss] RSS generation failed', error)
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Retry-After', '60')
    return res.status(503).end(req.method === 'HEAD' ? undefined : 'Service Unavailable')
  }
}

export default createRssHandler()
