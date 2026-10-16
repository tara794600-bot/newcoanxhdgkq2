export type CompanyContentSource = { name?: unknown; service?: unknown; description?: unknown }
export const CONTENT_SITE: Readonly<{ label: string; url: string }>
export function matchesCompanySearch(data: CompanyContentSource, query: string): boolean
export function resolveCompanyContent<T extends CompanyContentSource>(
  data: T,
): Omit<T, 'name' | 'description'> & { name: string; description: string }
