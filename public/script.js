const form = document.querySelector('#analyzeForm');
const input = document.querySelector('#fragmentInput');
const analyzeButton = document.querySelector('#analyzeButton');
const copyButton = document.querySelector('#copyButton');
const regenButton = document.querySelector('#regenButton');
const statusBadge = document.querySelector('#statusBadge');
const pulseDot = document.querySelector('#pulseDot');
const logStream = document.querySelector('#logStream');
const blockedPanel = document.querySelector('#blockedPanel');
const blockedReason = document.querySelector('#blockedReason');
const resultGrid = document.querySelector('#resultGrid');
const analysisOutput = document.querySelector('#analysisOutput');
const conceptOutput = document.querySelector('#conceptOutput');
const languageOutput = document.querySelector('#languageOutput');
const codeOutput = document.querySelector('#codeOutput');
const notesOutput = document.querySelector('#notesOutput');
const consolePanel = document.querySelector('.console');

let lastFragment = '';
let logTimer = null;
let isLoading = false;
let cooldownTimer = null;
let cooldownRemaining = 0;
const COOLDOWN_SECONDS = 20;
const analyzeButtonLabel = analyzeButton.textContent;
const regenButtonLabel = regenButton.textContent;

const logLines = [
  '[스캔] 문자 빈도 측정 중',
  '[스캔] 기호 군집 분리 중',
  '[엔트로피] 무질서 경사 추정 중',
  '[검사] 의미 위험 표시 확인 중',
  '[모델] 재구성 가설 요청 중',
  '[렌더] 생성 결과 정리 중'
];

function setStatus(label, mode = '') {
  statusBadge.textContent = label;
  statusBadge.className = `status ${mode}`.trim();
}

function appendLog(line) {
  const entry = document.createElement('p');
  entry.textContent = line;
  logStream.append(entry);

  while (logStream.children.length > 7) {
    logStream.firstElementChild.remove();
  }
}

function startLogAnimation() {
  let index = 0;
  pulseDot.classList.add('active');
  appendLog('[시스템] 분석 주기 시작');
  logTimer = window.setInterval(() => {
    appendLog(logLines[index % logLines.length]);
    index += 1;
  }, 520);
}

function stopLogAnimation() {
  window.clearInterval(logTimer);
  logTimer = null;
  pulseDot.classList.remove('active');
}

function updateControls() {
  const isCoolingDown = cooldownRemaining > 0;
  analyzeButton.disabled = isLoading || isCoolingDown;
  regenButton.disabled = isLoading || isCoolingDown || !lastFragment;
  input.disabled = isLoading;
  analyzeButton.textContent = isCoolingDown ? `${cooldownRemaining}초` : analyzeButtonLabel;
  regenButton.textContent = isCoolingDown ? `대기 ${cooldownRemaining}초` : regenButtonLabel;

  if (!isLoading && isCoolingDown) {
    setStatus(`대기 ${cooldownRemaining}초`, 'active');
  }
}

function startCooldown() {
  window.clearInterval(cooldownTimer);
  cooldownRemaining = COOLDOWN_SECONDS;
  updateControls();

  cooldownTimer = window.setInterval(() => {
    cooldownRemaining -= 1;

    if (cooldownRemaining <= 0) {
      window.clearInterval(cooldownTimer);
      cooldownTimer = null;
      cooldownRemaining = 0;
      setStatus('대기');
    }

    updateControls();
  }, 1000);
}

function setLoading(nextLoading) {
  isLoading = nextLoading;
  consolePanel.classList.toggle('loading', isLoading);
  updateControls();

  if (isLoading) {
    setStatus('분석 중', 'active');
    startLogAnimation();
  } else {
    stopLogAnimation();
  }
}

function showBlocked(reason, notes) {
  blockedPanel.classList.remove('hidden');
  resultGrid.classList.add('hidden');
  blockedReason.textContent = reason;
  analysisOutput.textContent = '';
  conceptOutput.textContent = '';
  languageOutput.textContent = '차단됨';
  codeOutput.textContent = '// 차단됨';
  notesOutput.textContent = notes || 'AI가 실제 요청이나 민감정보로 판단하면 코드를 생성하지 않습니다.';
  copyButton.disabled = true;
  regenButton.disabled = false;
  setStatus('차단됨', 'blocked');
  appendLog('[검사] 의미 필터가 입력을 거부함');
}

function showResult(payload) {
  blockedPanel.classList.add('hidden');
  resultGrid.classList.remove('hidden');
  analysisOutput.textContent = payload.analysis || '분석 결과가 없습니다.';
  conceptOutput.textContent = payload.concept || '시스템 개념이 없습니다.';
  languageOutput.textContent = payload.language || '알 수 없음';
  codeOutput.textContent = payload.code || '// 생성된 코드 없음';
  notesOutput.textContent = payload.notes || '';
  analysisOutput.classList.remove('empty');
  conceptOutput.classList.remove('empty');
  copyButton.disabled = !payload.code;
  regenButton.disabled = false;
  setStatus('완료');
  appendLog('[완료] 재구성 결과 생성됨');
}

async function analyze(fragment) {
  if (isLoading || cooldownRemaining > 0) {
    appendLog('[대기] 쿨타임이 끝난 뒤 다시 시도하세요');
    return;
  }

  const trimmed = fragment.trim();

  if (!trimmed) {
    showBlocked('입력값이 비어 있습니다.', '의미 없는 문자열을 입력하세요.');
    return;
  }

  lastFragment = trimmed;
  setLoading(true);
  blockedPanel.classList.add('hidden');
  appendLog(`[입력] 조각 길이=${trimmed.length}`);

  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ input: trimmed })
    });

    const payload = await response.json();

    if (payload.blocked) {
      showBlocked(payload.reason, payload.notes);
      return;
    }

    if (!response.ok && response.status !== 429) {
      throw new Error(payload?.notes || '분석에 실패했습니다.');
    }

    showResult(payload);
  } catch (error) {
    setStatus('오류', 'blocked');
    appendLog('[오류] 요청 실패');
    blockedPanel.classList.remove('hidden');
    blockedReason.textContent = '분석 요청 중 오류가 발생했습니다.';
    notesOutput.textContent = error.message || '서버 상태를 확인하세요.';
  } finally {
    setLoading(false);
    startCooldown();
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  analyze(input.value);
});

regenButton.addEventListener('click', () => {
  if (lastFragment) analyze(lastFragment);
});

copyButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(codeOutput.textContent);
    appendLog('[클립보드] 생성된 소스 복사 완료');
    copyButton.textContent = '복사됨';
    window.setTimeout(() => {
      copyButton.textContent = '복사';
    }, 1100);
  } catch {
    appendLog('[클립보드] 복사 실패');
  }
});
