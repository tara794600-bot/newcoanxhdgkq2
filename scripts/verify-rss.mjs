import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { mock } from 'node:test'
import { Timestamp } from 'firebase-admin/firestore'
import { createRssHandler } from '../api/rss.js'
import { getLatestRssCompanyCases, renderRss } from '../server/rss.js'
import { CONTENT_SITES } from '../shared/company-content.js'

const createdAt = Timestamp.fromDate(new Date('2026-10-07T00:00:00Z'))
const post = (id, overrides = {}) => ({
  id,
  data: () => ({ name: `업체 ${id}`, service: '투자 사례', description: '상세 본문', createdAt, ...overrides }),
})

// Snapshot cursors, including tied dates, are exercised against more than 500 posts.
const documents = Array.from({ length: 620 }, (_, index) => post(`post-${String(index).padStart(3, '0')}`, {
  createdAt: Timestamp.fromMillis(createdAt.toMillis() - Math.floor(index / 3) * 1000),
  ...(index % 10 === 0 ? { isPublic: false } : {}),
  ...(index % 10 === 1 ? { isSearchBlocked: true } : {}),
  ...(index % 10 === 2 ? { description: '' } : {}),
})).reverse()
let readCount = 0
const collection = (records) => ({
  orderBy(field, direction) {
    assert.equal(field, 'createdAt')
    assert.equal(direction, 'desc')
    const sorted = [...records].sort((a, b) => b.data().createdAt.toMillis() - a.data().createdAt.toMillis() || a.id.localeCompare(b.id))
    const query = (offset = 0) => ({
      startAfter(cursor) {
        assert.ok(sorted.includes(cursor), 'Use a document cursor so tied timestamps are not skipped')
        return query(sorted.indexOf(cursor) + 1)
      },
      limit(size) {
        assert.ok(size > 0 && size <= 500)
        return { async get() { readCount += 1; return { docs: sorted.slice(offset, offset + size) } } }
      },
    })
    return query()
  },
})

// 620 records with 20% excluded leave fewer than 500 eligible details.
const fewer = await getLatestRssCompanyCases(collection(documents))
assert.equal(fewer.length, 496)
assert.ok(fewer.some((item) => item.id === 'post-001'), 'Search-blocked posts must be included')
assert.equal(fewer[0].id, 'post-001')
assert.equal(fewer.at(-1).id, 'post-619')
assert.ok(readCount > 1, 'Continue fetching after excluded records')
assert.equal(new Set(fewer.map((item) => item.id)).size, fewer.length)

documents.push(...Array.from({ length: 20 }, (_, index) => post(`new-${index}`, {
  createdAt: Timestamp.fromMillis(createdAt.toMillis() + (index + 1) * 1000),
  // Updating an older post must not change the feed's publication order.
  updatedAt: Timestamp.fromMillis(createdAt.toMillis() + 100000),
})))
const latest = await getLatestRssCompanyCases(collection(documents))
assert.equal(latest.length, 500)
assert.equal(latest[0].id, 'new-19')
assert.equal(latest[19].id, 'new-0')
assert.equal(latest[20].id, 'post-001')
assert.equal(latest.at(-1).id, 'post-599')
assert.deepEqual(await getLatestRssCompanyCases(collection([])), [])
assert.deepEqual(await getLatestRssCompanyCases(collection([post('phone', { isPublic: false })])), [])
readCount = 0
assert.equal((await getLatestRssCompanyCases(collection(Array.from({ length: 500 }, (_, index) => post(`exact-${index}`))))).length, 500)
assert.equal(readCount, 1, 'A full eligible batch should not require another read')

const response = () => ({
  headers: {}, statusCode: 0, body: '',
  setHeader(name, value) { this.headers[name] = value },
  status(code) { this.statusCode = code; return this },
  send(body) { this.body = body; return this },
  end(body = '') { this.body = body; return this },
})

const handler = createRssHandler(() => getLatestRssCompanyCases(collection(documents)))
for (const site of CONTENT_SITES) {
  const req = { method: 'GET', headers: { host: new URL(site.url).host } }
  const res = response()
  await handler(req, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['Content-Type'], 'application/rss+xml; charset=utf-8')
  assert.equal(res.headers['Cache-Control'], 'public, max-age=0, s-maxage=300')
  assert.equal((res.body.match(/<item>/g) ?? []).length, 500)
  assert.ok(res.body.includes(`<link>${site.url}/companies/post-001</link>`))
  assert.ok(res.body.includes(`href="${site.url}/rss.xml"`))
  assert.doesNotMatch(res.body, /\/companies\/post-000<|\/companies\/post-002</)
  for (const otherSite of CONTENT_SITES.filter((other) => other.id !== site.id)) assert.ok(!res.body.includes(otherSite.url))
  const expectedTitle = site.id === 'site1' ? '업체 new-19' : site.id === 'site2' ? '업체 new-19 | 투자 사례 사례 정리' : '업체 new-19 피해 관련 확인 사항'
  assert.ok(res.body.includes(`<title>${expectedTitle}</title>`))
  const head = response()
  await handler({ ...req, method: 'HEAD' }, head)
  assert.equal(head.statusCode, 200)
  assert.equal(head.body, '')
  assert.deepEqual(head.headers, res.headers)
}

documents.push(post('just-published', { createdAt: Timestamp.fromMillis(createdAt.toMillis() + 200000) }))
const refreshed = response()
await handler({ method: 'GET', headers: {} }, refreshed)
assert.match(refreshed.body, /<item>\s*<title>업체 just-published/)
assert.equal((refreshed.body.match(/<item>/g) ?? []).length, 500)

const special = { id: '한글 &?#', name: '이름 & <태그> "인용"', service: '유형 & 분류', description: '본문 ]]> & < > \u0000\u0001\uD800 😀', createdAt }
const xml = renderRss([special], CONTENT_SITES[0], createdAt.toDate())
assert.match(xml, /이름 &amp; &lt;태그&gt; &quot;인용&quot;/)
assert.match(xml, /본문 \]\]&gt; &amp; &lt; &gt;  😀/)
assert.ok(xml.includes(`/companies/${encodeURIComponent(special.id)}`))
assert.match(xml, /<pubDate>Wed, 07 Oct 2026 00:00:00 GMT<\/pubDate>/)
assert.match(xml, /<lastBuildDate>Wed, 07 Oct 2026 00:00:00 GMT<\/lastBuildDate>/)
assert.doesNotMatch(renderRss([{ ...special, createdAt: 'bad-date' }], CONTENT_SITES[0]), /Invalid Date|<pubDate>/)
const bigFeed = renderRss(Array.from({ length: 501 }, (_, index) => ({ ...special, id: `long-${index}`, description: '&'.repeat(2000) })), CONTENT_SITES[0])
assert.equal((bigFeed.match(/<item>/g) ?? []).length, 500)
assert.ok(Buffer.byteLength(bigFeed) < 4_500_000, 'Description excerpts must keep the 500-item feed within the response limit')
assert.match(bigFeed, /…<\/description>/)

const rejected = response()
await createRssHandler(() => { throw new Error('Must not read on POST') })({ method: 'POST' }, rejected)
assert.equal(rejected.statusCode, 405)
assert.equal(rejected.headers.Allow, 'GET, HEAD')
const quietError = mock.method(console, 'error', () => {})
try {
  for (const method of ['GET', 'HEAD']) {
    const failed = response()
    await createRssHandler(() => { throw new Error('Firestore unavailable') })({ method }, failed)
    assert.equal(failed.statusCode, 503)
    assert.equal(failed.headers['Cache-Control'], 'no-store')
    assert.equal(failed.headers['Retry-After'], '60')
    assert.equal(failed.body, method === 'HEAD' ? '' : 'Service Unavailable')
  }
} finally {
  quietError.mock.restore()
}

const routes = JSON.parse(await readFile('vercel.json', 'utf8')).rewrites
const rssRoute = routes.findIndex((rule) => rule.source === '/rss.xml' && rule.destination === '/api/rss')
assert.ok(rssRoute >= 0 && rssRoute < routes.findIndex((rule) => rule.source === '/(.*)'))
await assert.rejects(readFile('public/rss.xml'), { code: 'ENOENT' })
console.log('RSS verified: latest 500, search-blocked inclusion, cursor pagination, live refresh, 3 domains, XML escaping, response size, GET/HEAD and errors.')
