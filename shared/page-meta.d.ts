type PageMeta = {
  title: string
  description: string
  keywords: string
  path: string
  image?: string
}

export const SEO_META_BY_ROUTE: Record<'home' | 'lawyers' | 'companies' | 'admin', PageMeta>
export const DEFAULT_SEO_KEYWORDS: string
