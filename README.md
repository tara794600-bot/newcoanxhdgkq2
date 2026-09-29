# React + TypeScript + Vite

## 세 홈페이지 게시글 자동 변환

관리자에서 사기업체 **업체명·유형·설명을 한 번만 작성**하면 각 홈페이지에서 서로 다른 제목과 설명을 자동으로 표시합니다. 작성·수정 폼의 **세 홈페이지 자동 변환 미리보기**에서 결과를 확인할 수 있습니다.

| 도메인 | 자동 적용 방식 |
| --- | --- |
| `www.naranfintech.com` | 원래 업체명과 설명 |
| `www.naranfintechnews.co.kr` | `업체명 \| 유형 사례 정리` 제목과 사례 안내 문구 + 원문 설명 |
| `www.xn--naranfintech-t458b147kl8ppf0a.kr` | `업체명 피해 관련 확인 사항` 제목과 유형 안내 + 원문 설명 |

변환은 외부 AI 호출 없이 고정 문구 규칙으로 처리합니다. 원문을 임의로 요약하거나 사실관계를 바꾸지 않습니다. 문구 규칙과 도메인은 `shared/company-content.js`에서 관리합니다.

- Firestore `companyCases`의 기존 필드에 원문 한 벌만 저장합니다. DB 필드나 보안 규칙 변경이 필요 없으며 기존 글에도 자동 적용됩니다.
- 서버에서는 요청의 Host, 브라우저에서는 접속 도메인으로 구분합니다. 게시판·상세 페이지·파워링크 관련 글과 게시글 title/description, OG, Twitter, 구조화 데이터에 적용됩니다.
- 글을 수정하면 세 사이트가 같은 원문에서 다시 변환하므로 안내 문구가 중복 누적되지 않습니다. 서버 상세 페이지는 기존 캐시 설정에 따라 갱신이 지연될 수 있습니다.
- 세 도메인이 하나의 배포에 연결되어 있으면 이 코드를 한 번 배포합니다. **홈페이지가 별도 프로젝트로 배포되어 있으면 각 프로젝트에도 이 읽기/렌더링 코드를 적용해야 합니다.** DB만 공유하고 예전 코드로 읽는 홈페이지에는 변환이 적용되지 않습니다.
- 로컬/미리보기 도메인에서는 `VITE_SITE_ID=site1`, `site2`, `site3` 중 하나로 테스트할 수 있습니다. 운영 도메인은 자동 인식합니다.
- 확인: `npm run build`, `npm run lint`, `npm run verify:seo`.


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
