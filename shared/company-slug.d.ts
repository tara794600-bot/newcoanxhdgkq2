export type CompanySlugEntry = { id: string; name?: unknown; createdAt?: unknown }
export type CompanySlugMatch = { id: string; slug: string; redirect: boolean }

export const COMPANIES_PATH: string
export function getCompanyKeyword(name: unknown): string
export function toCompanySlugBase(name: unknown): string
export function toCompanyTimeValue(value: unknown): number
export function assignCompanySlugs(entries: CompanySlugEntry[]): Map<string, string>
export function findCompanyBySlug(
  entries: CompanySlugEntry[],
  slugs: Map<string, string>,
  requested: string,
): CompanySlugMatch | null
export function getCompanyCasePath(item: { id?: string; slug?: string } | null | undefined): string
