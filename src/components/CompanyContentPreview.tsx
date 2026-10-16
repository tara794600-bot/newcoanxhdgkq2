import { CONTENT_SITE, resolveCompanyContent } from '../../shared/company-content.js'

type Props = { name: string; service: string; description: string }

export function CompanyContentPreview({ name, service, description }: Props) {
  const content = resolveCompanyContent({ name, service, description })

  return (
    <details className="admin-content-preview">
      <summary>게시글 미리보기</summary>
      <p>뉴스 사이트에 표시될 제목과 안내 문구입니다. 입력한 설명 본문은 그대로 유지됩니다.</p>
      <section className="admin-site-content-card" aria-label={CONTENT_SITE.label}>
        <h4>{CONTENT_SITE.label}</h4>
        <strong>{content.name || '업체명을 입력하면 제목이 표시됩니다.'}</strong>
        <p className="admin-site-description">{content.description || '설명을 입력하면 내용이 표시됩니다.'}</p>
      </section>
    </details>
  )
}
