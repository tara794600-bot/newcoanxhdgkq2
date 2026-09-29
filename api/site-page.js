import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getRequestContentSite } from '../server/content-site.js'

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD')
    return res.status(405).end('Method Not Allowed')
  }
  const requestUrl = new URL(req.url, 'https://localhost')
  const requestedRoute = req.query?.route ?? requestUrl.searchParams.get('route')
    ?? (requestUrl.pathname === '/lawyers' ? 'lawyers' : 'home')
  if (requestedRoute !== 'home' && requestedRoute !== 'lawyers') {
    return res.status(404).end('Not Found')
  }
  const site = getRequestContentSite(req)
  const apiDir = path.dirname(fileURLToPath(import.meta.url))
  const relativeFile = path.join('dist', 'prerender', site.id, `${requestedRoute}.html`)
  try {
    const html = await readFile(path.join(process.cwd(), relativeFile), 'utf8')
      .catch(() => readFile(path.join(apiDir, '..', relativeFile), 'utf8'))
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400')
    return req.method === 'HEAD' ? res.status(200).end() : res.status(200).send(html)
  } catch (error) {
    console.error('[api/site-page] Prerendered HTML unavailable', error)
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Retry-After', '60')
    return res.status(503).end('Service Unavailable')
  }
}
