export const DEFAULT_SEO_KEYWORDS = [
  '법무법인 나란',
  '투자사기 변호사',
  '코인사기 변호사',
  '금융사기',
  '로맨스스캠',
  '부업사기',
  '피해회복',
  '무료상담',
].join(', ')

export const SEO_META_BY_ROUTE = {
  home: {
    title: '법무법인 나란 | 금융사기 피해회복 상담',
    description:
      '법무법인 나란은 투자사기, 코인사기, 로맨스스캠, 부업사기 등 금융사기 피해회복 상담을 신속하게 지원합니다.',
    keywords: DEFAULT_SEO_KEYWORDS,
    path: '/',
  },
  lawyers: {
    title: '변호사 소개 | 법무법인 나란',
    description: '법무법인 나란의 형사, 부동산, 금융사기 피해회복 분야 변호사 프로필과 주요 경력을 확인하세요.',
    keywords: `법무법인 나란 변호사, 서지원 변호사, 최지연 변호사, 정이든 변호사, ${DEFAULT_SEO_KEYWORDS}`,
    path: '/lawyers',
  },
  companies: {
    title: '사기업체 게시판 | 법무법인 나란',
    description: '투자사기, 부업사기, 로맨스스캠 등 실제 사기업체 사례를 게시판 형식으로 확인하고 피해회복 상담을 신청하세요.',
    keywords: `사기업체 게시판, 사기업체 사례 게시판, 사기 업체 게시판, 사기 피해 게시판, 사기업체 목록, 사기 피해 사례, 피해회복 상담, ${DEFAULT_SEO_KEYWORDS}`,
    path: '/companies',
  },
  admin: {
    title: '관리자 페이지 | 법무법인 나란',
    description: '법무법인 나란 관리자 전용 페이지입니다.',
    keywords: '법무법인 나란 관리자',
    path: '/admin',
  },
}
