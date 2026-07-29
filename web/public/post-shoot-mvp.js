const MODEL_ID = 'decart/lucy-2-5/realtime';
const state = { stream: null, reference: null, connection: null, peer: null, timer: null, guideTimer: null, running: false };
const $ = (selector) => document.querySelector(selector);
const prompt = 'Replace only the current clothing with the outfit from the reference image. Preserve the person face, identity, hair, skin, body shape, pose and hands. Preserve the existing room, background, camera angle and lighting. Do not modify anything except the clothing.';
const query = new URLSearchParams(location.search);

function status(text) { $('#live-status').textContent = text; }
function ready() {
  $('#lucy-start').disabled = state.running || !state.stream || !state.reference;
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
  $('#reference-preview').src = url;
  $('#reference-preview').classList.remove('hidden');
  $('#reference-placeholder').classList.add('hidden');
  $('#reference-status').textContent = `${file.name} · ${image.naturalWidth}×${image.naturalHeight} · READY`;
  ready();
}
async function loadSavedLookReference(lookId) {
  await loadReferenceUrl(
    `/api/profile/looks/${encodeURIComponent(lookId)}/image`,
    `look-${lookId}.png`,
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
  if (!window.isSecureContext) throw new Error('Камера потребує HTTPS.');
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Цей вбудований браузер не дає доступу до камери. Відкрий сторінку в Safari або Chrome.');
  }
  status('Запит дозволу на камеру…');
  state.stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  $('#camera').srcObject = state.stream;
  $('#camera-placeholder').classList.add('hidden');
  $('#camera-start').classList.add('hidden');
  $('#camera-stop').classList.remove('hidden');
  $('#fit-guide').classList.remove('is-complete');
  $('#fit-guide').classList.add('is-active');
  clearTimeout(state.guideTimer);
  state.guideTimer = setTimeout(() => {
    $('#fit-guide').classList.add('is-complete');
    status('POSITION LOCKED');
  }, 3_600);
  status('Відійди так, щоб було видно голову, торс і одяг до стегон.');
  ready();
}
function closeLive(message = 'Live зупинено.') {
  clearTimeout(state.timer);
  state.timer = null;
  state.peer?.close();
  state.connection?.close();
  state.peer = null;
  state.connection = null;
  state.running = false;
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
async function signal(result) {
  const type = String(result?.type ?? '').toLowerCase().replaceAll('_', '');
  if (type === 'iceservers'
    || Array.isArray(result?.iceservers)
    || Array.isArray(result?.iceServers)
    || Array.isArray(result?.ice_servers)) {
    if (state.peer) return;
    const servers = result.iceservers || result.iceServers || result.ice_servers || [];
    status('Lucy · налаштовуємо WebRTC…');
    state.peer = new RTCPeerConnection({ iceServers: servers });
    state.stream.getTracks().forEach((track) => state.peer.addTrack(track, state.stream));
    state.peer.ontrack = (event) => {
      $('#camera').srcObject = event.streams[0] || new MediaStream([event.track]);
      status('LUCY LIVE · transformed stream');
    };
    state.peer.onconnectionstatechange = () => {
      const connectionState = state.peer?.connectionState;
      if (connectionState === 'failed') closeLive('Помилка WebRTC: connection failed.');
      else if (connectionState === 'connected') status('Lucy · WebRTC connected, очікуємо відео…');
    };
    state.peer.onicecandidate = (event) => {
      if (event.candidate) state.connection.send({ type: 'icecandidate', candidate: event.candidate.toJSON() });
    };
    const offer = await state.peer.createOffer();
    await state.peer.setLocalDescription(offer);
    status('Lucy · надсилаємо camera offer…');
    state.connection.send({ type: 'offer', sdp: offer.sdp });
  } else if (type === 'answer' || (result?.sdp && state.peer?.localDescription)) {
    status('Lucy · отримано video answer…');
    await state.peer?.setRemoteDescription({ type: 'answer', sdp: result.sdp });
  } else if ((type === 'icecandidate' || (result?.candidate && !result?.sdp)) && state.peer) {
    await state.peer.addIceCandidate(new RTCIceCandidate(result.candidate));
  } else if (result?.error || type === 'error' || ((type === 'promptack' || type === 'setimageack') && result.success === false)) {
    throw new Error(result.error || 'Lucy realtime error.');
  }
}
async function startLive() {
  if (!window.confirm('Запустити 5 секунд Lucy Live? Максимальна вартість — $0.20.')) return;
  const falModule = await import('./vendor/fal-client.js?v=20260727-7');
  const fal = falModule.fal ?? falModule.default?.fal;
  if (typeof fal?.realtime?.connect !== 'function') {
    throw new Error('fal realtime client не завантажився.');
  }
  state.running = true;
  ready();
  status('Підключення до Lucy…');
  state.timer = setTimeout(() => closeLive(
    $('#camera').srcObject === state.stream
      ? '5 секунд завершено до отримання transformed stream.'
      : '5 секунд завершено. Live автоматично зупинено.',
  ), 5_000);
  state.connection = fal.realtime.connect(MODEL_ID, {
    connectionKey: `zeely-${crypto.randomUUID?.() || Date.now()}`,
    throttleInterval: 0,
    tokenExpirationSeconds: 10,
    tokenProvider: async (app) => {
      const response = await fetch('/api/fal/realtime-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app, cost_acknowledged: true, max_session_seconds: 5 }),
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
$('#camera-start').addEventListener('click', () => startCamera().catch((error) => status(`Camera error: ${error.message}`)));
$('#camera-stop').addEventListener('click', stopCamera);
$('#lucy-start').addEventListener('click', () => startLive().catch((error) => closeLive(`Помилка: ${error.message}`)));
$('#lucy-stop').addEventListener('click', () => closeLive());
window.addEventListener('pagehide', stopCamera);
ready();
const selectedLookId = query.get('look');
const demoOutfit = query.get('demo') === 'outfit';
if (query.get('embed') === '1') document.body.classList.add('is-embedded');
if (selectedLookId) {
  status('Завантажуємо вибраний образ…');
  loadSavedLookReference(selectedLookId)
    .then(() => status('Образ готовий. Увімкни камеру.'))
    .catch((error) => status(`Помилка образу: ${error.message}`));
} else if (demoOutfit) {
  status('Завантажуємо тестовий outfit…');
  loadReferenceUrl(
    '/live-test-outfit.png?v=20260729-1',
    'live-test-outfit.png',
    'Hoodie + sneakers · READY',
    { publicProviderUrl: true },
  )
    .then(() => status('Outfit готовий. Увімкни камеру.'))
    .catch((error) => status(`Помилка образу: ${error.message}`));
}
