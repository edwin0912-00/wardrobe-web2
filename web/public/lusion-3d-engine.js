/* Lusion.co Style Three.js 3D WebGL Engine for Wardrobe AI Studio */

class Lusion3DEngine {
  constructor() {
    this.container = document.getElementById('active-theory-canvas') || this.createCanvasContainer();
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    
    this.mouse = new THREE.Vector2();
    this.targetMouse = new THREE.Vector2();
    this.scroll = { currentY: 0, targetY: 0, velocity: 0 };
    this.cards = [];
    this.particles = null;

    this.init();
  }

  createCanvasContainer() {
    const c = document.createElement('div');
    c.id = 'active-theory-canvas';
    document.body.prepend(c);
    return c;
  }

  init() {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.container.appendChild(this.renderer.domElement);

    this.camera.position.set(0, 0, 15);

    this.addLighting();
    this.createParticleField();
    this.create3DCards();
    this.bindEvents();
    this.animate();
  }

  addLighting() {
    const ambientLight = new THREE.AmbientLight(0x0a120c, 2.5);
    this.scene.add(ambientLight);

    // Neon Accent Point Light (#b8ff3d)
    this.neonLight = new THREE.PointLight(0xb8ff3d, 4, 35);
    this.neonLight.position.set(5, 5, 8);
    this.scene.add(this.neonLight);

    // Emerald Deep Glow Light (#173b28)
    const emeraldLight = new THREE.PointLight(0x173b28, 6, 50);
    emeraldLight.position.set(-8, -5, 5);
    this.scene.add(emeraldLight);
  }

  createParticleField() {
    const count = 3000;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const scales = new Float32Array(count);

    for (let i = 0; i < count * 3; i += 3) {
      positions[i] = (Math.random() - 0.5) * 40;
      positions[i + 1] = (Math.random() - 0.5) * 60;
      positions[i + 2] = (Math.random() - 0.5) * 30;
      scales[i / 3] = Math.random() * 0.15 + 0.05;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('scale', new THREE.BufferAttribute(scales, 1));

    const material = new THREE.PointsMaterial({
      color: 0xb8ff3d,
      size: 0.12,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
    });

    this.particles = new THREE.Points(geometry, material);
    this.scene.add(this.particles);
  }

  create3DCards() {
    const phases = [
      { name: '01. IDENTITY ANCHOR', y: 0, color: 0xb8ff3d },
      { name: '02. WARDROBE SCANNER', y: -15, color: 0xffffff },
      { name: '03. 16 SCENE PRESETS', y: -30, color: 0xb8ff3d },
      { name: '04. CAMPAIGN EXHIBITION', y: -45, color: 0xffffff },
    ];

    const cardGeometry = new THREE.PlaneGeometry(8, 4.8, 16, 16);

    phases.forEach((phase) => {
      const material = new THREE.MeshPhysicalMaterial({
        color: 0x121814,
        roughness: 0.1,
        metalness: 0.1,
        transmission: 0.6,
        transparent: true,
        opacity: 0.85,
        reflectivity: 0.9,
        clearcoat: 1.0,
        clearcoatRoughness: 0.1,
        side: THREE.DoubleSide,
      });

      const cardMesh = new THREE.Mesh(cardGeometry, material);
      cardMesh.position.set(0, phase.y, 0);
      cardMesh.userData = { phaseName: phase.name, initialY: phase.y };
      
      this.scene.add(cardMesh);
      this.cards.push(cardMesh);
    });
  }

  bindEvents() {
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    window.addEventListener('mousemove', (e) => {
      this.targetMouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.targetMouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    });

    window.addEventListener('scroll', () => {
      this.scroll.targetY = window.scrollY;
    }, { passive: true });
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    // Mouse lerp
    this.mouse.x += (this.targetMouse.x - this.mouse.x) * 0.08;
    this.mouse.y += (this.targetMouse.y - this.mouse.y) * 0.08;

    // Scroll lerp (Lenis style smooth inertia)
    const scrollDiff = this.scroll.targetY - this.scroll.currentY;
    this.scroll.velocity = scrollDiff * 0.06;
    this.scroll.currentY += this.scroll.velocity;

    // Camera trajectory flight through 3D space
    const scrollProgress = this.scroll.currentY * 0.015;
    this.camera.position.y = -scrollProgress;
    this.camera.position.x = Math.sin(scrollProgress * 0.2) * 1.5;
    this.camera.rotation.z = Math.sin(scrollProgress * 0.1) * 0.05;

    // Move light with mouse
    this.neonLight.position.x = this.mouse.x * 10;
    this.neonLight.position.y = this.camera.position.y + this.mouse.y * 8;

    // Particle field slow float & wave
    if (this.particles) {
      this.particles.rotation.y += 0.001;
      this.particles.rotation.x = Math.sin(Date.now() * 0.0005) * 0.05;
    }

    // 3D Card tilt on mouse hover
    this.cards.forEach((card) => {
      const distToCam = Math.abs(card.position.y - this.camera.position.y);
      if (distToCam < 12) {
        card.rotation.x = -this.mouse.y * 0.25;
        card.rotation.y = this.mouse.x * 0.25;
      }
    });

    this.renderer.render(this.scene, this.camera);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { window.Lusion3D = new Lusion3DEngine(); });
} else {
  window.Lusion3D = new Lusion3DEngine();
}
