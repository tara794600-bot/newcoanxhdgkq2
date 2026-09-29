import { CONTENT_SITES, createCompanyContentVariants } from '../../shared/company-content.js'

type Props = { name: string; service: string; description: string }

export function CompanyContentPreview({ name, service, description }: Props) {
  const variants = createCompanyContentVariants({ name, service, description })

  return (
    <details className="admin-content-preview">
      <summary>세 홈페이지 자동 변환 미리보기</summary>
      <p>글은 한 번만 작성하면 됩니다. 홈페이지별 제목과 안내 문구가 자동 적용되며, 입력한 설명 본문은 그대로 유지됩니다.</p>
      {CONTENT_SITES.map((site) => (
        <section className="admin-site-content-card" key={site.id} aria-label={site.label}>
          <h4>{site.label}</h4>
          <span className="admin-site-domain">{site.url.replace('https://', '')}</span>
          <strong>{variants[site.id].title || '업체명을 입력하면 제목이 표시됩니다.'}</strong>
          <p className="admin-site-description">{variants[site.id].description || '설명을 입력하면 내용이 표시됩니다.'}</p>
        </section>
      ))}
    </details>
  )
}
