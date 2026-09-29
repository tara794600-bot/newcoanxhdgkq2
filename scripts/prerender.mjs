import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build, loadEnv } from 'vite'
import { CONTENT_SITES, getContentSite } from '../shared/company-content.js'
import { buildPublicPageHtml } from '../server/public-page-html.js'

const projectRoot = process.cwd()
const dist = path.join(projectRoot, 'dist')
const rendererDir = path.join(projectRoot, 'node_modules', '.tmp', 'naran-prerender')
const template = await readFile(path.join(dist, 'index.html'), 'utf8')

// Keep the empty shell separate: company pages insert their own, dynamic body.
await writeFile(path.join(dist, 'app-shell.html'), template)
await copyFile(path.join(projectRoot, 'src', 'assets', 'logo.png'), path.join(dist, 'logo.png'))
await build({
  build: {
    ssr: 'src/entry-server.tsx',
    outDir: rendererDir,
    emptyOutDir: false,
    copyPublicDir: false,
    // The client build already emitted the images and CSS under dist/assets.
    ssrEmitAssets: false,
  },
})
const { renderPublicPage } = await import(pathToFileURL(path.join(rendererDir, 'entry-server.js')).href)
const env = { ...loadEnv('production', projectRoot, 'VITE_'), ...process.env }
const defaultSite = getContentSite({ siteId: env.VITE_SITE_ID, siteUrl: env.VITE_SITE_URL || 'https://www.naranfintechnews.co.kr' })

for (const [route, pathname] of [['home', '/'], ['lawyers', '/lawyers']]) {
  const markup = renderPublicPage(pathname)
  for (const site of CONTENT_SITES) {
    const html = buildPublicPageHtml(template, markup, route, site)
    const directory = path.join(dist, 'prerender', site.id)
    await mkdir(directory, { recursive: true })
    await writeFile(path.join(directory, `${route}.html`), html)
    if (site.id === defaultSite.id) {
      await writeFile(path.join(dist, route === 'home' ? 'index.html' : 'lawyers.html'), html)
    }
  }
}
console.log('Initial HTML generated: home and lawyers, across all three domains.')
