import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'
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
const directory = path.join(dist, 'prerender')
await mkdir(directory, { recursive: true })

for (const [route, pathname] of [['home', '/'], ['lawyers', '/lawyers']]) {
  const markup = renderPublicPage(pathname)
  const html = buildPublicPageHtml(template, markup, route)
  await writeFile(path.join(directory, `${route}.html`), html)
  await writeFile(path.join(dist, route === 'home' ? 'index.html' : 'lawyers.html'), html)
}
console.log('Initial HTML generated: news site home and lawyers.')
