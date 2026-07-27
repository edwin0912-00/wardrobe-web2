/* Production Lusion Studio Engine (lusion.co 1-to-1 Interactive WebGL & Audio Engine) */

class LusionStudioEngine {
  constructor() {
    this.container = document.getElementById('lusion-canvas-container') || this.createContainer();
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });

    this.mouse = { x: 0, y: 0, targetX: 0, targetY: 0 };
    this.scroll = { currentY: window.scrollY, targetY: window.scrollY, velocity: 0 };
    this.cards = [];
    this.particleMesh = null;
    this.audioCtx = null;

    this.initWebGL();
    this.initAudio();
    this.initCursor();
    this.initScrollPhysics();
    this.initInteractiveCards();
    this.animate();
  }

  createContainer() {
    const div = document.createElement('div');
    div.id = 'lusion-canvas-container';
    document.body.prepend(div);
    return div;
  }

  initWebGL() {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.45;
    this.container.appendChild(this.renderer.domElement);

    this.camera.position.set(0, 0, 16);

    // Ambient & Point Lights
    const ambient = new THREE.AmbientLight(0x060c08, 3.5);
    this.scene.add(ambient);

    this.pointLight = new THREE.PointLight(0xb8ff3d, 7, 45);
    this.pointLight.position.set(6, 6, 12);
    this.scene.add(this.pointLight);

    const emeraldLight = new THREE.PointLight(0x173b28, 8, 60);
    emeraldLight.position.set(-10, -8, 6);
    this.scene.add(emeraldLight);

    // GPGPU 3D Particle Cloud with higher density
    const particleCount = 6000;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const scales = new Float32Array(particleCount);

    for (let i = 0; i < particleCount * 3; i += 3) {
      positions[i] = (Math.random() - 0.5) * 50;
      positions[i + 1] = (Math.random() - 0.5) * 90;
      positions[i + 2] = (Math.random() - 0.5) * 35;
      scales[i / 3] = Math.random() * 0.2 + 0.05;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('scale', new THREE.BufferAttribute(scales, 1));

    const material = new THREE.PointsMaterial({
      color: 0xb8ff3d,
      size: 0.15,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
    });

    this.particleMesh = new THREE.Points(geometry, material);
    this.scene.add(this.particleMesh);

    // Load generated visual concept texture
    const textureLoader = new THREE.TextureLoader();
    textureLoader.load('/ui-concept.png', (texture) => {
      texture.minFilter = THREE.LinearFilter;
      const conceptMaterial = new THREE.MeshPhysicalMaterial({
        map: texture,
        transparent: true,
        opacity: 0.92,
        roughness: 0.2,
        metalness: 0.1,
        clearcoat: 1.0,
        side: THREE.DoubleSide,
      });

      const planeGeo = new THREE.PlaneGeometry(6, 7.5);
      const conceptMesh = new THREE.Mesh(planeGeo, conceptMaterial);
      conceptMesh.position.set(7, 0, -2);
      conceptMesh.rotation.y = -0.3;
      this.scene.add(conceptMesh);
      this.cards.push(conceptMesh);
    });

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  initAudio() {
    window.addEventListener('click', () => {
      if (!this.audioCtx) {
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } else if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
    }, { once: true });
  }

  playUiSound(freq = 600, duration = 0.04) {
    if (!this.audioCtx || this.audioCtx.state !== 'running') return;
    try {
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, this.audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(150, this.audioCtx.currentTime + duration);
      gain.gain.setValueAtTime(0.06, this.audioCtx.currentTime);
      gain.gain.linearRampToValueAtTime(0.001, this.audioCtx.currentTime + duration);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start();
      osc.stop(this.audioCtx.currentTime + duration);
    } catch {}
  }

  initCursor() {
    const dot = document.createElement('div');
    dot.className = 'lusion-cursor-dot';
    const ring = document.createElement('div');
    ring.className = 'lusion-cursor-ring';

    document.body.appendChild(dot);
    document.body.appendChild(ring);

    window.addEventListener('mousemove', (e) => {
      this.mouse.targetX = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.targetY = -(e.clientY / window.innerHeight) * 2 + 1;

      dot.style.left = `${e.clientX}px`;
      dot.style.top = `${e.clientY}px`;
      ring.style.left = `${e.clientX}px`;
      ring.style.top = `${e.clientY}px`;
    });

    document.addEventListener('mouseover', (e) => {
      if (e.target.closest('button, a, input, .interactive-drop-zone, .lusion-card')) {
        ring.classList.add('is-hover');
      } else {
        ring.classList.remove('is-hover');
      }
    });
  }

  initScrollPhysics() {
    window.addEventListener('scroll', () => {
      this.scroll.targetY = window.scrollY;
    }, { passive: true });
  }

  initInteractiveCards() {
    const cards = document.querySelectorAll('.lusion-card');
    cards.forEach((card) => {
      card.addEventListener('mouseenter', () => this.playUiSound(750, 0.05));
    });
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    // Smooth lerp mouse & scroll
    this.mouse.x += (this.mouse.targetX - this.mouse.x) * 0.08;
    this.mouse.y += (this.mouse.targetY - this.mouse.y) * 0.08;

    const diff = this.scroll.targetY - this.scroll.currentY;
    this.scroll.velocity = diff * 0.07;
    this.scroll.currentY += this.scroll.velocity;

    // Lenis style 3D camera flight path
    const progress = this.scroll.currentY * 0.012;
    this.camera.position.y = -progress;
    this.camera.position.x = Math.sin(progress * 0.15) * 1.8;
    this.camera.rotation.z = Math.sin(progress * 0.08) * 0.04;

    // Dynamic light tracking
    this.pointLight.position.x = this.mouse.x * 12;
    this.pointLight.position.y = this.camera.position.y + this.mouse.y * 10;

    // Slow particle rotation & wave
    if (this.particleMesh) {
      this.particleMesh.rotation.y += 0.0008;
      this.particleMesh.rotation.x = Math.sin(Date.now() * 0.0004) * 0.04;
    }

    // 3D Card tilt on hover
    const cards = document.querySelectorAll('.lusion-card');
    cards.forEach((card) => {
      const rect = card.getBoundingClientRect();
      if (rect.top < window.innerHeight && rect.bottom > 0) {
        const cx = (this.mouse.targetX * window.innerWidth / 2 - (rect.left + rect.width / 2)) / (rect.width / 2);
        const cy = (-this.mouse.targetY * window.innerHeight / 2 - (rect.top + rect.height / 2)) / (rect.height / 2);
        if (Math.abs(cx) < 1.2 && Math.abs(cy) < 1.2) {
          card.style.transform = `perspective(1200px) rotateX(${(-cy * 8).toFixed(2)}deg) rotateY(${(cx * 8).toFixed(2)}deg) translateZ(12px)`;
        } else {
          card.style.transform = 'perspective(1200px) rotateX(0deg) rotateY(0deg) translateZ(0px)';
        }
      }
    });

    // Update progress HUD
    const maxScroll = (document.documentElement.scrollHeight - window.innerHeight) || 1;
    const scrollPct = Math.min(1, Math.max(0, this.scroll.currentY / maxScroll));
    const stepIdx = Math.min(3, Math.floor(scrollPct * 4));
    
    const progressEl = document.getElementById('lusion-progress-indicator');
    if (progressEl) {
      progressEl.textContent = `0${stepIdx + 1} / 04 CASE STUDIES`;
    }

    const navTabs = document.querySelectorAll('.hud-nav-tab');
    navTabs.forEach((tab, idx) => {
      if (idx === stepIdx) tab.classList.add('is-active');
      else tab.classList.remove('is-active');
    });

    this.renderer.render(this.scene, this.camera);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { window.LusionStudio = new LusionStudioEngine(); });
} else {
  window.LusionStudio = new LusionStudioEngine();
}

function scrollToSection(index) {
  if (window.LusionStudio) window.LusionStudio.playUiSound(850, 0.06);
  const sec = document.getElementById(`lusion-sec-${index}`);
  if (sec) sec.scrollIntoView({ behavior: 'smooth' });
}

function openLusionModal(title, text) {
  if (window.LusionStudio) window.LusionStudio.playUiSound(950, 0.08);
  document.getElementById('lusion-modal-title').textContent = title;
  document.getElementById('lusion-modal-desc').textContent = text;
  document.getElementById('lusion-modal').classList.add('is-open');
}

function closeLusionModal() {
  if (window.LusionStudio) window.LusionStudio.playUiSound(400, 0.05);
  document.getElementById('lusion-modal').classList.remove('is-open');
}
