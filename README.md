# Dogsori

의미 없는 문자열이나 이상한 혼잣말을 입력하면 AI가 그 패턴을 해석해서 코드 아이디어로 재구성하는 실험용 웹 앱입니다.

## 어떻게 만들었나

- `Express`로 간단한 Node.js 서버를 만들었습니다.
- `public/index.html`, `public/style.css`, `public/script.js`로 브라우저 화면을 구성했습니다.
- 브라우저는 `/api/analyze`로 입력값을 서버에 보냅니다.
- 서버는 Gemini API에 입력값을 전달하고, JSON 응답을 받아 화면에 표시합니다.
- Gemini 프롬프트는 한국어로 작성되어 있으며, 분석 설명과 참고 문구도 한국어로 나오도록 설정했습니다.
- API 키는 `.env`에만 넣고 GitHub에는 올리지 않습니다.
### 예시

<img width="70%" height="70%![Uploading 스크린샷 2026-05-17 오후 8.53.54.png…]()
" alt="스크린샷 2026-05-17 오후 8 53 54" src="https://github.com/user-attachments/assets/054acc59-06ad-4006-9eca-08818af62dfb" />





## 로컬 실행

```bash
npm install
cp .env.example .env
npm start
```

그 다음 브라우저에서 `http://localhost:3000`을 열면 됩니다.

## 배포 참고

무료 제미나이 API라 많은 사람이 사용 할 수 있도록 토큰을 적게 사용해주세요 제발요.

GitHub Pages는 정적 파일만 호스팅하므로 이 앱의 `/api/analyze` 서버 기능은 동작하지 않습니다.

실제 API 기능까지 배포하려면 Render, Railway, Fly.io 같은 Node.js 서버 지원 플랫폼을 사용하고, 배포 환경변수에 `GEMINI_API_KEY`를 설정해야 합니다.

