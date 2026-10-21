import { descriptionToPlainText, isRichDescription, prependRichParagraph } from './rich-text.js'

// This deployment serves only the news site, regardless of the request host.
export const CONTENT_SITE = Object.freeze({
  label: '나란 핀테크 뉴스',
  url: 'https://www.naranfintechnews.co.kr',
})

const text = (value) => typeof value === 'string' ? value.trim() : ''

// Apply the existing news copy only when reading for public display. Admin forms
// keep editing the stored original so the introduction cannot accumulate.
export const resolveCompanyContent = (data) => {
  const name = text(data.name)
  const service = text(data.service)
  const description = text(data.description)
  const introduction = `${name || '해당 업체'} 관련${service ? ` ${service}` : ''} 사례 정보입니다.`
  return {
    ...data,
    name: name ? `${name} | ${service ? `${service} ` : ''}사례 정리` : '',
    description: !description
      ? ''
      : isRichDescription(description)
        ? prependRichParagraph(description, introduction)
        : `${introduction}\n\n${description}`,
  }
}

export const matchesCompanySearch = (data, query) => {
  const search = text(query).toLocaleLowerCase('ko-KR')
  if (!search) return true
  const item = resolveCompanyContent(data)
  return [item.name, text(item.service), descriptionToPlainText(item.description)]
    .some((value) => value.toLocaleLowerCase('ko-KR').includes(search))
}
