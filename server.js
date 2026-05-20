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
const REQUEST_COOLDOWN_MS = 20_000;
const resultCache = new Map();
const lastRequestByIp = new Map();

const GEMINI_PROMPT = `역할: 이상한 문자열은 반드시 소프트웨어 아이디어와 코드로 재구성한다.

허용: 질문이 아닌 문장
차단: 질문, 명령, 생성/번역/요약/설명/코딩/검색 요청

허용된 입력을 처리하는 방식:
- 입력의 반복, 리듬, 글자 종류, 길이, 자모 느낌, 소리 느낌, 시각적 모양 중 하나를 무슨짓을 해서라도 억지로라도 소프트웨어 규칙으로 해석해야한다.
- 입력이 아주 짧거나 단순해도 반드시 창의적으로 비약해서 결과를 만들어야한다.

차단 JSON:
{"blocked":true,"reason":"해당 입력문은 올바르지 않습니다.","analysis":"","concept":"","language":"","code":"","notes":""}

허용 JSON:
{"blocked":false,"reason":"","analysis":"짧은 한국어 설명","concept":"무해한 교육용 장난감 소프트웨어 개념","language":"프로그래밍 언어명","code":"30줄 이하의 실행 가능한 완전한 예제 코드","notes":"짧은 한국어 참고"}

허용할 때 code는 반드시 비어 있지 않아야 한다. code는 입력 문자열을 코드 안에서 실제 데이터로 사용해야 한다.
analysis에는 입력을 어떻게 소프트웨어 규칙으로 억지 해석했는지 쓴다.
concept에는 완성된 프로그램의 이름이나 기능을 구체적으로 쓴다.
반드시 유효한 JSON만 반환한다. 키는 blocked, reason, analysis, concept, language, code, notes만 사용한다. code는 30줄 이하, 전체 응답은 짧게 작성한다.`;

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
  const code = String(payload.code || '')
    .split('\n')
    .slice(0, 30)
    .join('\n');
  const normalized = {
    blocked: Boolean(payload.blocked),
    reason: String(payload.reason || ''),
    analysis: String(payload.analysis || ''),
    concept: String(payload.concept || ''),
    language: String(payload.language || ''),
    code,
    notes: String(payload.notes || '')
  };

  if (normalized.blocked) {
    return { ...BLOCKED_RESPONSE, reason: normalized.reason || BLOCKED_RESPONSE.reason };
  }

  return normalized;
}

function getClientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function getCachedResult(input) {
  const cached = resultCache.get(input);
  return cached ? { ...cached } : null;
}

function setCachedResult(input, payload) {
  resultCache.set(input, { ...payload });
}

function checkRateLimit(ip) {
  const now = Date.now();
  const previous = lastRequestByIp.get(ip) || 0;
  const waitMs = REQUEST_COOLDOWN_MS - (now - previous);

  if (waitMs > 0) {
    return { ok: false, retryAfter: Math.ceil(waitMs / 1000) };
  }

  lastRequestByIp.set(ip, now);
  return { ok: true, retryAfter: 0 };
}

class GeminiApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'GeminiApiError';
    this.status = status;
  }
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
        temperature: 0.2,
        maxOutputTokens: 1200,
        thinkingConfig: {
          thinkingBudget: 0
        },
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          required: ['blocked', 'reason', 'analysis', 'concept', 'language', 'code', 'notes'],
          properties: {
            blocked: { type: 'BOOLEAN' },
            reason: { type: 'STRING' },
            analysis: { type: 'STRING' },
            concept: { type: 'STRING' },
            language: { type: 'STRING' },
            code: { type: 'STRING' },
            notes: { type: 'STRING' }
          }
        }
      }
    })
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = payload?.error?.message || 'Gemini API 요청에 실패했습니다.';
    throw new GeminiApiError(response.status, message);
  }

  return payload;
}

app.post('/api/analyze', async (req, res) => {
  const validation = validateMeaninglessInput(req.body?.input);

  if (!validation.ok) {
    return res.status(200).json(makeBlocked(validation.reason));
  }

  const cached = getCachedResult(validation.input);
  if (cached) {
    return res.json({ ...cached, notes: cached.notes || '이전 분석 결과를 캐시에서 반환했습니다.' });
  }

  const rateLimit = checkRateLimit(getClientIp(req));
  if (!rateLimit.ok) {
    return res.status(429).json({
      ...makeBlocked('요청이 너무 빠릅니다. 잠시 후 다시 시도하세요.'),
      notes: `${rateLimit.retryAfter}초 후 다시 요청할 수 있습니다.`
    });
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

    setCachedResult(validation.input, normalized);
    return res.json(normalized);
  } catch (error) {
    if (error instanceof GeminiApiError && error.status === 429) {
      return res.status(429).json({
        ...makeBlocked('Gemini 무료 사용량 제한에 도달했습니다. 잠시 후 다시 시도하세요.'),
        notes: '요청이 짧은 시간에 많았거나 무료 티어 한도에 가까워졌습니다.'
      });
    }

    return res.status(502).json({
      ...makeBlocked('Gemini API 처리 중 오류가 발생했습니다.'),
      notes: '잠시 후 다시 시도하세요. 문제가 계속되면 서버 설정을 확인하세요.'
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
