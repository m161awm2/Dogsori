# Dogsori

의미 없는 문자열이나 이상한 혼잣말을 입력하면 AI가 그 패턴을 해석해서 무해한 장난감 코드 아이디어로 재구성하는 실험용 웹 앱입니다.

## 어떻게 만들었나

- `Express`로 간단한 Node.js 서버를 만들었습니다.
- `public/index.html`, `public/style.css`, `public/script.js`로 브라우저 화면을 구성했습니다.
- 브라우저는 `/api/analyze`로 입력값을 서버에 보냅니다.
- 서버는 Gemini API에 입력값을 전달하고, JSON 응답을 받아 화면에 표시합니다.
- Gemini 프롬프트는 한국어로 작성되어 있으며, 분석 설명과 참고 문구도 한국어로 나오도록 설정했습니다.
- API 키는 `.env`에만 넣고 GitHub에는 올리지 않습니다.

## 공개하지 않는 것

이 저장소에는 실제 Gemini API 키를 포함하지 않습니다.

`.env` 파일은 `.gitignore`로 제외되어 있습니다. GitHub에는 `.env.example`만 올립니다.

```env
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash
PORT=3000
```

## 로컬 실행

```bash
npm install
cp .env.example .env
npm start
```

그 다음 브라우저에서 `http://localhost:3000`을 열면 됩니다.

## 배포 참고

GitHub Pages는 정적 파일만 호스팅하므로 이 앱의 `/api/analyze` 서버 기능은 동작하지 않습니다.

실제 API 기능까지 배포하려면 Render, Railway, Fly.io 같은 Node.js 서버 지원 플랫폼을 사용하고, 배포 환경변수에 `GEMINI_API_KEY`를 설정해야 합니다.

GitHub에는 제작 방식과 코드를 보여주는 용도로 올리고, API 키는 절대 커밋하지 않습니다.
