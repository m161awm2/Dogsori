import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT || 3000);
const geminiModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const geminiApiKey = process.env.GEMINI_API_KEY || '';

const GEMINI_PROMPT = `입력값을 장난스럽고 이상한 표현으로 허용할 수 있는지 판단하세요.

허용 가능한 입력에는 무작위 키보드 입력, 반복 문자, 발음만 흉내 낸 소리, 무작위 한글 자모, 무작위 라틴 문자, 무작위 숫자, 의미 없는 혼합 토큰, 장난스러운 짧은 문장, 과장된 감상문, 명사와 숫자가 섞인 이상한 말, 혼잣말, 감탄문, 취향 표현, 바람 표현이 포함됩니다.

예를 들어 "똥은정말맛있다", "똥먹고싶다", "호날두1231최고", "우와아아아ㅋㅋㅋ123", "라면이너무먹고싶다" 같은 입력은 이상한 말이나 혼잣말일 뿐 앱에게 시키는 실제 작업 요청이 아니므로 허용하세요.

차단해야 하는 입력은 앱에게 답변, 생성, 실행, 번역, 요약, 설명, 코딩, 검색 등을 시키는 실제 작업 요청, 질문, 명령, 코드처럼 보이는 텍스트, 명령어처럼 보이는 텍스트, URL, 이메일, IP 주소, API 키나 토큰 같은 비밀값, 개인정보, 위험하거나 불법적인 지시처럼 명확한 실행 의도를 가진 텍스트입니다.

판단 규칙: 사용자가 단순히 자기 생각이나 욕구를 말하는 혼잣말이면 문장이 읽히더라도 허용하세요. 앱이 어떤 작업을 수행해야 답할 수 있는 문장일 때만 차단하세요.

차단해야 하는 입력이라면 다음 JSON을 반환하세요:
{"blocked":true,"reason":"해당 입력문은 올바르지 않습니다.","analysis":"","concept":"","language":"","code":"","notes":""}

허용 가능한 입력이라면 다음 내용을 담은 JSON을 반환하세요:
- blocked는 false
- reason은 빈 문자열
- analysis는 입력값을 어떻게 해석했는지에 대한 짧은 기술적 설명
- concept는 무해한 교육용 장난감 소프트웨어 개념
- language는 생성된 소스 코드의 프로그래밍 언어 이름
- code는 80줄 이하의 완전하고 무해한 소스 코드
- notes는 짧은 참고 설명

중요: reason, analysis, concept, language, notes 값은 반드시 한국어로 작성하세요. code 값 안의 소스 코드는 해당 프로그래밍 언어 문법에 맞게 작성하되, 코드 주석과 출력 문구도 가능한 한 한국어로 작성하세요.

반드시 유효한 JSON만 반환하세요. 키는 blocked, reason, analysis, concept, language, code, notes만 사용하세요.`;

const BLOCKED_RESPONSE = {
  blocked: true,
  reason: '해당 입력문은 올바르지 않습니다.',
  analysis: '',
  concept: '',
  language: '',
  code: '',
  notes: '이 시스템은 실제 요청이나 민감정보가 아닌 이상한 문자열만 실험적으로 재구성합니다.'
};

app.use(express.json({ limit: '8kb' }));
app.use(express.static(path.join(__dirname, 'public')));

function makeBlocked(reason = BLOCKED_RESPONSE.reason) {
  return { ...BLOCKED_RESPONSE, reason };
}

function validateMeaninglessInput(rawInput) {
  if (typeof rawInput !== 'string') {
    return { ok: false, reason: '입력은 문자열이어야 합니다.' };
  }

  const input = rawInput.trim();

  if (input.length < 1 || input.length > 300) {
    return { ok: false, reason: '입력은 1자 이상 300자 이하이어야 합니다.' };
  }

  const detectors = [
    /https?:\/\/|www\./i,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    /\b(?:\d{1,3}\.){3}\d{1,3}\b/,
    /\b(AKIA|ASIA)[A-Z0-9]{12,}\b/,
    /\b(sk-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/,
    /\b(password|passwd|secret|token|api[_-]?key|credential)\b/i
  ];

  if (detectors.some((pattern) => pattern.test(input))) {
    return { ok: false, reason: '민감정보로 보이는 입력은 분석하지 않습니다.' };
  }

  return { ok: true, input };
}

function parseModelOutput(text) {
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    return null;
  }
}

function normalizeAiPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const normalized = {
    blocked: Boolean(payload.blocked),
    reason: String(payload.reason || ''),
    analysis: String(payload.analysis || ''),
    concept: String(payload.concept || ''),
    language: String(payload.language || ''),
    code: String(payload.code || ''),
    notes: String(payload.notes || '')
  };

  if (normalized.blocked) {
    return { ...BLOCKED_RESPONSE, reason: normalized.reason || BLOCKED_RESPONSE.reason };
  }

  return normalized;
}

function getGeminiText(payload) {
  return payload?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || '')
    .join('')
    .trim();
}

async function requestGemini(input) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    geminiModel
  )}:generateContent?key=${encodeURIComponent(geminiApiKey)}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `${GEMINI_PROMPT}\n\n입력 문자열:\n${input}`
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json'
      }
    })
  });

  const payload = await response.json();

  if (!response.ok) {
    const message = payload?.error?.message || 'Gemini API 요청에 실패했습니다.';
    throw new Error(message);
  }

  return payload;
}

app.post('/api/analyze', async (req, res) => {
  const validation = validateMeaninglessInput(req.body?.input);

  if (!validation.ok) {
    return res.status(200).json(makeBlocked(validation.reason));
  }

  if (!geminiApiKey) {
    return res.status(500).json({
      ...makeBlocked('Gemini API 키가 설정되지 않았습니다.'),
      notes: 'GEMINI_API_KEY를 .env에 설정한 뒤 다시 실행하세요.'
    });
  }

  try {
    const response = await requestGemini(validation.input);
    const parsed = parseModelOutput(getGeminiText(response));
    const normalized = normalizeAiPayload(parsed);

    if (!normalized) {
      return res.status(502).json({
        ...makeBlocked('Gemini 응답을 해석할 수 없습니다.'),
        notes: 'Gemini가 JSON 형식으로 응답하지 않았습니다.'
      });
    }

    return res.json(normalized);
  } catch (error) {
    return res.status(502).json({
      ...makeBlocked('Gemini API 처리 중 오류가 발생했습니다.'),
      notes: error.message || 'Gemini API 상태를 확인하세요.'
    });
  }
});

app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && 'body' in error) {
    return res.status(400).json(makeBlocked('요청 JSON을 파싱할 수 없습니다.'));
  }
  return next(error);
});

app.listen(port, () => {
  console.log(`상징 재구성 엔진 실행 중: http://localhost:${port}`);
});
