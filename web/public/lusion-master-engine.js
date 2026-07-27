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

    // ── 3D AIR COLLISION GARMENTS SYSTEM ──
    const collisionContainer = new THREE.Group();
    this.scene.add(collisionContainer);
    this.collisionContainer = collisionContainer;

    const simplexNoiseGLSL = `
      vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
      vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
      float snoise(vec3 v) {
        const vec2 C = vec2(1.0/6.0, 1.0/3.0);
        const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
        vec3 i  = floor(v + dot(v, C.yyy));
        vec3 x0 = v - i + dot(i, C.xxx);
        vec3 g = step(x0.yzx, x0.xyz);
        vec3 l = 1.0 - g;
        vec3 i1 = min(g.xyz, l.zxy);
        vec3 i2 = max(g.xyz, l.zxy);
        vec3 x1 = x0 - i1 + C.xxx;
        vec3 x2 = x0 - i2 + C.yyy;
        vec3 x3 = x0 - D.yyy;
        i = mod289(i);
        vec4 p = permute(permute(permute(
                  i.z + vec4(0.0, i1.z, i2.z, 1.0))
                + i.y + vec4(0.0, i1.y, i2.y, 1.0))
                + i.x + vec4(0.0, i1.x, i2.x, 1.0));
        float n_ = 0.142857142857;
        vec3  ns = n_ * D.wyz - D.xzx;
        vec4 x_ = floor(j * ns.z);
        vec4 y_ = floor(j - 7.0 * x_);
        vec4 x = x_ * ns.x + ns.yyyy;
        vec4 y = y_ * ns.x + ns.yyyy;
        vec4 h = 1.0 - abs(x) - abs(y);
        vec4 b0 = vec4(x.xy, y.xy);
        vec4 b1 = vec4(x.zw, y.zw);
        vec4 s0 = floor(b0) * 2.0 + 1.0;
        vec4 s1 = floor(b1) * 2.0 + 1.0;
        vec4 sh = -step(h, vec4(0.0));
        vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
        vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
        vec3 p0 = vec3(a0.xy, h.x);
        vec3 p1 = vec3(a0.zw, h.y);
        vec3 p2 = vec3(a1.xy, h.z);
        vec3 p3 = vec3(a1.zw, h.w);
        vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
        p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
        vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
        m = m * m;
        return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
      }
    `;

    const garmentMaterial = new THREE.ShaderMaterial({
      vertexShader: `
        ${simplexNoiseGLSL}
        uniform float uTime;
        uniform vec2 uMouse;
        varying vec3 vNormal;
        varying vec3 vViewPosition;
        varying float vDisplacement;
        void main() {
          vec3 pos = position;
          float wave = snoise(vec3(pos.x * 2.0 + uMouse.x, pos.y * 2.0 + uTime * 0.5, pos.z * 2.0)) * 0.08;
          vec3 newPos = pos + normal * wave;
          vDisplacement = wave;
          vNormal = normalize(normalMatrix * normal);
          vec4 mvPosition = modelViewMatrix * vec4(newPos, 1.0);
          vViewPosition = -mvPosition.xyz;
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec3 vNormal;
        varying vec3 vViewPosition;
        varying float vDisplacement;
        void main() {
          vec3 viewDir = normalize(vViewPosition);
          float fresnel = pow(1.0 - max(dot(vNormal, viewDir), 0.0), 2.2);
          vec3 baseColor = mix(vec3(0.05, 0.08, 0.1), vec3(0.15, 0.12, 0.08), vDisplacement * 2.0 + 0.5);
          vec3 irid = vec3(sin(vDisplacement * 10.0 + uTime), sin(vDisplacement * 10.0 + uTime + 2.0), sin(vDisplacement * 10.0 + uTime + 4.0)) * 0.5 + 0.5;
          baseColor = mix(baseColor, irid, fresnel * 0.5);
          baseColor += vec3(0.0, 0.95, 1.0) * pow(fresnel, 2.5) * 0.45;
          gl_FragColor = vec4(baseColor, 0.88);
        }
      `,
      uniforms: {
        uTime: { value: 0 },
        uMouse: { value: new THREE.Vector2(0, 0) }
      },
      transparent: true, side: THREE.DoubleSide, depthWrite: false
    });
    this.garmentUniforms = garmentMaterial.uniforms;

    // Floating Torso Jacket
    const jacketMesh = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 0.9, 3.2, 32, 16, true), garmentMaterial);
    jacketMesh.position.set(-4.5, 0, -4);
    collisionContainer.add(jacketMesh);
    this.jacketMesh = jacketMesh;

    // Floating Left Sleeve
    const lSleeveMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.3, 2.5, 24, 12, true), garmentMaterial);
    lSleeveMesh.position.set(-7.5, 1.5, -2);
    lSleeveMesh.rotation.z = 0.45;
    collisionContainer.add(lSleeveMesh);
    this.lSleeveMesh = lSleeveMesh;

    // Floating Right Sleeve
    const rSleeveMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.3, 2.5, 24, 12, true), garmentMaterial);
    rSleeveMesh.position.set(-1.5, 1.5, -5);
    rSleeveMesh.rotation.z = -0.45;
    collisionContainer.add(rSleeveMesh);
    this.rSleeveMesh = rSleeveMesh;

    // Volumetric Lasers
    const laserGroup = new THREE.Group();
    const laserGeo = new THREE.CylinderGeometry(0.02, 0.15, 22, 16);
    const laserMatCyan = new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending });
    const laserMatMagenta = new THREE.MeshBasicMaterial({ color: 0xff0088, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending });

    const l1 = new THREE.Mesh(laserGeo, laserMatCyan); l1.position.set(-12, 0, -8); l1.rotation.z = -0.5; laserGroup.add(l1);
    const l2 = new THREE.Mesh(laserGeo, laserMatMagenta); l2.position.set(12, 0, -8); l2.rotation.z = 0.5; laserGroup.add(l2);
    this.scene.add(laserGroup);

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

    // 3D Air Collision Garments Motion
    if (this.garmentUniforms) {
      const elapsed = Date.now() * 0.0015;
      this.garmentUniforms.uTime.value = elapsed;
      this.garmentUniforms.uMouse.value.set(this.mouse.x, this.mouse.y);

      if (this.jacketMesh) {
        this.jacketMesh.position.x = -4.5 + Math.sin(elapsed * 0.8) * 0.3 + this.mouse.x * 0.8;
        this.jacketMesh.position.y = cameraY + Math.cos(elapsed * 0.6) * 0.2 + this.mouse.y * 0.6;
        this.jacketMesh.rotation.y = Math.sin(elapsed * 0.5) * 0.3 + this.mouse.x * 0.4;
      }
      if (this.lSleeveMesh) {
        this.lSleeveMesh.position.x = -7.5 + Math.cos(elapsed * 0.9) * 0.4 + this.mouse.x * 1.1;
        this.lSleeveMesh.position.y = cameraY + 1.5 + Math.sin(elapsed * 0.7) * 0.3;
      }
      if (this.rSleeveMesh) {
        this.rSleeveMesh.position.x = -1.5 - Math.cos(elapsed * 0.9) * 0.4 + this.mouse.x * 1.1;
        this.rSleeveMesh.position.y = cameraY + 1.5 - Math.sin(elapsed * 0.7) * 0.3;
      }
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
