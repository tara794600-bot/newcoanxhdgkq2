// Detail pages live at /companies/{keyword}, e.g. "vogashop.net 사칭" -> /companies/vogashop-net.
// Server pages, the sitemap, RSS and the client all assign slugs with this module so links agree.

export const COMPANIES_PATH = '/companies'

const SLUG_MAX_LENGTH = 80
const DUPLICATE_SUFFIX_LENGTH = 6
const TRAILING_LABEL_PATTERN = /\s*(?:사칭|사기)\s*$/u

const text = (value) => (typeof value === 'string' ? value.trim() : '')

// The searched name without the trailing "사칭"/"사기" label that every post title carries.
export const getCompanyKeyword = (name) => {
  let keyword = text(name)

  while (TRAILING_LABEL_PATTERN.test(keyword)) {
    const stripped = keyword.replace(TRAILING_LABEL_PATTERN, '').trim()
    if (!stripped) break
    keyword = stripped
  }

  return keyword
}

// Letters (Hangul included) and digits are kept; dots, spaces and symbols become one hyphen.
export const toCompanySlugBase = (name) => {
  const slug = getCompanyKeyword(name)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')

  return Array.from(slug).slice(0, SLUG_MAX_LENGTH).join('').replace(/-+$/g, '')
}

export const toCompanyTimeValue = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value && typeof value.toMillis === 'function') return value.toMillis()
  if (value && typeof value.toDate === 'function') return value.toDate().getTime()
  if (value instanceof Date) return value.getTime() || 0
  if (typeof value === 'string' && value.trim()) return Date.parse(value) || 0
  return 0
}

// The oldest post keeps the plain keyword; later posts with the same keyword get a
// short, permanent id suffix so publishing a new post never moves an existing URL.
export const assignCompanySlugs = (entries) => {
  const slugs = new Map()
  const used = new Set()
  const ordered = entries
    .filter((entry) => entry && text(entry.id))
    .map((entry) => ({ id: text(entry.id), name: entry.name, time: toCompanyTimeValue(entry.createdAt) }))
    .sort((a, b) => a.time - b.time || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  for (const { id, name } of ordered) {
    const base = toCompanySlugBase(name)
    const candidates = base
      ? [base, `${base}-${id.slice(0, DUPLICATE_SUFFIX_LENGTH).toLowerCase()}`, `${base}-${id.toLowerCase()}`, `${base}-${id}`]
      : [id]
    const slug = candidates.find((candidate) => !used.has(candidate)) ?? id

    used.add(slug)
    slugs.set(id, slug)
  }

  return slugs
}

// Finds the post for a requested path segment. `redirect` is true when the post has
// moved to another slug (old random-id URL, or a duplicate whose suffix changed).
export const findCompanyBySlug = (entries, slugs, requested) => {
  const segment = text(requested)
  if (!segment) return null

  const normalized = segment.normalize('NFKC').toLowerCase()
  const byId = new Map(entries.map((entry) => [entry.id, entry]))

  for (const [id, slug] of slugs) {
    if (slug === segment || slug === normalized) {
      return { id, slug, redirect: slug !== segment }
    }
  }

  if (byId.has(segment)) {
    const slug = slugs.get(segment) ?? segment
    return { id: segment, slug, redirect: slug !== segment }
  }

  const suffixMatch = normalized.match(/^(.+)-([\p{Ll}\p{N}]{6,})$/u)

  if (suffixMatch) {
    const [, base, idPrefix] = suffixMatch
    const entry = entries.find(
      (item) => item.id.toLowerCase().startsWith(idPrefix) && toCompanySlugBase(item.name) === base,
    )

    if (entry && slugs.has(entry.id)) {
      return { id: entry.id, slug: slugs.get(entry.id), redirect: true }
    }
  }

  return null
}

export const getCompanyCasePath = (item) =>
  `${COMPANIES_PATH}/${encodeURIComponent(text(item?.slug) || text(item?.id))}`
