const STATE_LABELS = {
  working: 'Working',
  searching: 'Searching',
  solving: 'Solving',
  listening: 'Listening',
  composing: 'Composing',
  shaping: 'Shaping',
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function rotate([x, y, z], yaw, pitch) {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const x1 = x * cy + z * sy;
  const z1 = -x * sy + z * cy;
  return [x1, y * cp - z1 * sp, y * sp + z1 * cp];
}

function spherePoints(count) {
  const points = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let index = 0; index < count; index += 1) {
    const y = 1 - (2 * (index + 0.5)) / count;
    const radius = Math.sqrt(1 - y * y);
    const angle = index * golden;
    points.push([Math.cos(angle) * radius, y, Math.sin(angle) * radius]);
  }
  return points;
}

const BASE_SPHERE = spherePoints(190);

function shapePoint(progress, shape) {
  const angle = progress * Math.PI * 2 - Math.PI / 2;
  if (shape === 0) return [Math.cos(angle), Math.sin(angle)];
  const vertices = shape === 1
    ? [[0, -1], [0.9, 0.62], [-0.9, 0.62]]
    : [[-0.72, -0.72], [0.72, -0.72], [0.72, 0.72], [-0.72, 0.72]];
  const section = progress * vertices.length;
  const start = Math.floor(section) % vertices.length;
  const local = section - Math.floor(section);
  const a = vertices[start];
  const b = vertices[(start + 1) % vertices.length];
  return [a[0] + (b[0] - a[0]) * local, a[1] + (b[1] - a[1]) * local];
}

function buildPoints(state, time) {
  if (state === 'shaping') {
    const cycle = time / 2.3;
    const from = Math.floor(cycle) % 3;
    const to = (from + 1) % 3;
    const mix = clamp((cycle % 1 - 0.58) / 0.42, 0, 1);
    const smooth = mix * mix * (3 - 2 * mix);
    return Array.from({ length: 44 }, (_, index) => {
      const progress = index / 44;
      const a = shapePoint(progress, from);
      const b = shapePoint(progress, to);
      return {
        x: a[0] + (b[0] - a[0]) * smooth,
        y: a[1] + (b[1] - a[1]) * smooth,
        z: 0,
        alpha: 0.9,
      };
    });
  }

  if (state === 'working') {
    const points = [];
    for (let ring = 0; ring < 9; ring += 1) {
      const tilt = (ring / 9) * Math.PI;
      for (let index = 0; index < 17; index += 1) {
        const angle = (index / 17) * Math.PI * 2 + time * (0.45 + ring * 0.025);
        const raw = [Math.cos(angle), Math.sin(angle) * Math.cos(tilt), Math.sin(angle) * Math.sin(tilt)];
        const point = rotate(raw, time * 0.16, 0.28);
        points.push({ x: point[0], y: point[1], z: point[2], alpha: 0.28 + (point[2] + 1) * 0.25 });
      }
    }
    return points;
  }

  return BASE_SPHERE.map((base, index) => {
    let [x, y, z] = base;
    let alpha = 0.36;
    if (state === 'listening') {
      const wave = 1 + 0.11 * Math.sin(time * 3.2 - y * 8);
      x *= wave;
      y *= wave;
      z *= wave;
    }
    if (state === 'solving') {
      const band = Math.floor((y + 1) * 4);
      [x, y, z] = rotate([x, y, z], Math.sin(time * 0.8 + band) * 0.22, band % 2 ? 0.12 : -0.12);
    }
    if (state === 'composing') {
      const ribbon = Math.abs(y - 0.2 * Math.sin(Math.atan2(z, x) * 3 - time * 2));
      alpha = ribbon < 0.26 ? 0.95 : 0.07;
    }
    const point = rotate([x, y, z], time * 0.42, 0.34 + Math.sin(time * 0.35) * 0.08);
    if (state === 'searching') {
      const angle = Math.atan2(point[2], point[0]);
      const scanner = Math.abs(Math.atan2(Math.sin(angle - time * 1.8), Math.cos(angle - time * 1.8)));
      alpha = scanner < 0.25 && point[2] > -0.2 ? 1 : 0.22 + (point[2] + 1) * 0.18;
    }
    return { x: point[0], y: point[1], z: point[2], alpha };
  });
}

export function createThinkingOrb(canvas, initialState = 'listening') {
  const context = canvas.getContext('2d');
  let state = initialState;
  let frame = 0;
  let visible = true;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function resize() {
    const size = Math.max(20, Math.round(canvas.getBoundingClientRect().width || 58));
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size * ratio);
    canvas.height = Math.round(size * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function draw(timeMs) {
    const size = canvas.width / Math.min(window.devicePixelRatio || 1, 2);
    context.clearRect(0, 0, size, size);
    const radius = size * 0.39;
    const points = buildPoints(state, reducedMotion.matches ? 0.6 : timeMs / 1000);
    points.sort((a, b) => a.z - b.z);
    for (const point of points) {
      const depth = (point.z + 1) / 2;
      const dot = Math.max(0.55, size * (0.008 + depth * 0.012));
      const green = Math.round(164 + depth * 91);
      context.fillStyle = `rgba(${Math.round(210 - depth * 80)},${green},${Math.round(196 - depth * 130)},${clamp(point.alpha, 0.04, 1)})`;
      context.beginPath();
      context.arc(size / 2 + point.x * radius, size / 2 + point.y * radius, dot, 0, Math.PI * 2);
      context.fill();
    }
    if (visible && !document.hidden && !reducedMotion.matches) frame = requestAnimationFrame(draw);
  }

  function start() {
    cancelAnimationFrame(frame);
    resize();
    draw(performance.now());
  }

  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) start();
    else cancelAnimationFrame(frame);
  });
  observer.observe(canvas);
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && visible) start();
    else cancelAnimationFrame(frame);
  });
  reducedMotion.addEventListener('change', start);
  canvas.setAttribute('role', 'img');

  return {
    setState(nextState) {
      state = STATE_LABELS[nextState] ? nextState : 'working';
      canvas.dataset.state = state;
      canvas.setAttribute('aria-label', `${STATE_LABELS[state]} pipeline activity`);
      start();
    },
  };
}
