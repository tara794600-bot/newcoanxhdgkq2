// One shared post is rendered with the copy assigned to its requesting domain.
export const CONTENT_SITES = [
  { id: 'site1', label: '나란 핀테크', url: 'https://www.naranfintech.com' },
  { id: 'site2', label: '나란 핀테크 뉴스', url: 'https://www.naranfintechnews.co.kr' },
  { id: 'site3', label: '나란 핀테크 (한글 도메인)', url: 'https://www.xn--naranfintech-t458b147kl8ppf0a.kr' },
]

const text = (value) => typeof value === 'string' ? value.trim() : ''

const normalizeHost = (value) => {
  const source = text(value)
  if (!source) return ''
  try {
    return new URL(source.includes('://') ? source : `https://${source}`)
      .hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '')
  } catch {
    return ''
  }
}

export const getContentSite = ({ hostname = '', siteId = '', siteUrl = '' } = {}) => {
  const byHost = CONTENT_SITES.find((site) => normalizeHost(site.url) === normalizeHost(hostname))
  if (byHost) return byHost
  const byId = CONTENT_SITES.find((site) => site.id === text(siteId))
  if (byId) return byId
  return CONTENT_SITES.find((site) => normalizeHost(site.url) === normalizeHost(siteUrl)) ?? CONTENT_SITES[0]
}

// Templates deliberately retain the original body verbatim: automatic variations
// must not invent facts, outcomes, allegations, or legal advice.
export const createCompanyContentVariants = (data) => {
  const name = text(data.name)
  const service = text(data.service)
  const description = text(data.description)
  return {
    site1: { title: name, description },
    site2: {
      title: name ? `${name} | ${service ? `${service} ` : ''}사례 정리` : '',
      description: description
        ? `${name || '해당 업체'} 관련${service ? ` ${service}` : ''} 사례 정보입니다.\n\n${description}`
        : '',
    },
    site3: {
      title: name ? `${name} 피해 관련 확인 사항` : '',
      description: description
        ? `${name || '해당 업체'} 피해 관련 확인 사항${service ? `\n유형: ${service}` : ''}\n\n${description}`
        : '',
    },
  }
}

// Resolve once at the public read/render boundary; admin editing always uses the
// original stored fields, preventing templates from accumulating after edits.
export const resolveCompanyContent = (data, siteId) => {
  const variants = createCompanyContentVariants(data)
  const content = Object.hasOwn(variants, siteId) ? variants[siteId] : variants.site1
  return {
    ...data,
    name: content.title,
    description: content.description,
  }
}

export const matchesCompanySearch = (data, query, siteId) => {
  const search = text(query).toLocaleLowerCase('ko-KR')
  if (!search) return true
  const item = resolveCompanyContent(data, siteId)
  return [item.name, text(item.service), item.description]
    .some((value) => value.toLocaleLowerCase('ko-KR').includes(search))
}
