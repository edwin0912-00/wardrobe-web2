const state = {
  pipeline: null,
  mode: null,
  stream: null,
  selectedMotion: 'editorial_micro',
  referenceImage: null,
  referenceUrl: null,
};
const $ = (selector) => document.querySelector(selector);

async function loadPipeline() {
  const response = await fetch('/api/post-shoot/pipeline', { cache: 'no-store' });
  if (!response.ok) throw new Error('Pipeline config unavailable');
  state.pipeline = await response.json();
  renderModes();
}

function renderModes() {
  const grid = $('#mode-grid');
  grid.replaceChildren(...state.pipeline.modes.map((mode) => {
    const button = document.createElement('button');
    button.className = 'mode-card';
    const price = mode.id === 'live_webcam'
      ? `$${mode.price_usd_per_second.toFixed(2)}/сек · max $${(mode.price_usd_per_second * mode.max_session_seconds).toFixed(2)}`
      : 'ASYNC · QA BEFORE SAVE';
    button.innerHTML = `<small>${mode.nodes[0]} → ${mode.nodes.at(-1)}</small><b>${mode.title}</b><p>${mode.description}</p><small>${price}</small>`;
    button.addEventListener('click', () => openMode(mode.id));
    return button;
  }));
}

function openMode(modeId) {
  state.mode = state.pipeline.modes.find((mode) => mode.id === modeId);
  $('#workspace').classList.remove('hidden');
  $('#video-panel').classList.toggle('hidden', modeId !== 'video');
  $('#live-panel').classList.toggle('hidden', modeId !== 'live_webcam');
  $('#workspace-code').textContent = state.mode.nodes.join(' → ');
  $('#workspace-title').textContent = state.mode.title;
  renderNodes(0);
  $('#job-output').textContent = 'Очікує дію';
  $('#workspace').scrollIntoView({ behavior: 'smooth' });
}

function renderNodes(activeIndex, completed = false) {
  const byId = new Map(state.pipeline.nodes.map((node) => [node.id, node]));
  $('#node-list').replaceChildren(...state.mode.nodes.map((id, index) => {
    const node = byId.get(id);
    const item = document.createElement('li');
    item.className = completed || index < activeIndex ? 'done' : index === activeIndex ? 'active' : '';
    item.innerHTML = `<b>${node.id}</b><small>${node.title}</small>`;
    return item;
  }));
}

async function startCamera() {
  state.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
  $('#camera').srcObject = state.stream;
  $('#camera-placeholder').classList.add('hidden');
  $('#camera-start').classList.add('hidden');
  $('#camera-stop').classList.remove('hidden');
  renderNodes(1);
}

function stopCamera() {
  state.stream?.getTracks().forEach((track) => track.stop());
  state.stream = null;
  $('#camera').srcObject = null;
  $('#camera-placeholder').classList.remove('hidden');
  $('#camera-start').classList.remove('hidden');
  $('#camera-stop').classList.add('hidden');
}

async function prepareLucy() {
  if (!state.referenceImage) {
    $('#job-output').textContent = 'Спочатку завантаж reference photo мінімум 512×512.';
    return;
  }
  renderNodes(2);
  const response = await fetch('/api/fal/realtime-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app: 'decart/lucy-2-5/realtime',
      cost_acknowledged: true,
      max_session_seconds: 5,
    }),
  });
  if (!response.ok) {
    const error = await response.json();
    $('#job-output').textContent = JSON.stringify(error, null, 2);
    return;
  }
  $('#job-output').textContent = 'Provider token ready. WebRTC connection intentionally not auto-started in draft mode.';
}

async function loadReference(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file?.type)) {
    throw new Error('Потрібен JPEG, PNG або WebP.');
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  await image.decode();
  if (image.naturalWidth < 512 || image.naturalHeight < 512) {
    URL.revokeObjectURL(url);
    throw new Error('Reference photo має бути мінімум 512×512.');
  }
  if (state.referenceUrl) URL.revokeObjectURL(state.referenceUrl);
  state.referenceImage = file;
  state.referenceUrl = url;
  $('#reference-preview').src = url;
  $('#reference-preview').classList.remove('hidden');
  $('#reference-placeholder').classList.add('hidden');
  $('#reference-status').textContent = `${file.name} · ${image.naturalWidth}×${image.naturalHeight} · готово локально`;
}

function videoDryRun() {
  renderNodes(3, true);
  $('#job-output').textContent = JSON.stringify({
    schema_version: '1.0.0',
    pipeline_node: 'VIDEO.03',
    dry_run: true,
    source: { shoot_id: 'demo.approved.shoot', status: 'APPROVED', hash_bound: true },
    motion_plan: state.selectedMotion,
    paid_create_authorized: false,
    next_action: 'REVIEW_THEN_EXPLICITLY_AUTHORIZE_PROVIDER',
  }, null, 2);
}

document.addEventListener('click', (event) => {
  const preset = event.target.closest('[data-motion]');
  if (!preset) return;
  document.querySelectorAll('[data-motion]').forEach((item) => item.classList.remove('selected'));
  preset.classList.add('selected');
  state.selectedMotion = preset.dataset.motion;
  renderNodes(1);
});
$('#camera-start').addEventListener('click', () => startCamera().catch((error) => {
  $('#job-output').textContent = `Camera error: ${error.message}`;
}));
$('#camera-stop').addEventListener('click', stopCamera);
$('#cost-consent').addEventListener('change', (event) => {
  $('#lucy-start').disabled = !event.target.checked;
});
$('#lucy-start').addEventListener('click', prepareLucy);
$('#reference-upload').addEventListener('change', (event) => {
  loadReference(event.target.files?.[0]).catch((error) => {
    event.target.value = '';
    $('#reference-status').textContent = error.message;
  });
});
$('#video-dry-run').addEventListener('click', videoDryRun);
$('#close-workspace').addEventListener('click', () => {
  stopCamera();
  $('#workspace').classList.add('hidden');
});
window.addEventListener('pagehide', () => {
  stopCamera();
  if (state.referenceUrl) URL.revokeObjectURL(state.referenceUrl);
});
loadPipeline().catch((error) => {
  $('#mode-grid').textContent = error.message;
});
