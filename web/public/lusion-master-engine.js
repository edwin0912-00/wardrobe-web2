/* Master Lusion 3D Engine (Three.js + GLSL + Lenis Scroll + Audio Synthesizer) */

class LusionMasterEngine {
  constructor() {
    this.container = document.getElementById('lusion-canvas-container') || this.createContainer();
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });

    this.mouse = { x: 0, y: 0, targetX: 0, targetY: 0 };
    this.scroll = { current: 0, velocity: 0, progress: 0 };
    this.cards = [];
    this.particleMesh = null;
    this.audioCtx = null;

    this.init();
  }

  createContainer() {
    const c = document.createElement('div');
    c.id = 'lusion-canvas-container';
    document.body.prepend(c);
    return c;
  }

  init() {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.4;
    this.container.appendChild(this.renderer.domElement);

    this.camera.position.set(0, 0, 16);

    this.setupLighting();
    this.setupGpgpuParticles();
    this.setup3DTextures();
    this.setupLenisScroll();
    this.setupMouseEvents();
    this.setupAudio();

    this.animate();
  }

  setupLighting() {
    const ambient = new THREE.AmbientLight(0x060c08, 3.8);
    this.scene.add(ambient);

    this.neonLight = new THREE.PointLight(0xb8ff3d, 8, 50);
    this.neonLight.position.set(6, 6, 12);
    this.scene.add(this.neonLight);

    const deepGlow = new THREE.PointLight(0x173b28, 10, 60);
    deepGlow.position.set(-10, -8, 6);
    this.scene.add(deepGlow);
  }

  setupGpgpuParticles() {
    const count = 8000;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const scales = new Float32Array(count);

    for (let i = 0; i < count * 3; i += 3) {
      positions[i] = (Math.random() - 0.5) * 55;
      positions[i + 1] = (Math.random() - 0.5) * 95;
      positions[i + 2] = (Math.random() - 0.5) * 40;
      scales[i / 3] = Math.random() * 0.22 + 0.05;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('scale', new THREE.BufferAttribute(scales, 1));

    const material = new THREE.PointsMaterial({
      color: 0xb8ff3d,
      size: 0.16,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
    });

    this.particleMesh = new THREE.Points(geometry, material);
    this.scene.add(this.particleMesh);
  }

  setup3DTextures() {
    const loader = new THREE.TextureLoader();
    
    // UI Concept Plane
    loader.load('/ui-concept.png', (texture) => {
      texture.minFilter = THREE.LinearFilter;
      const mat = new THREE.MeshPhysicalMaterial({
        map: texture,
        transparent: true,
        opacity: 0.94,
        roughness: 0.15,
        clearcoat: 1.0,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(6.5, 8.2), mat);
      mesh.position.set(7.5, 0, -2);
      mesh.rotation.y = -0.32;
      this.scene.add(mesh);
      this.cards.push(mesh);
    });

    // Clean Keyed Green Screen Neon Ring
    if (window.ChromaKeyExtractor) {
      window.ChromaKeyExtractor.extractTransparentCanvas('/isolated-neon-ring-green.png', {
        keyColor: [0, 255, 0],
        threshold: 100,
      }).then(({ dataDataUrl }) => {
        loader.load(dataDataUrl, (texture) => {
          texture.minFilter = THREE.LinearFilter;
          const mat = new THREE.MeshPhysicalMaterial({
            map: texture,
            transparent: true,
            opacity: 0.95,
            roughness: 0.1,
            metalness: 0.8,
            clearcoat: 1.0,
            side: THREE.DoubleSide,
          });
          const mesh = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), mat);
          mesh.position.set(-8, -18, -1);
          mesh.rotation.y = 0.35;
          this.scene.add(mesh);
          this.cards.push(mesh);
        });
      }).catch(() => {});
    }
  }

  setupLenisScroll() {
    if (window.LenisEngine) {
      this.lenis = new window.LenisEngine();
      this.lenis.on('scroll', (e) => {
        this.scroll.current = e.scroll;
        this.scroll.velocity = e.velocity;
        this.scroll.progress = e.progress;
      });
    }
  }

  setupMouseEvents() {
    window.addEventListener('mousemove', (e) => {
      this.mouse.targetX = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.targetY = -(e.clientY / window.innerHeight) * 2 + 1;
    });

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  setupAudio() {
    window.addEventListener('click', () => {
      if (!this.audioCtx) {
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } else if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
    }, { once: true });
  }

  playAudioClick(freq = 700, duration = 0.05) {
    if (!this.audioCtx || this.audioCtx.state !== 'running') return;
    try {
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, this.audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(160, this.audioCtx.currentTime + duration);
      gain.gain.setValueAtTime(0.07, this.audioCtx.currentTime);
      gain.gain.linearRampToValueAtTime(0.001, this.audioCtx.currentTime + duration);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start();
      osc.stop(this.audioCtx.currentTime + duration);
    } catch {}
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    // Smooth mouse lerp
    this.mouse.x += (this.mouse.targetX - this.mouse.x) * 0.08;
    this.mouse.y += (this.mouse.targetY - this.mouse.y) * 0.08;

    // Lenis Camera trajectory flight
    const cameraY = -this.scroll.current * 0.0125;
    this.camera.position.y = cameraY;
    this.camera.position.x = Math.sin(cameraY * 0.12) * 1.9;
    this.camera.rotation.z = Math.sin(cameraY * 0.06) * 0.045;

    // Neon light tracks cursor
    this.neonLight.position.x = this.mouse.x * 12;
    this.neonLight.position.y = cameraY + this.mouse.y * 9;

    // Rotate 8000 particle cloud
    if (this.particleMesh) {
      this.particleMesh.rotation.y += 0.001;
      this.particleMesh.rotation.x = Math.sin(Date.now() * 0.0004) * 0.05;
    }

    // 3D Card raycast tilt
    const cards = document.querySelectorAll('.lusion-card');
    cards.forEach((card) => {
      const rect = card.getBoundingClientRect();
      if (rect.top < window.innerHeight && rect.bottom > 0) {
        const cx = (this.mouse.targetX * window.innerWidth / 2 - (rect.left + rect.width / 2)) / (rect.width / 2);
        const cy = (-this.mouse.targetY * window.innerHeight / 2 - (rect.top + rect.height / 2)) / (rect.height / 2);
        if (Math.abs(cx) < 1.2 && Math.abs(cy) < 1.2) {
          card.style.transform = `perspective(1400px) rotateX(${(-cy * 8.5).toFixed(2)}deg) rotateY(${(cx * 8.5).toFixed(2)}deg) translateZ(14px)`;
        } else {
          card.style.transform = 'perspective(1400px) rotateX(0deg) rotateY(0deg) translateZ(0px)';
        }
      }
    });

    // Update progress HUD
    const stepIdx = Math.min(3, Math.floor(this.scroll.progress * 4));
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
  document.addEventListener('DOMContentLoaded', () => { window.LusionMaster = new LusionMasterEngine(); });
} else {
  window.LusionMaster = new LusionMasterEngine();
}

function scrollToSection(index) {
  if (window.LusionMaster) window.LusionMaster.playAudioClick(850, 0.06);
  const sec = document.getElementById(`lusion-sec-${index}`);
  if (sec) sec.scrollIntoView({ behavior: 'smooth' });
}

function openLusionModal(title, text) {
  if (window.LusionMaster) window.LusionMaster.playAudioClick(950, 0.08);
  document.getElementById('lusion-modal-title').textContent = title;
  document.getElementById('lusion-modal-desc').textContent = text;
  document.getElementById('lusion-modal').classList.add('is-open');
}

function closeLusionModal() {
  if (window.LusionMaster) window.LusionMaster.playAudioClick(400, 0.05);
  document.getElementById('lusion-modal').classList.remove('is-open');
}
