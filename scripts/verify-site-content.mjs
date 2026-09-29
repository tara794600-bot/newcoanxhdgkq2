import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { domainToUnicode } from 'node:url'
import { CONTENT_SITES, createCompanyContentVariants, getContentSite, matchesCompanySearch, resolveCompanyContent } from '../shared/company-content.js'
import { getRequestContentSite } from '../server/content-site.js'
import { buildCompaniesPageHtml, buildCompanyCasePageHtml, buildNotFoundPageHtml } from '../api/company-page.js'
import { renderSitemap } from '../api/sitemap.js'

const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8')
const original = Object.freeze({
  id: 'shared-post', name: '샘플 업체', service: '투자사기',
  description: '원문 첫 줄입니다.\n두 번째 줄의 사실관계를 그대로 보존합니다.',
  image: '/logo.png', isPublic: true, isSearchBlocked: false,
})
const variants = createCompanyContentVariants(original)
assert.equal(new Set(Object.values(variants).map((item) => item.title)).size, 3)
assert.equal(new Set(Object.values(variants).map((item) => item.description)).size, 3)

const readBootstrap = (page) => JSON.parse(page.match(/window\.__COMPANY_PAGE_DATA__=([\s\S]*?)<\/script>/)[1])
const readArticle = (page) => JSON.parse(page.match(/id="route-structured-data"[^>]*>([\s\S]*?)<\/script>/)[1])['@graph'][0]

for (const site of CONTENT_SITES) {
  const hostname = new URL(site.url).hostname
  assert.equal(getContentSite({ hostname }).id, site.id)
  assert.equal(getContentSite({ hostname: hostname.replace('www.', '') }).id, site.id)
  assert.equal(getContentSite({ hostname: `${hostname.toUpperCase()}:443` }).id, site.id)
  assert.equal(getContentSite({ hostname: domainToUnicode(hostname) }).id, site.id)
  assert.equal(getContentSite({ hostname, siteId: 'site1' }).id, site.id)
  assert.equal(getRequestContentSite({ headers: { host: hostname } }).id, site.id)
  assert.equal(getContentSite({ hostname: 'localhost', siteId: site.id }).id, site.id)
  assert.equal(getContentSite({ hostname: 'preview.vercel.app', siteUrl: site.url }).id, site.id)

  const expected = resolveCompanyContent(original, site.id)
  assert.equal(expected.id, original.id)
  assert.ok(expected.description.endsWith(original.description))
  assert.ok(matchesCompanySearch(original, expected.name, site.id))
  assert.ok(matchesCompanySearch(original, '두 번째 줄', site.id))
  assert.equal(matchesCompanySearch(original, '없는 검색어', site.id), false)
  assert.equal(resolveCompanyContent(original, site.id).name, expected.name)

  const detail = buildCompanyCasePageHtml(html, original, site)
  assert.ok(detail.includes(`<title>${expected.name} | 사기업체 게시판 | 법무법인 나란</title>`))
  assert.ok(detail.includes(`<h1>${expected.name}</h1>`))
  assert.ok(detail.includes(`rel="canonical" href="${site.url}/companies/shared-post"`))
  assert.ok(detail.includes(`property="og:title" content="${expected.name} | 사기업체 게시판 | 법무법인 나란"`))
  assert.ok(detail.includes(`name="twitter:title" content="${expected.name} | 사기업체 게시판 | 법무법인 나란"`))
  assert.equal(readBootstrap(detail).item.description, expected.description)
  assert.equal(readBootstrap(detail).item.name, expected.name)
  assert.equal(readArticle(detail).headline, expected.name)
  assert.equal(readArticle(detail).description, expected.description.replace(/\s+/g, ' '))
  if (site.id !== 'site1') assert.ok(!detail.includes(CONTENT_SITES[0].url))

  const list = buildCompaniesPageHtml(html, { items: [original], page: 1, searchQuery: '', totalCount: 1, totalPages: 1 }, site)
  assert.equal(readBootstrap(list).items[0].name, expected.name)
  assert.equal(readBootstrap(list).items[0].description, expected.description)
  assert.ok(list.includes(`<p class="company-card-name">${expected.name}</p>`))
  assert.ok(buildNotFoundPageHtml(html, '/companies/missing', site).includes(`${site.url}/companies/missing`))
  assert.ok(renderSitemap([], site).includes(`<loc>${site.url}/companies</loc>`))

  const phone = buildCompanyCasePageHtml(html, { ...original, isPublic: false }, site)
  assert.ok(phone.includes('href="tel:15517203"'))
  assert.equal(readBootstrap(phone).item.name, expected.name)
  const blocked = buildCompaniesPageHtml(html, { items: [{ ...original, isSearchBlocked: true }], page: 1, searchQuery: '', totalCount: 0, totalPages: 1 }, site)
  assert.equal(readBootstrap(blocked).items.length, 0)

  const edited = { ...original, name: '수정된 업체', description: '수정된 원문' }
  const editedData = readBootstrap(buildCompanyCasePageHtml(html, edited, site)).item
  assert.equal(editedData.name, variants[site.id].title.replace('샘플 업체', '수정된 업체'))
  assert.ok(!editedData.description.includes(original.description))

  const unsafe = buildCompanyCasePageHtml(html, { ...original, name: '<img src=x onerror=alert(1)>', description: '</script><script>alert(1)</script>' }, site)
  assert.ok(!unsafe.includes('<img src=x'))
  assert.ok(!unsafe.includes('</script><script>alert(1)</script>'))
  assert.ok(unsafe.includes('&lt;img'))

  const symbols = { ...original, name: '$& 업체', description: "원문 $& $' $` 문자를 그대로 보존" }
  const symbolPage = buildCompanyCasePageHtml(html, symbols, site)
  assert.equal(readBootstrap(symbolPage).item.description, resolveCompanyContent(symbols, site.id).description)
  assert.ok(symbolPage.includes('<h1>$&amp; 업체'))
  assert.equal((symbolPage.match(/<title>/g) ?? []).length, 1)
}

assert.deepEqual(resolveCompanyContent(original, 'unknown'), original)
assert.deepEqual(resolveCompanyContent(original, '__proto__'), original)
assert.equal(getContentSite({ hostname: 'www.naranfintechnews.co.kr.evil.example' }).id, 'site1')
assert.deepEqual(createCompanyContentVariants({}), {
  site1: { title: '', description: '' }, site2: { title: '', description: '' }, site3: { title: '', description: '' },
})
assert.equal(original.name, '샘플 업체')
console.log('Three-site automatic content verification passed')
