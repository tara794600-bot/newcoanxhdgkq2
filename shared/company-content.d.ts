export type ContentSiteId = 'site1' | 'site2' | 'site3'
export type CompanyContentSource = { name?: unknown; service?: unknown; description?: unknown }
export type ContentSite = { id: ContentSiteId; label: string; url: string }
export const CONTENT_SITES: ContentSite[]
export function getContentSite(options?: { hostname?: string; siteId?: string; siteUrl?: string }): ContentSite
export function createCompanyContentVariants(data: CompanyContentSource): Record<ContentSiteId, { title: string; description: string }>
export function matchesCompanySearch(data: CompanyContentSource, query: string, siteId: string): boolean
export function resolveCompanyContent<T extends CompanyContentSource>(
  data: T,
  siteId: string,
): Omit<T, 'name' | 'description'> & { name: string; description: string }
