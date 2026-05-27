import { rm } from 'node:fs/promises'
import path from 'node:path'

const sitemapPath = path.join(process.cwd(), 'dist', 'sitemap.xml')

try {
  await rm(sitemapPath, { force: true })
} catch (error) {
  console.warn('[remove-static-sitemap] sitemap.xml removal skipped:', error)
}
