import { createThinkingOrb } from './thinking-orb.js?v=20260722-10';

const MODEL_ID = 'decart/lucy-2-5/realtime';
const SESSION_SECONDS = 15;
const state = {
  stream: null, reference: null, previewUrl: null, connection: null, peer: null, timer: null,
  countdownTimer: null, deadline: null, guideTimer: null, running: false, phase: 'READY',
  cameraPermission: 'prompt',
};
const $ = (selector) => document.querySelector(selector);
const liveThinkingOrb = createThinkingOrb($('#live-thinking-orb'), 'searching');
const prompt = 'Replace only the current clothing with the outfit from the reference image. Preserve the person face, identity, hair, skin, body shape, pose and hands. Preserve the existing room, background, camera angle and lighting. Do not modify anything except the clothing.';
const query = new URLSearchParams(location.search);
const LIVE_RETURN_FOCUS_KEY = 'zeely_live_return_focus';

function renderStatus() {
  const remaining = state.running && state.deadline
    ? Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000))
    : null;
  $('#live-status').textContent = remaining === null ? state.phase : `${state.phase} · ${remaining}s`;
}
function status(text) {
  state.phase = text;
  renderStatus();
}
function setAiThinking(active, orbState = 'working', title = 'AI працює', detail = 'Очікуємо наступний checkpoint') {
  const surface = $('#live-ai-thinking');
  surface.classList.toggle('hidden', !active);
  if (!active) return;
  liveThinkingOrb.setState(orbState);
  $('#live-ai-title').textContent = title;
  $('#live-ai-detail').textContent = detail;
}
function ready() {
  const privacyApproved = $('#privacy-consent').checked;
  const costApproved = $('#cost-consent').checked;
  $('#camera-start').disabled = state.running || !privacyApproved || Boolean(state.stream);
  $('#lucy-start').disabled = state.running
    || !state.stream
    || !state.reference
    || !privacyApproved
    || !costApproved;
}
function renderCameraPermission() {
  const labels = {
    granted: 'КАМЕРА · ДОЗВОЛЕНО',
    denied: 'КАМЕРА · ЗАБОРОНЕНО',
    prompt: 'КАМЕРА · НЕ ЗАПИТАНО',
    unavailable: 'КАМЕРА · НЕДОСТУПНА',
  };
  $('#camera-permission-status').textContent = labels[state.cameraPermission] || labels.prompt;
}
async function observeCameraPermission() {
  if (!navigator.mediaDevices?.getUserMedia) {
    state.cameraPermission = 'unavailable';
    renderCameraPermission();
    return;
  }
  if (!navigator.permissions?.query) return;
  try {
    const permission = await navigator.permissions.query({ name: 'camera' });
    const sync = () => {
      state.cameraPermission = permission.state;
      renderCameraPermission();
    };
    permission.addEventListener?.('change', sync);
    sync();
  } catch {
    // Safari does not expose camera through Permissions API; getUserMedia is authoritative.
  }
}
function dataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Не вдалося прочитати reference.'));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}
async function loadReference(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file?.type)) throw new Error('Потрібен JPEG, PNG або WebP.');
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  await image.decode();
  if (image.naturalWidth < 512 || image.naturalHeight < 512) throw new Error('Reference має бути мінімум 512×512.');
  state.reference = await dataUrl(file);
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = url;
  $('#reference-preview').src = state.previewUrl;
  $('#reference-preview').classList.remove('hidden');
  $('#reference-placeholder').classList.add('hidden');
  $('#reference-status').textContent = `${file.name} · ${image.naturalWidth}×${image.naturalHeight} · READY`;
  ready();
}
async function loadSavedLookReference(lookId) {
  await loadReferenceUrl(
    `/api/profile/looks/${encodeURIComponent(lookId)}/live-reference.png`,
    `live-reference-${lookId}.png`,
    'Вибраний образ · READY',
  );
}
async function loadReferenceUrl(url, fileName, readyLabel, { publicProviderUrl = false } = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Не вдалося відкрити тестовий образ.');
  const blob = await response.blob();
  const file = new File([blob], fileName, {
    type: blob.type || 'image/png',
    lastModified: Date.now(),
  });
  await loadReference(file);
  if (publicProviderUrl) state.reference = new URL(url, location.origin).href;
  $('#reference-upload').disabled = true;
  $('.reference-control').classList.add('is-bound');
  $('#reference-status').textContent = readyLabel;
}
async function startCamera() {
  if (!$('#privacy-consent').checked) throw new Error('Спочатку підтвердь використання камери для цієї сесії.');
  if (!window.isSecureContext) throw new Error('Камера потребує HTTPS.');
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Цей вбудований браузер не дає доступу до камери. Відкрий сторінку в Safari або Chrome.');
  }
  status('Запит дозволу на камеру…');
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    state.cameraPermission = 'granted';
  } catch (error) {
    state.cameraPermission = error?.name === 'NotAllowedError' ? 'denied' : state.cameraPermission;
    renderCameraPermission();
    throw error;
  }
  renderCameraPermission();
  $('#camera').srcObject = state.stream;
  $('#camera-placeholder').classList.add('hidden');
  $('#camera-start').classList.add('hidden');
  $('#camera-stop').classList.remove('hidden');
  $('#fit-guide').classList.remove('is-complete');
  $('#fit-guide').classList.add('is-active');
  clearTimeout(state.guideTimer);
  state.guideTimer = setTimeout(() => {
    $('#fit-guide').classList.add('is-complete');
    status('Позицію зафіксовано. Можна запускати Live.');
  }, 3_600);
  status('Відійди так, щоб було видно голову, торс і одяг до стегон.');
  ready();
}
function closeLive(message = 'Live зупинено.') {
  clearTimeout(state.timer);
  clearInterval(state.countdownTimer);
  state.timer = null;
  state.countdownTimer = null;
  state.deadline = null;
  state.peer?.close();
  state.connection?.close();
  state.peer = null;
  state.connection = null;
  state.running = false;
  setAiThinking(false);
  if (state.stream) $('#camera').srcObject = state.stream;
  status(message);
  ready();
}
function stopCamera() {
  closeLive('Камера вимкнена.');
  state.stream?.getTracks().forEach((track) => track.stop());
  state.stream = null;
  clearTimeout(state.guideTimer);
  $('#fit-guide').classList.remove('is-active', 'is-complete');
  $('#camera').srcObject = null;
  $('#camera-placeholder').classList.remove('hidden');
  $('#camera-start').classList.remove('hidden');
  $('#camera-stop').classList.add('hidden');
  ready();
}
function exitLiveSurface() {
  stopCamera();
  if (query.get('return') === 'profile') {
    sessionStorage.setItem(LIVE_RETURN_FOCUS_KEY, 'return');
    if (history.length > 1) {
      history.back();
      return;
    }
  }
  location.assign('/');
}
async function signal(result) {
  const type = String(result?.type ?? '').toLowerCase().replaceAll('_', '');
  if (type === 'iceservers'
    || Array.isArray(result?.iceservers)
    || Array.isArray(result?.iceServers)
    || Array.isArray(result?.ice_servers)) {
    if (state.peer) return;
    const servers = result.iceservers || result.iceServers || result.ice_servers || [];
    setAiThinking(true, 'solving', 'AI налаштовує потік', 'Узгоджуємо WebRTC та camera stream');
    status('Lucy · налаштовуємо WebRTC…');
    state.peer = new RTCPeerConnection({ iceServers: servers });
    state.stream.getTracks().forEach((track) => state.peer.addTrack(track, state.stream));
    state.peer.ontrack = (event) => {
      $('#camera').srcObject = event.streams[0] || new MediaStream([event.track]);
      setAiThinking(false);
      status('Real-time Look активний. Показуємо live-потік.');
    };
    state.peer.onconnectionstatechange = () => {
      const connectionState = state.peer?.connectionState;
      if (connectionState === 'failed') closeLive('Помилка WebRTC: connection failed.');
      else if (connectionState === 'connected') {
        setAiThinking(true, 'composing', 'AI формує Live-потік', 'WebRTC підключено, очікуємо перший кадр');
        status('Lucy · WebRTC connected, очікуємо відео…');
      }
    };
    state.peer.onicecandidate = (event) => {
      if (event.candidate) state.connection.send({ type: 'icecandidate', candidate: event.candidate.toJSON() });
    };
    const offer = await state.peer.createOffer();
    await state.peer.setLocalDescription(offer);
    status('Lucy · надсилаємо camera offer…');
    state.connection.send({ type: 'offer', sdp: offer.sdp });
  } else if (type === 'answer' || (result?.sdp && state.peer?.localDescription)) {
    setAiThinking(true, 'composing', 'AI формує Live-потік', 'Отримано video answer');
    status('Lucy · отримано video answer…');
    await state.peer?.setRemoteDescription({ type: 'answer', sdp: result.sdp });
  } else if ((type === 'icecandidate' || (result?.candidate && !result?.sdp)) && state.peer) {
    await state.peer.addIceCandidate(new RTCIceCandidate(result.candidate));
  } else if (result?.error || type === 'error' || ((type === 'promptack' || type === 'setimageack') && result.success === false)) {
    throw new Error(result.error || 'Lucy realtime error.');
  }
}
async function startLive() {
  if (!$('#privacy-consent').checked) throw new Error('Не підтверджено використання camera-потоку.');
  if (!$('#cost-consent').checked) throw new Error('Не підтверджено ліміт платної 15-секундної сесії.');
  if (!selectedLookId) throw new Error('Live запускається лише зі збереженого образу.');
  setAiThinking(true, 'working', 'AI підключає Live', 'Готуємо захищену realtime-сесію');
  const falModule = await import('./vendor/fal-client.js?v=20260727-7');
  const fal = falModule.fal ?? falModule.default?.fal;
  if (typeof fal?.realtime?.connect !== 'function') {
    throw new Error('fal realtime client не завантажився.');
  }
  state.running = true;
  state.deadline = Date.now() + SESSION_SECONDS * 1_000;
  ready();
  status('Підключення до Lucy…');
  state.countdownTimer = setInterval(renderStatus, 250);
  state.timer = setTimeout(() => closeLive(
    $('#camera').srcObject === state.stream
      ? '15 секунд завершено до отримання live-потоку.'
      : '15 секунд завершено. Live автоматично зупинено.',
  ), SESSION_SECONDS * 1_000);
  state.connection = fal.realtime.connect(MODEL_ID, {
    connectionKey: `zeely-${crypto.randomUUID?.() || Date.now()}`,
    throttleInterval: 0,
    tokenExpirationSeconds: 10,
    tokenProvider: async (app) => {
      if (!state.running || !$('#privacy-consent').checked || !$('#cost-consent').checked) {
        throw new Error('Згоду відкликано до створення Live-сесії.');
      }
      // Keep the SDK-provided app value intact here. The server validates the
      // full endpoint, then scopes fal's temporary JWT to the endpoint alias.
      // Sending the full endpoint in JWT allowed_apps makes Lucy close the
      // WebSocket with "Forbidden", even though token creation returns 200.
      const response = await fetch('/api/fal/realtime-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app,
          look_id: selectedLookId,
          privacy_consent: true,
          cost_acknowledged: true,
          max_session_seconds: SESSION_SECONDS,
        }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || `Token request failed (${response.status})`);
      }
      return response.text();
    },
    onResult: (result) => signal(result).catch((error) => closeLive(`Помилка: ${error.message}`)),
    onError: (error) => closeLive(`Помилка Lucy: ${error.message}`),
  });
  state.connection.send({ prompt, reference_image_url: state.reference, enable_prompt_expansion: false });
}

$('#reference-upload').addEventListener('change', (event) => loadReference(event.target.files?.[0]).catch((error) => {
  event.target.value = '';
  $('#reference-status').textContent = error.message;
}));
$('#privacy-gate-consent').addEventListener('change', (event) => {
  $('#privacy-continue').disabled = !event.target.checked;
});
$('#privacy-continue').addEventListener('click', () => {
  if (!$('#privacy-gate-consent').checked) return;
  $('#privacy-consent').checked = true;
  $('#privacy-gate').classList.add('hidden');
  ready();
  status('Згоду підтверджено. Камера ще вимкнена.');
  $('#camera-start').focus({ preventScroll: true });
});
$('#camera-start').addEventListener('click', () => startCamera().catch((error) => status(`Помилка камери: ${error.message}`)));
$('#camera-stop').addEventListener('click', stopCamera);
$('#privacy-consent').addEventListener('change', () => {
  if (!$('#privacy-consent').checked && state.stream) stopCamera();
  ready();
});
$('#cost-consent').addEventListener('change', () => {
  if (!$('#cost-consent').checked && state.running) closeLive('Платну Live-сесію зупинено.');
  ready();
});
$('#lucy-start').addEventListener('click', () => startLive().catch((error) => closeLive(`Помилка: ${error.message}`)));
$('#lucy-stop').addEventListener('click', () => closeLive());
document.querySelectorAll('[data-live-close]').forEach((button) => button.addEventListener('click', exitLiveSurface));
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  exitLiveSurface();
});
window.addEventListener('pagehide', () => {
  stopCamera();
  if (state.previewUrl) {
    URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = null;
  }
  if (query.get('return') === 'profile') sessionStorage.setItem(LIVE_RETURN_FOCUS_KEY, 'return');
});
ready();
const selectedLookId = query.get('look');
const demoOutfit = query.get('demo') === 'outfit';
if (query.get('embed') === '1') document.body.classList.add('is-embedded');
if (query.get('surface') === 'full') document.body.classList.add('is-full-surface');
if (selectedLookId) {
  setAiThinking(true, 'searching', 'AI відкриває образ', 'Завантажуємо перевірений reference');
  status('Завантажуємо вибраний образ…');
  loadSavedLookReference(selectedLookId)
    .then(() => {
      setAiThinking(false);
      status('Образ готовий. Увімкни камеру.');
    })
    .catch((error) => {
      setAiThinking(false);
      status(`Помилка образу: ${error.message}`);
    });
} else if (demoOutfit) {
  setAiThinking(true, 'searching', 'AI відкриває образ', 'Завантажуємо тестовий reference');
  status('Завантажуємо тестовий outfit…');
  loadReferenceUrl(
    '/live-test-outfit.png?v=20260729-1',
    'live-test-outfit.png',
    'Hoodie + sneakers · READY',
    { publicProviderUrl: true },
  )
    .then(() => {
      setAiThinking(false);
      status('Образ готовий. Увімкни камеру.');
    })
    .catch((error) => {
      setAiThinking(false);
      status(`Помилка образу: ${error.message}`);
    });
}
renderCameraPermission();
observeCameraPermission();
requestAnimationFrame(() => $('#privacy-gate-consent').focus({ preventScroll: true }));
