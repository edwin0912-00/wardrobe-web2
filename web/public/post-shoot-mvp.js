import { fal } from './vendor/fal-client.js?v=20260727-3';

const MODEL_ID = 'decart/lucy-2-5/realtime';
const state = { stream: null, reference: null, connection: null, peer: null, timer: null, running: false };
const $ = (selector) => document.querySelector(selector);
const prompt = 'Replace only the current clothing with the outfit from the reference image. Preserve the person face, identity, hair, skin, body shape, pose and hands. Preserve the existing room, background, camera angle and lighting. Do not modify anything except the clothing.';

function status(text) { $('#live-status').textContent = text; }
function ready() {
  $('#lucy-start').disabled = state.running || !state.stream || !state.reference || !$('#cost-consent').checked;
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
async function startCamera() {
  state.stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  $('#camera').srcObject = state.stream;
  $('#camera-placeholder').classList.add('hidden');
  $('#camera-start').classList.add('hidden');
  $('#camera-stop').classList.remove('hidden');
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
  $('#camera').srcObject = null;
  $('#camera-placeholder').classList.remove('hidden');
  $('#camera-start').classList.remove('hidden');
  $('#camera-stop').classList.add('hidden');
  ready();
}
async function signal(result) {
  const type = result.type;
  if (type === 'iceservers' || type === 'iceServers') {
    const servers = result.iceservers || result.iceServers || result.ice_servers || [];
    state.peer = new RTCPeerConnection({ iceServers: servers });
    state.stream.getTracks().forEach((track) => state.peer.addTrack(track, state.stream));
    state.peer.ontrack = (event) => {
      $('#camera').srcObject = event.streams[0];
      status('LUCY LIVE · transformed stream');
    };
    state.peer.onicecandidate = (event) => {
      if (event.candidate) state.connection.send({ type: 'icecandidate', candidate: event.candidate.toJSON() });
    };
    const offer = await state.peer.createOffer();
    await state.peer.setLocalDescription(offer);
    state.connection.send({ type: 'offer', sdp: offer.sdp });
  } else if (type === 'answer') {
    await state.peer?.setRemoteDescription({ type: 'answer', sdp: result.sdp });
  } else if (type === 'icecandidate' && state.peer) {
    await state.peer.addIceCandidate(new RTCIceCandidate(result.candidate));
  } else if (type === 'error' || ((type === 'prompt_ack' || type === 'set_image_ack') && result.success === false)) {
    throw new Error(result.error || 'Lucy realtime error.');
  }
}
async function startLive() {
  state.running = true;
  ready();
  status('Підключення до Lucy…');
  state.timer = setTimeout(() => closeLive('5 секунд завершено. Live автоматично зупинено.'), 5_000);
  state.connection = fal.realtime.connect(MODEL_ID, {
    connectionKey: `zeely-${crypto.randomUUID()}`,
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
$('#cost-consent').addEventListener('change', ready);
$('#lucy-start').addEventListener('click', () => startLive().catch((error) => closeLive(`Помилка: ${error.message}`)));
$('#lucy-stop').addEventListener('click', () => closeLive());
window.addEventListener('pagehide', stopCamera);
ready();
