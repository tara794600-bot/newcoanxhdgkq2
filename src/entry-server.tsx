import { renderToStaticMarkup } from 'react-dom/server'
import App from './App'

// Use the same components and copy as the interactive client. No browser or DB
// is needed to generate the public home and lawyer profile pages.
export function renderPublicPage(pathname: '/' | '/lawyers') {
  return renderToStaticMarkup(<App initialPathname={pathname} />)
}
