const statusLamp = document.getElementById('status-lamp');
const tickerFrame = document.getElementById('ticker-frame');
const tickerText = document.getElementById('ticker-text');
const countsEl = document.getElementById('counts');
const positionEl = document.getElementById('position');
const errorBar = document.getElementById('error-bar');
const hintBar = document.getElementById('hint-bar');

const SPEED_MAP = {
  slow: 65,
  normal: 95,
  fast: 135
};

let rawPayload = {
  ok: false,
  exportedAt: '',
  items: [],
  todos: [],
  counts: { active: 0, done: 0, memo: 0, total: 0 }
};

let settings = {
  activeOnly: false,
  includeDone: true,
  includeMemo: true,
  speed: 'normal',
  alwaysOnTop: true,
  jsonPath: ''
};

let filteredTodos = [];
let currentIndex = 0;
let currentTodo = null;
let hoverPaused = false;
let manualPauseUntil = 0;
let animationFrameId = 0;
let cycleToken = 0;

let lampAnimationFrameId = 0;
let currentLampMode = 'idle';

const LAMP_WAVE = {
  active: { min: 0.45, max: 1.0, period: 1600 },
  done:   { min: 0.18, max: 0.50, period: 2400 },
  idle:   { min: 0.12, max: 0.28, period: 3200 },
  ok:     { min: 0.22, max: 0.55, period: 2600 }
};

function formatClock(iso) {
  if (!iso) return '--:--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--';
  return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setLamp(mode) {
  currentLampMode = mode;
  statusLamp.className = 'status-lamp';
  statusLamp.classList.add(`lamp-${mode}`);

  if (!lampAnimationFrameId) {
    startLampWave();
  }
}

function startLampWave() {
  function step(now) {
    const wave = LAMP_WAVE[currentLampMode] || LAMP_WAVE.idle;
    const phase = ((now % wave.period) / wave.period) * Math.PI * 2;
    const ratio = (Math.sin(phase) + 1) / 2;
    const opacity = wave.min + (wave.max - wave.min) * ratio;

    statusLamp.style.opacity = String(opacity);
    lampAnimationFrameId = requestAnimationFrame(step);
  }

  lampAnimationFrameId = requestAnimationFrame(step);
}

function showError(message) {
  errorBar.textContent = message;
  errorBar.classList.remove('hidden');
}

function hideError() {
  errorBar.textContent = '';
  errorBar.classList.add('hidden');
}

function showHint(message, timeout = 2500) {
  hintBar.textContent = message;
  hintBar.classList.remove('hidden');
  const token = Symbol('hint');
  showHint.latestToken = token;
  window.setTimeout(() => {
    if (showHint.latestToken !== token) return;
    hintBar.classList.add('hidden');
  }, timeout);
}

function buildMessage(item) {
  const kind = String(item.kind || '').toUpperCase();
  const text = String(item.text || '').trim() || '(本文なし)';
  const title = String(item.pageTitle || '').trim();

  let head = '[TODO]';
  if (kind === 'メモ') {
    head = '[メモ]';
  } else if (item.status === 'done') {
    head = '[DONE]';
  }

  return title
    ? `${head} ${text}  —  ${title}`
    : `${head} ${text}`;
}

function filterTodos(payload, currentSettings) {
  let items = [...getPayloadItems(payload)];

  items = items.filter((item) => {
    const kind = String(item.kind || 'TODO').toUpperCase();

    if (kind === 'メモ') {
      return !!currentSettings.includeMemo;
    }

    if (currentSettings.activeOnly) {
      return item.status === 'active';
    }

    if (!currentSettings.includeDone && item.status === 'done') {
      return false;
    }

    return true;
  });

  items.sort((a, b) => {
    const rank = (item) => {
      const kind = String(item.kind || 'TODO').toUpperCase();
      if (kind === 'TODO' && item.status === 'active') return 0;
      if (kind === 'メモ') return 1;
      if (kind === 'TODO' && item.status === 'done') return 2;
      return 9;
    };

    const rankDiff = rank(a) - rank(b);
    if (rankDiff !== 0) return rankDiff;

    return new Date(b.createdAt || b.dateOnly || 0).getTime()
         - new Date(a.createdAt || a.dateOnly || 0).getTime();
  });

  return items;
}

function updateMeta() {
  const activeCount = rawPayload.counts?.active || 0;
  const doneCount = rawPayload.counts?.done || 0;
  const memoCount = rawPayload.counts?.memo || 0;

  countsEl.textContent =
    `TODO ${activeCount} / DONE ${doneCount} / メモ ${memoCount} / ${formatClock(rawPayload.exportedAt)}`;

  if (!filteredTodos.length) {
    positionEl.textContent = '0 / 0';
  } else {
    positionEl.textContent = `${Math.min(currentIndex + 1, filteredTodos.length)} / ${filteredTodos.length}`;
  }
}
function cancelTickerAnimation() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = 0;
  }
}

function getPayloadItems(payload) {
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.todos)) return payload.todos; // 互換
  return [];
}

async function playOneTodo(todo, token) {
  currentTodo = todo;
  tickerText.classList.toggle(
    'done',
    String(todo.kind || '').toUpperCase() === 'TODO' && todo.status === 'done'
  );
  tickerText.textContent = buildMessage(todo);
  updateMeta();

  const frameWidth = tickerFrame.clientWidth;
  await sleep(120);
  if (token !== cycleToken) return;

  const textWidth = tickerText.scrollWidth;
  const startX = Math.max(18, Math.min(frameWidth * 0.18, 140));
  const endX = -(textWidth + 18);
  const speed = SPEED_MAP[settings.speed] || SPEED_MAP.normal;

  tickerText.style.transform = `translate(${startX}px, -50%)`;
  tickerText.style.opacity = '1';
  await holdWithPause(1300, token);
  if (token !== cycleToken) return;

  await animateMarquee(startX, endX, speed, token);
  if (token !== cycleToken) return;

  await holdWithPause(650, token);
}

function holdWithPause(ms, token) {
  return new Promise((resolve) => {
    const start = performance.now();

    function step(now) {
      if (token !== cycleToken) return resolve();
      if (hoverPaused || now < manualPauseUntil) {
        animationFrameId = requestAnimationFrame(step);
        return;
      }
      const elapsed = now - start - pausedDuration();
      if (elapsed >= ms) {
        animationFrameId = 0;
        return resolve();
      }
      animationFrameId = requestAnimationFrame(step);
    }

    let pauseAccum = 0;
    let pauseStartedAt = null;
    function pausedDuration() {
      if (hoverPaused || performance.now() < manualPauseUntil) {
        if (pauseStartedAt == null) pauseStartedAt = performance.now();
      } else if (pauseStartedAt != null) {
        pauseAccum += performance.now() - pauseStartedAt;
        pauseStartedAt = null;
      }
      return pauseAccum + (pauseStartedAt != null ? performance.now() - pauseStartedAt : 0);
    }

    animationFrameId = requestAnimationFrame(step);
  });
}

function animateMarquee(startX, endX, speed, token) {
  return new Promise((resolve) => {
    let x = startX;
    let previous;

    const fadeDistance = 110; // フェードに使う距離(px)
    const fadeStartX = endX + fadeDistance;

    function step(now) {
      if (token !== cycleToken) return resolve();
      if (previous == null) previous = now;

      const dt = now - previous;
      previous = now;

      if (!hoverPaused && now >= manualPauseUntil) {
        x -= (speed * dt) / 1000;
      }

      let opacity = 1;
      if (x <= fadeStartX) {
        const progress = Math.min(1, Math.max(0, (fadeStartX - x) / fadeDistance));
        opacity = 1 - progress;
      }

      tickerText.style.transform = `translate(${x}px, -50%)`;
      tickerText.style.opacity = String(opacity);

      if (x <= endX) {
        tickerText.style.opacity = '0';
        animationFrameId = 0;
        return resolve();
      }

      animationFrameId = requestAnimationFrame(step);
    }

    animationFrameId = requestAnimationFrame(step);
  });
}
async function cycleTodos() {
  cycleToken += 1;
  const token = cycleToken;
  cancelTickerAnimation();

  while (token === cycleToken) {
    filteredTodos = filterTodos(rawPayload, settings);
    updateMeta();

    if (!settings.jsonPath) {
      setLamp('idle');
      tickerText.classList.remove('done');
      tickerText.textContent = '右クリック → 「JSON を選ぶ…」で Log Cacher の JSON を指定してください';
      tickerText.style.transform = 'translate(18px, -50%)';
      await sleep(600);
      continue;
    }

    if (!rawPayload.ok) {
      setLamp('idle');
      tickerText.classList.remove('done');
      tickerText.textContent = 'JSON 読込エラー';
      tickerText.style.transform = 'translate(18px, -50%)';
      await sleep(900);
      continue;
    }

    if (!filteredTodos.length) {
      const sourceItems = getPayloadItems(rawPayload);
      const hasAnyItems = sourceItems.length > 0;

      setLamp(
        rawPayload.counts.active === 0 &&
        rawPayload.counts.done > 0 &&
        (rawPayload.counts.memo || 0) === 0
          ? 'ok'
          : 'idle'
      );

      tickerText.classList.remove('done');
      tickerText.textContent = hasAnyItems
        ? '表示対象の項目がありません'
        : 'TODO / メモがまだありません';

      tickerText.style.transform = 'translate(18px, -50%)';
      tickerText.style.opacity = '1';
      await sleep(1000);
      continue;
    }

    const todo = filteredTodos[currentIndex % filteredTodos.length];
    const kind = String(todo.kind || 'TODO').toUpperCase();
    setLamp(
      kind === 'MEMO'
        ? 'idle'
        : (todo.status === 'done' ? 'done' : 'active')
    );
    await playOneTodo(todo, token);

    if (token !== cycleToken) return;
    currentIndex = (currentIndex + 1) % filteredTodos.length;
  }
}

function refreshFromState() {
  filteredTodos = filterTodos(rawPayload, settings);
  if (currentIndex >= filteredTodos.length) currentIndex = 0;
  hideError();
  if (!rawPayload.ok && settings.jsonPath) {
    showError(rawPayload.error || 'JSON 読込エラー');
  }
  cycleTodos();
}

window.tickerApi.onTodoPayload((payload) => {
  rawPayload = payload;
  if (!payload.ok && settings.jsonPath) {
    showError(payload.error || 'JSON 読込エラー');
  } else {
    hideError();
  }
  refreshFromState();
});

window.tickerApi.onSettingsPayload((nextSettings) => {
  settings = { ...settings, ...nextSettings };
  refreshFromState();
});

window.tickerApi.onContextLabels(() => {
  // 将来の表示拡張用。今は受信だけ保持。
});

tickerFrame.addEventListener('mouseenter', () => {
  hoverPaused = true;
});

tickerFrame.addEventListener('mouseleave', () => {
  hoverPaused = false;
});

tickerFrame.addEventListener('click', async () => {
  if (!currentTodo?.url) return;
  await window.tickerApi.openUrl(currentTodo.url);
  showHint('元の ChatGPT ルームを開きました');
});

tickerFrame.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  window.tickerApi.showContextMenu();
});

window.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  window.tickerApi.showContextMenu();
});

window.addEventListener('wheel', (event) => {
  if (!filteredTodos.length) return;
  event.preventDefault();
  currentIndex = event.deltaY > 0
    ? (currentIndex + 1) % filteredTodos.length
    : (currentIndex - 1 + filteredTodos.length) % filteredTodos.length;
  manualPauseUntil = performance.now() + 1800;
  cycleTodos();
}, { passive: false });

window.addEventListener('keydown', async (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
    event.preventDefault();
    const result = await window.tickerApi.chooseJson();
    if (result?.ok) showHint('JSON を切り替えました');
  }
});

refreshFromState();
