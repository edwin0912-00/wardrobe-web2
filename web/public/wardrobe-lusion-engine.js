/* ============================================================
   WARDROBE LUSION ENGINE — HOLLOW GARMENT 3D VISUAL
   Floating invisible-body fashion drape with breathing dynamics,
   mouse-tracking inertia, and film grain shader texture.
   ============================================================ */

(function() {
  'use strict';

  // ── GLSL Noise (Simplex 3D) ──
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

  // ── Vertex Shader (Garment Fold & Breathing Displacement) ──
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
      
      // Fabric Breathing Expansion (chest & waist rhythm)
      float breathFactor = sin(uTime * 1.5) * 0.08 * uBreathing;
      float chestRegion = smoothstep(-0.5, 0.8, pos.y);
      pos += normal * (breathFactor * chestRegion);
      
      // Wind dynamics sliding through garment fabric
      float wave1 = snoise(vec3(pos.x * 1.5, pos.y * 1.5 + uTime * 0.4, pos.z * 1.5)) * 0.12;
      float wave2 = snoise(vec3(pos.x * 3.0 + uTime * 0.6, pos.y * 3.0, pos.z * 3.0)) * 0.05;
      float foldDisplacement = wave1 + wave2;
      
      // Mouse kinetic reaction (fabric stretches toward cursor)
      float mouseDist = length(pos.xy - uMouse * 2.5);
      float mouseStretch = smoothstep(2.5, 0.0, mouseDist) * 0.18 * sin(uTime * 2.5);
      
      vec3 newPosition = pos + normal * (foldDisplacement + mouseStretch);
      
      vDisplacement = foldDisplacement;
      vNormal = normalize(normalMatrix * normal);
      vPosition = newPosition;
      
      vec4 mvPosition = modelViewMatrix * vec4(newPosition, 1.0);
      vViewPosition = -mvPosition.xyz;
      
      gl_Position = projectionMatrix * mvPosition;
    }
  `;

  // ── Fragment Shader (Translucent Silk/Velvet + Grain Overlay) ──
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
    
    // Pseudo random film grain
    float random(vec2 st) {
      return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
    }
    
    void main() {
      vec3 viewDir = normalize(vViewPosition);
      
      // Velvet Rim & Fresnel Translucency
      float fresnel = pow(1.0 - max(dot(vNormal, viewDir), 0.0), 2.5);
      
      // Fabric fold shading
      float colorMix = smoothstep(-0.15, 0.15, vDisplacement);
      vec3 fabricColor = mix(uColor1, uColor2, colorMix);
      fabricColor = mix(fabricColor, uColor3, fresnel * 0.7);
      
      // Warm Subsurface Scattering Glow
      vec3 sssGlow = vec3(0.85, 0.65, 0.45) * pow(fresnel, 3.0) * 0.6;
      fabricColor += sssGlow;
      
      // Specular highlight on fabric folds
      vec3 lightDir = normalize(vec3(1.0, 1.5, 2.0));
      vec3 halfDir = normalize(lightDir + viewDir);
      float spec = pow(max(dot(vNormal, halfDir), 0.0), 32.0);
      fabricColor += vec3(0.95, 0.9, 0.8) * spec * 0.35;
      
      // Film Grain Overlay
      float grain = (random(vUv + fract(uTime * 0.1)) - 0.5) * 0.07;
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
  camera.position.set(0, 0, 5.2);

  // ── Create Floating Hollow Outfit Sculpture ──
  // TorusKnot + Cylinder Blend creates a floating draped coat/jacket silhouette
  const garmentGroup = new THREE.Group();
  
  // Outer Coat Fold (Torus Knot modified)
  const coatGeometry = new THREE.TorusKnotGeometry(0.95, 0.38, 128, 32, 2, 3);
  
  const uniforms = {
    uTime: { value: 0 },
    uBreathing: { value: 1.0 },
    uMouse: { value: new THREE.Vector2(0, 0) },
    uColor1: { value: new THREE.Color(0x0f0b06) },  // Dark mocha velvet
    uColor2: { value: new THREE.Color(0x4a341a) },  // Warm amber shadow
    uColor3: { value: new THREE.Color(0xc89b58) },  // Gold silk highlight
  };

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const coatMesh = new THREE.Mesh(coatGeometry, material);
  garmentGroup.add(coatMesh);

  // Inner Floating Drape Layer
  const innerGeometry = new THREE.IcosahedronGeometry(0.85, 32);
  const innerMesh = new THREE.Mesh(innerGeometry, material);
  innerMesh.scale.set(0.9, 1.2, 0.9);
  garmentGroup.add(innerMesh);

  scene.add(garmentGroup);

  // ── Ambient Dust Particles ──
  const particleCount = 600;
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

  // ── Physics-Based Mouse Inertia (Spring Damping) ──
  const mouse = { x: 0, y: 0, targetX: 0, targetY: 0, vx: 0, vy: 0 };
  
  document.addEventListener('mousemove', (e) => {
    mouse.targetX = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.targetY = -(e.clientY / window.innerHeight) * 2 + 1;
  });

  // ── Scroll Progress & Step Reactions ──
  let scrollProgress = 0;
  
  window.addEventListener('scroll', () => {
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    scrollProgress = Math.max(0, Math.min(1, window.scrollY / (maxScroll || 1)));
  });

  // Target Colors for Theme Shifts
  const targetColors = {
    c1: new THREE.Color(0x0f0b06),
    c2: new THREE.Color(0x4a341a),
    c3: new THREE.Color(0xc89b58),
  };

  // Expose global controller
  window.wardrobeEngine = {
    setThemeColor(hexColor) {
      if (!hexColor) return;
      const base = new THREE.Color(hexColor);
      targetColors.c1.copy(base).multiplyScalar(0.25);
      targetColors.c2.copy(base).multiplyScalar(0.7);
      targetColors.c3.copy(base).multiplyScalar(1.3);
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
    
    // Lerp colors to target
    uniforms.uColor1.value.lerp(targetColors.c1, 0.04);
    uniforms.uColor2.value.lerp(targetColors.c2, 0.04);
    uniforms.uColor3.value.lerp(targetColors.c3, 0.04);
    
    // Update uniforms
    uniforms.uTime.value = elapsed;
    uniforms.uMouse.value.set(mouse.x, mouse.y);
    
    // Floating Hollow Garment organic rotations following cursor
    garmentGroup.rotation.x = Math.sin(elapsed * 0.4) * 0.15 + mouse.y * 0.45;
    garmentGroup.rotation.y = elapsed * 0.2 + mouse.x * 0.65;
    garmentGroup.rotation.z = Math.cos(elapsed * 0.3) * 0.1;
    
    // Breathing scale pulse
    const breathPulse = 1.0 + Math.sin(elapsed * 1.5) * 0.04;
    const scaleFactor = Math.max(0.45, (1.0 - scrollProgress * 0.75)) * breathPulse;
    garmentGroup.scale.setScalar(scaleFactor);
    garmentGroup.position.y = scrollProgress * 1.4;
    
    // Camera follow cursor
    camera.position.x = mouse.x * 0.35;
    camera.position.y = mouse.y * 0.25;
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
