import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { CONTENT_SITE, matchesCompanySearch, resolveCompanyContent } from '../shared/company-content.js'
import { buildCompaniesPageHtml, buildCompanyCasePageHtml, buildNotFoundPageHtml } from '../api/company-page.js'
import { renderSitemap } from '../api/sitemap.js'

const html = await readFile(new URL('../dist/app-shell.html', import.meta.url), 'utf8')
const original = Object.freeze({
  id: 'shared-post', name: '샘플 업체', service: '투자사기',
  description: '원문 첫 줄입니다.\n두 번째 줄의 사실관계를 그대로 보존합니다.',
  image: '/logo.png', isPublic: true, isSearchBlocked: false,
})
const cachedItems = Object.freeze([original])

const readBootstrap = (page) => JSON.parse(page.match(/window\.__COMPANY_PAGE_DATA__=([\s\S]*?)<\/script>/)[1])
const readArticle = (page) => JSON.parse(page.match(/id="route-structured-data"[^>]*>([\s\S]*?)<\/script>/)[1])['@graph'][0]

const expected = resolveCompanyContent(original)
assert.equal(expected.name, '샘플 업체 | 투자사기 사례 정리')
assert.equal(expected.description, `샘플 업체 관련 투자사기 사례 정보입니다.\n\n${original.description}`)
assert.equal(expected.id, original.id)
assert.ok(expected.description.endsWith(original.description))
assert.ok(matchesCompanySearch(original, expected.name))
assert.ok(matchesCompanySearch(original, '두 번째 줄'))
assert.equal(matchesCompanySearch(original, '없는 검색어'), false)
assert.equal(resolveCompanyContent(original).name, expected.name)

const detail = buildCompanyCasePageHtml(html, original)
assert.ok(detail.includes(`<title>${expected.name} | 사기업체 게시판 | 법무법인 나란</title>`))
assert.ok(detail.includes(`<h1>${expected.name}</h1>`))
assert.ok(detail.includes(`rel="canonical" href="${CONTENT_SITE.url}/companies/shared-post"`))
assert.ok(detail.includes(`property="og:title" content="${expected.name} | 사기업체 게시판 | 법무법인 나란"`))
assert.ok(detail.includes(`name="twitter:title" content="${expected.name} | 사기업체 게시판 | 법무법인 나란"`))
assert.equal(readBootstrap(detail).item.description, expected.description)
assert.equal(readBootstrap(detail).item.name, expected.name)
assert.equal(readArticle(detail).headline, expected.name)
assert.equal(readArticle(detail).image, `${CONTENT_SITE.url}/logo.png`)
assert.equal(readArticle(detail).description, expected.description.replace(/\s+/g, ' '))

const list = buildCompaniesPageHtml(html, { items: cachedItems, page: 1, searchQuery: '', totalCount: 1, totalPages: 1 })
assert.equal(readBootstrap(list).items[0].name, expected.name)
assert.equal(readBootstrap(list).items[0].description, expected.description)
assert.ok(list.includes(`<p class="company-card-name">${expected.name}</p>`))
assert.ok(list.includes(`src="${CONTENT_SITE.url}/logo.png"`))

assert.ok(buildNotFoundPageHtml(html, '/companies/missing').includes(`${CONTENT_SITE.url}/companies/missing`))
assert.ok(renderSitemap([]).includes(`<loc>${CONTENT_SITE.url}/companies</loc>`))

const phone = buildCompanyCasePageHtml(html, { ...original, isPublic: false })
assert.ok(phone.includes('href="tel:15517203"'))
assert.equal(readBootstrap(phone).item.name, expected.name)
const blocked = buildCompaniesPageHtml(html, { items: [{ ...original, isSearchBlocked: true }], page: 1, searchQuery: '', totalCount: 0, totalPages: 1 })
assert.equal(readBootstrap(blocked).items.length, 0)

const edited = { ...original, name: '수정된 업체', description: '수정된 원문' }
const editedData = readBootstrap(buildCompanyCasePageHtml(html, edited)).item
assert.equal(editedData.name, expected.name.replace('샘플 업체', '수정된 업체'))
assert.ok(!editedData.description.includes(original.description))

const unsafe = buildCompanyCasePageHtml(html, { ...original, name: '<img src=x onerror=alert(1)>', description: '</script><script>alert(1)</script>' })
assert.ok(!unsafe.includes('<img src=x'))
assert.ok(!unsafe.includes('</script><script>alert(1)</script>'))
assert.ok(unsafe.includes('&lt;img'))

const symbols = { ...original, name: '$& 업체', description: "원문 $& $' $` 문자를 그대로 보존" }
const symbolPage = buildCompanyCasePageHtml(html, symbols)
assert.equal(readBootstrap(symbolPage).item.description, resolveCompanyContent(symbols).description)
assert.ok(symbolPage.includes('<h1>$&amp; 업체'))
assert.equal((symbolPage.match(/<title>/g) ?? []).length, 1)

assert.deepEqual(resolveCompanyContent({}), { name: '', description: '' })
assert.equal(original.name, '샘플 업체')
console.log('News site content verification passed')
