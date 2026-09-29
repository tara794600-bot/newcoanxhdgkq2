import { getContentSite } from '../shared/company-content.js'

export const getRequestContentSite = (req) => getContentSite({
  hostname: req?.headers?.host,
  siteId: process.env.VITE_SITE_ID,
  siteUrl: process.env.SITE_URL || process.env.VITE_SITE_URL,
})
