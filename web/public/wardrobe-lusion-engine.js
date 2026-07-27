/* ============================================================
   WARDROBE LUSION ENGINE — 10 "W" OUTFIT VARIATIONS + CRT VHS
   Detailed procedural fabric texture, CRT scanlines, 3% VHS noise,
   counter-parallax shift, and 10 cycleable "W" Outfit Presets.
   ============================================================ */

(function() {
  'use strict';

  // ── GLSL Noise & Fabric Texture ──
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

      vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

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
      p0 *= norm.x;
      p1 *= norm.y;
      p2 *= norm.z;
      p3 *= norm.w;

      vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
      m = m * m;
      return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
    }
  `;

  // ── Vertex Shader (Garment Fold Waves + Micro Weave) ──
  const vertexShader = `
    ${simplexNoiseGLSL}
    
    uniform float uTime;
    uniform float uBreathing;
    uniform vec2 uMouse;
    
    varying vec3 vNormal;
    varying vec3 vPosition;
    varying float vDisplacement;
    varying vec3 vViewPosition;
    varying vec2 vUv;
    
    void main() {
      vUv = uv;
      vec3 pos = position;
      
      // Breathing Pulse
      float breathFactor = sin(uTime * 1.6) * 0.05 * uBreathing;
      pos += normal * breathFactor;
      
      // Fabric fold wave
      float wave = snoise(vec3(pos.x * 2.2, pos.y * 2.2 + uTime * 0.45, pos.z * 2.2)) * 0.07;
      vec3 newPosition = pos + normal * wave;
      
      vDisplacement = wave;
      vNormal = normalize(normalMatrix * normal);
      vPosition = newPosition;
      
      vec4 mvPosition = modelViewMatrix * vec4(newPosition, 1.0);
      vViewPosition = -mvPosition.xyz;
      
      gl_Position = projectionMatrix * mvPosition;
    }
  `;

  // ── Fragment Shader (Silk/Velvet Weave Texture + Enhanced Grain) ──
  const fragmentShader = `
    uniform float uTime;
    uniform vec3 uColor1;
    uniform vec3 uColor2;
    uniform vec3 uColor3;
    
    varying vec3 vNormal;
    varying vec3 vPosition;
    varying float vDisplacement;
    varying vec3 vViewPosition;
    varying vec2 vUv;
    
    float random(vec2 st) {
      return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
    }
    
    // Procedural Fabric Weave Micro-Pattern
    float fabricWeave(vec2 uv) {
      vec2 p = uv * 120.0;
      float pattern = sin(p.x) * cos(p.y);
      return pattern * 0.08;
    }
    
    void main() {
      vec3 viewDir = normalize(vViewPosition);
      
      // Fresnel Rim Light
      float fresnel = pow(1.0 - max(dot(vNormal, viewDir), 0.0), 2.2);
      
      // Velvet & Silk color blend
      vec3 fabricColor = mix(uColor1, uColor2, vDisplacement * 2.0 + 0.5);
      fabricColor = mix(fabricColor, uColor3, fresnel * 0.85);
      
      // Add Micro-Weave Texture Detail
      float weave = fabricWeave(vUv);
      fabricColor += vec3(weave);
      
      // Subsurface scattering glow
      vec3 sssGlow = vec3(0.9, 0.7, 0.5) * pow(fresnel, 3.0) * 0.5;
      fabricColor += sssGlow;
      
      // Specular highlight
      vec3 lightDir = normalize(vec3(0.8, 1.2, 2.0));
      vec3 halfDir = normalize(lightDir + viewDir);
      float spec = pow(max(dot(vNormal, halfDir), 0.0), 32.0);
      fabricColor += vec3(0.95, 0.9, 0.8) * spec * 0.35;
      
      // Film Grain Overlay (6% opacity for analogue tactile feel)
      float grain = (random(vUv * 2.0 + fract(uTime * 0.07)) - 0.5) * 0.09;
      fabricColor += grain;
      
      gl_FragColor = vec4(fabricColor, 0.92);
    }
  `;

  // ── Scene Setup ──
  const canvas = document.getElementById('canvas');
  if (!canvas) return;

  const renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance'
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  
  const camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    0.1,
    100
  );
  camera.position.set(0, 0, 6.0);

  const uniforms = {
    uTime: { value: 0 },
    uBreathing: { value: 1.0 },
    uMouse: { value: new THREE.Vector2(0, 0) },
    uColor1: { value: new THREE.Color(0x0a0804) },
    uColor2: { value: new THREE.Color(0x3a2812) },
    uColor3: { value: new THREE.Color(0xaa8042) },
  };

  const garmentMaterial = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  // ── 10 "W" OUTFIT VARIATIONS ──
  const outfitContainer = new THREE.Group();
  scene.add(outfitContainer);

  function createWVariation(index) {
    const group = new THREE.Group();

    switch(index) {
      case 0: { // 01. W-Classic Tailoring
        const shirt = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.45, 1.4, 32, 16, true), garmentMaterial);
        shirt.position.y = 0.5;
        group.add(shirt);
        const lSleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.14, 1.1, 24, 12, true), garmentMaterial);
        lSleeve.position.set(-0.72, 0.45, 0); lSleeve.rotation.z = 0.35; group.add(lSleeve);
        const rSleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.14, 1.1, 24, 12, true), garmentMaterial);
        rSleeve.position.set(0.72, 0.45, 0); rSleeve.rotation.z = -0.35; group.add(rSleeve);
        const lPant = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.18, 1.5, 24, 16, true), garmentMaterial);
        lPant.position.set(-0.28, -0.9, 0); lPant.rotation.z = 0.08; group.add(lPant);
        const rPant = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.18, 1.5, 24, 16, true), garmentMaterial);
        rPant.position.set(0.28, -0.9, 0); rPant.rotation.z = -0.08; group.add(rPant);
        break;
      }
      case 1: { // 02. W-Oversized Puffer
        const puffer = new THREE.Mesh(new THREE.TorusKnotGeometry(0.85, 0.35, 96, 24, 2, 3), garmentMaterial);
        puffer.position.y = 0.3; group.add(puffer);
        const lLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.22, 1.4, 24), garmentMaterial);
        lLeg.position.set(-0.35, -0.85, 0); group.add(lLeg);
        const rLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.22, 1.4, 24), garmentMaterial);
        rLeg.position.set(0.35, -0.85, 0); group.add(rLeg);
        break;
      }
      case 2: { // 03. W-Trench Coat
        const coat = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.75, 2.0, 32, 16, true), garmentMaterial);
        coat.position.y = 0.1; group.add(coat);
        const belt = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.06, 16, 32), garmentMaterial);
        belt.rotation.x = Math.PI/2; belt.position.y = 0.2; group.add(belt);
        break;
      }
      case 3: { // 04. W-Avant-Garde Drape
        const drape = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 32), garmentMaterial);
        drape.scale.set(0.8, 1.4, 0.8); drape.position.y = 0.2; group.add(drape);
        const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.1, 16, 32), garmentMaterial);
        scarf.rotation.x = 0.5; group.add(scarf);
        break;
      }
      case 4: { // 05. W-Cyber Tactical Vest
        const vest = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.4), garmentMaterial);
        vest.position.y = 0.4; group.add(vest);
        const lStrap = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.2, 16), garmentMaterial);
        lStrap.position.set(-0.4, 0.4, 0.2); group.add(lStrap);
        const rStrap = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.2, 16), garmentMaterial);
        rStrap.position.set(0.4, 0.4, 0.2); group.add(rStrap);
        break;
      }
      case 5: { // 06. W-Silk Kimono
        const kimono = new THREE.Mesh(new THREE.ConeGeometry(1.1, 1.8, 4), garmentMaterial);
        kimono.rotation.y = Math.PI/4; kimono.position.y = 0.2; group.add(kimono);
        break;
      }
      case 6: { // 07. W-Denim Structured Jacket
        const jacket = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.5, 1.2, 6, 8, true), garmentMaterial);
        jacket.position.y = 0.5; group.add(jacket);
        const lP = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.4, 16), garmentMaterial);
        lP.position.set(-0.3, -0.8, 0); group.add(lP);
        const rP = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.4, 16), garmentMaterial);
        rP.position.set(0.3, -0.8, 0); group.add(rP);
        break;
      }
      case 7: { // 08. W-Athleisure Tracksuit
        const top = new THREE.Mesh(new THREE.SphereGeometry(0.7, 32, 16), garmentMaterial);
        top.scale.set(0.9, 1.1, 0.7); top.position.y = 0.4; group.add(top);
        break;
      }
      case 8: { // 09. W-Haute Couture Wings
        const wings = new THREE.Mesh(new THREE.TorusKnotGeometry(0.9, 0.2, 128, 32, 3, 5), garmentMaterial);
        wings.position.y = 0.2; group.add(wings);
        break;
      }
      case 9: { // 10. W-Monochrome Tuxedo
        const tux = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.4, 1.5, 32, 16, true), garmentMaterial);
        tux.position.y = 0.4; group.add(tux);
        const lapel = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.05, 16, 32), garmentMaterial);
        lapel.rotation.x = Math.PI/3; lapel.position.y = 0.8; group.add(lapel);
        break;
      }
    }

    return group;
  }

  let activeVariationIndex = 0;
  let activeOutfitGroup = createWVariation(0);
  outfitContainer.add(activeOutfitGroup);

  // ── 3D Mirror Frame in Background ──
  const mirrorGroup = new THREE.Group();
  const frameGeo = new THREE.RingGeometry(2.4, 2.45, 64);
  const frameMat = new THREE.MeshBasicMaterial({
    color: 0xc8a97e,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.35,
  });
  const mirrorFrame = new THREE.Mesh(frameGeo, frameMat);
  mirrorFrame.position.z = -0.5;
  mirrorGroup.add(mirrorFrame);

  const glassGeo = new THREE.CircleGeometry(2.38, 64);
  const glassMat = new THREE.MeshBasicMaterial({
    color: 0x101518,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.25,
  });
  const glassPlane = new THREE.Mesh(glassGeo, glassMat);
  glassPlane.position.z = -0.52;
  mirrorGroup.add(glassPlane);

  scene.add(mirrorGroup);

  // ── Ambient Dust Particles ──
  const particleCount = 500;
  const particleGeometry = new THREE.BufferGeometry();
  const particlePositions = new Float32Array(particleCount * 3);
  const particleSizes = new Float32Array(particleCount);
  
  for (let i = 0; i < particleCount; i++) {
    particlePositions[i * 3] = (Math.random() - 0.5) * 18;
    particlePositions[i * 3 + 1] = (Math.random() - 0.5) * 18;
    particlePositions[i * 3 + 2] = (Math.random() - 0.5) * 10 - 2;
    particleSizes[i] = Math.random() * 2.5 + 0.5;
  }
  
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
  particleGeometry.setAttribute('size', new THREE.BufferAttribute(particleSizes, 1));

  const particleMaterial = new THREE.ShaderMaterial({
    vertexShader: `
      attribute float size;
      varying float vAlpha;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * (220.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
        vAlpha = smoothstep(15.0, 3.0, -mvPosition.z) * 0.22;
      }
    `,
    fragmentShader: `
      varying float vAlpha;
      void main() {
        float dist = length(gl_PointCoord - vec2(0.5));
        if (dist > 0.5) discard;
        float alpha = smoothstep(0.5, 0.05, dist) * vAlpha;
        gl_FragColor = vec4(0.95, 0.92, 0.85, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const particles = new THREE.Points(particleGeometry, particleMaterial);
  scene.add(particles);

  // ── Physics-Based Mouse Tracking & Counter-Parallax CRT Element ──
  const mouse = { x: 0, y: 0, targetX: 0, targetY: 0, vx: 0, vy: 0 };
  const crtLayer = document.querySelector('.l-crt-vhs-layer');
  
  document.addEventListener('mousemove', (e) => {
    mouse.targetX = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.targetY = -(e.clientY / window.innerHeight) * 2 + 1;
    
    // Counter-Parallax Shift for CRT Layer (-3mm / -12px counter axis)
    if (crtLayer) {
      const offsetX = -mouse.targetX * 12;
      const offsetY = -mouse.targetY * 12;
      crtLayer.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
    }
  });

  // ── Scroll Progress & Step Reactions ──
  let scrollProgress = 0;
  
  window.addEventListener('scroll', () => {
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    scrollProgress = Math.max(0, Math.min(1, window.scrollY / (maxScroll || 1)));
  });

  const targetColors = {
    c1: new THREE.Color(0x0a0804),
    c2: new THREE.Color(0x3a2812),
    c3: new THREE.Color(0xaa8042),
  };

  // Expose global controller
  window.wardrobeEngine = {
    setThemeColor(hexColor) {
      if (!hexColor) return;
      const base = new THREE.Color(hexColor);
      targetColors.c1.copy(base).multiplyScalar(0.25);
      targetColors.c2.copy(base).multiplyScalar(0.7);
      targetColors.c3.copy(base).multiplyScalar(1.3);
    },
    setOutfitVariation(index) {
      if (index < 0 || index >= 10) return;
      outfitContainer.remove(activeOutfitGroup);
      activeVariationIndex = index;
      activeOutfitGroup = createWVariation(index);
      outfitContainer.add(activeOutfitGroup);
    }
  };

  // ── Resize ──
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ── Animation Loop ──
  const clock = new THREE.Clock();
  const targetLookAt = new THREE.Vector3();

  function animate() {
    requestAnimationFrame(animate);
    
    const elapsed = clock.getElapsedTime();
    
    // Physics Damped Mouse Tracking
    const ax = (mouse.targetX - mouse.x) * 0.08;
    const ay = (mouse.targetY - mouse.y) * 0.08;
    mouse.vx = (mouse.vx + ax) * 0.85;
    mouse.vy = (mouse.vy + ay) * 0.85;
    mouse.x += mouse.vx;
    mouse.y += mouse.vy;
    
    // Lerp colors
    uniforms.uColor1.value.lerp(targetColors.c1, 0.04);
    uniforms.uColor2.value.lerp(targetColors.c2, 0.04);
    uniforms.uColor3.value.lerp(targetColors.c3, 0.04);
    
    // Update uniforms
    uniforms.uTime.value = elapsed;
    uniforms.uMouse.value.set(mouse.x, mouse.y);
    
    // Hollow Outfit LOOKS DIRECTLY AT MOUSE CURSOR
    targetLookAt.set(mouse.x * 4.0, mouse.y * 3.0 + 0.2, 5.0);
    outfitContainer.lookAt(targetLookAt);
    
    // Breathing scale pulse
    const breathScale = 1.0 + Math.sin(elapsed * 1.6) * 0.035;
    const scaleFactor = Math.max(0.45, (1.0 - scrollProgress * 0.75)) * breathScale;
    outfitContainer.scale.setScalar(scaleFactor);
    outfitContainer.position.y = scrollProgress * 1.4;
    
    // Mirror Frame Subtle Rotation
    mirrorGroup.rotation.y = mouse.x * 0.15;
    mirrorGroup.rotation.x = -mouse.y * 0.1;
    mirrorGroup.position.y = scrollProgress * 1.4;
    
    // Camera drift
    camera.position.x = mouse.x * 0.25;
    camera.position.y = mouse.y * 0.2;
    camera.lookAt(0, scrollProgress * 0.7, 0);
    
    // Animate dust particles
    const positions = particleGeometry.attributes.position.array;
    for (let i = 0; i < particleCount; i++) {
      positions[i * 3 + 1] += Math.sin(elapsed * 0.6 + i * 0.1) * 0.002;
      positions[i * 3] += Math.cos(elapsed * 0.4 + i * 0.05) * 0.001;
    }
    particleGeometry.attributes.position.needsUpdate = true;
    
    renderer.render(scene, camera);
  }

  animate();

})();
