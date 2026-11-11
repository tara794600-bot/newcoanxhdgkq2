export const SEO_BRAND_NAME: string
export const COMPANY_LIST_ROBOTS: string
export const COMPANY_DETAIL_ROBOTS: string
export function getCompanyDetailSeo(companyCase: {
  name?: string
  sourceName?: string
  service?: string
  description?: string
}): { title: string; description: string; keywords: string; keyword: string; sourceName: string }
