# React + TypeScript + Vite

## 최신 상세페이지 RSS

- `/rss.xml`은 `api/rss.js`에서 Firestore `companyCases`를 조회해 동적으로 생성합니다.
- 등록일(`createdAt`) 내림차순으로 최신 상세페이지를 최대 500개 제공합니다. 일반 공개 글과 **검색차단 글도 포함**하며, 전화상담 전용(`isPublic: false`) 글과 필수 내용이 없는 글은 제외합니다. 대상이 500개 미만이면 있는 글만 제공합니다.
- 접속 도메인에 맞는 제목·설명·상세 URL을 사용하며, 항목에는 등록일과 최대 600자의 설명 요약이 들어갑니다.
- CDN 캐시는 5분이며 새 글·수정·삭제는 캐시 만료 후 요청 시 반영됩니다. 글이 바뀔 때마다 다시 빌드할 필요는 없습니다.
- 기존 사이트맵과 동일한 `FIREBASE_SERVICE_ACCOUNT_JSON` 또는 `GOOGLE_SERVICE_ACCOUNT_JSON` 서버 환경변수를 사용합니다. DB 조회 실패 시 빈 RSS 대신 캐시하지 않는 503 응답을 반환합니다.
- 최초 적용에는 Vercel 재배포가 필요합니다. 정적 `public/rss.xml`은 제거했고, 빌드에서도 정적 RSS가 배포 결과에 남지 않도록 처리합니다. RSS API 확인은 Vercel 환경에서 가능합니다(`vite` 단독 실행은 API를 제공하지 않습니다).
- 검증: `npm run verify:rss`, `npm run build`, `npm run lint`, `npm run verify:seo`.

## 홈페이지와 변호사 소개의 초기 HTML

홈페이지(`/`)와 변호사 소개(`/lawyers`)는 `npm run build` 실행 시 실제 React 화면을 HTML로 생성합니다. JavaScript가 실행되기 전에도 본문, 제목, 내부 링크와 변호사 프로필을 읽을 수 있습니다.

- `src/entry-server.tsx`와 `scripts/prerender.mjs`에서 생성하며, 화면과 메타 정보는 클라이언트와 공유합니다.
- `dist/prerender/{site1,site2,site3}/`에 도메인별 HTML을 생성하고 `api/site-page.js`가 요청 Host에 맞는 파일을 제공합니다.
- 로컬/미리보기 기본 도메인은 기존 뉴스 도메인(`site2`)이며 `VITE_SITE_ID` 또는 `VITE_SITE_URL`로 변경할 수 있습니다.
- 게시판 API는 별도의 빈 `dist/app-shell.html`을 사용하므로 홈페이지 본문이 상세 페이지에 섞이지 않습니다.
- 본문이나 프로필 변경 후에는 다시 빌드·배포해야 합니다. 운영 사이트 적용에는 재배포가 필요합니다.
- 검증: `npm run build`, `npm run lint`, `npm run verify:seo`.

## 세 홈페이지 게시글 자동 변환

관리자에서 업체명·유형·설명을 한 번만 작성하면 접속 도메인별 제목과 설명이 자동 적용됩니다. 작성·수정 폼의 **세 홈페이지 자동 변환 미리보기**에서 결과를 확인할 수 있습니다.

| 도메인 | 자동 적용 방식 |
| --- | --- |
| `www.naranfintech.com` | 원래 업체명과 설명 |
| `www.naranfintechnews.co.kr` | `업체명 \| 유형 사례 정리` 제목과 사례 안내 + 원문 설명 |
| `www.xn--naranfintech-t458b147kl8ppf0a.kr` | `업체명 피해 관련 확인 사항` 제목과 유형 안내 + 원문 설명 |

이 프로젝트의 로컬/미리보기 기본값은 뉴스 도메인(`site2`)입니다. 운영 환경에서는 서버의 요청 Host와 브라우저의 접속 도메인으로 구분합니다. 다른 사이트의 미리보기는 `VITE_SITE_ID=site1`, `site2`, `site3`으로 선택할 수 있습니다.

- 변환 규칙은 `shared/company-content.js`에서 관리합니다. 외부 AI 호출 없이 고정 문구를 적용하고 설명 원문은 보존합니다.
- Firestore와 서버의 게시글 캐시에는 원문만 보관합니다. 기존 글에도 자동 적용되며 DB 필드나 보안 규칙 변경은 필요 없습니다.
- 관리자 편집용 원문과 공개 화면 데이터를 분리해 수정할 때 변환 문구가 중복 저장되지 않습니다.
- 게시판·상세·파워링크 관련 글, title/description, OG, Twitter, 구조화 데이터에 같은 문구를 적용합니다. 대표 URL과 사이트맵도 접속 도메인에 맞춥니다.
- 세 홈페이지가 별도 배포 프로젝트라면 각각 변경 코드를 배포해야 합니다. 상세 페이지 캐시는 기존 정책에 따라 갱신이 지연될 수 있습니다.
- 검증: `npm run build`, `npm run lint`, `npm run verify:seo`.


This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

## Naver Powerlink Landing URLs

The app now supports keyword-specific landing URLs with encrypted tokens while keeping the same home screen UI.

- Recommended landing path format: `/p/{encryptedToken}`
- Set custom prefix in frontend if needed: `VITE_POWERLINK_PATH_PREFIX`
- Admin page can generate encrypted URLs directly (`/api/powerlink/generate`)
- On form submit, the following are sent to API and saved:
  - `landingPath`
  - `landingToken`
  - `landingKeyword` (decoded server-side when `POWERLINK_URL_SECRET` is set)

Generate encrypted landing URLs:

```bash
npm run powerlink:url -- "코인 사기 변호사" "https://your-domain.vercel.app"
```

## Quick Consultation Flow (Vercel API)

This project includes `api/consultation.js` for quick consultation submissions.

Flow:

1. Frontend form submits to `/api/consultation`.
2. Vercel API stores the request in Firestore (`consultationRequests`).
3. Vercel API appends a row to Google Sheets.
4. Vercel API sends a Telegram bot alert.

Required Vercel environment variables are listed in `.env.vercel.example`.

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
