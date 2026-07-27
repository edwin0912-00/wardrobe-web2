/* ============================================================
   WARDROBE LUSION ENGINE
   Three.js WebGL background with fluid mesh & dynamic pipeline reactions
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

  // ── Vertex Shader ──
  const vertexShader = `
    ${simplexNoiseGLSL}
    
    uniform float uTime;
    uniform float uNoiseScale;
    uniform float uNoiseStrength;
    uniform vec2 uMouse;
    
    varying vec3 vNormal;
    varying vec3 vPosition;
    varying float vDisplacement;
    varying vec3 vViewPosition;
    
    void main() {
      vec3 pos = position;
      
      float noise1 = snoise(pos * uNoiseScale + uTime * 0.3) * uNoiseStrength;
      float noise2 = snoise(pos * uNoiseScale * 2.0 + uTime * 0.5) * uNoiseStrength * 0.5;
      float noise3 = snoise(pos * uNoiseScale * 4.0 + uTime * 0.2) * uNoiseStrength * 0.25;
      
      float displacement = noise1 + noise2 + noise3;
      
      float mouseInfluence = smoothstep(2.0, 0.0, length(pos.xy - uMouse * 2.0));
      displacement += mouseInfluence * 0.15 * sin(uTime * 2.0);
      
      vec3 newPosition = pos + normal * displacement;
      
      vDisplacement = displacement;
      vNormal = normalize(normalMatrix * normal);
      vPosition = newPosition;
      
      vec4 mvPosition = modelViewMatrix * vec4(newPosition, 1.0);
      vViewPosition = -mvPosition.xyz;
      
      gl_Position = projectionMatrix * mvPosition;
    }
  `;

  // ── Fragment Shader ──
  const fragmentShader = `
    uniform float uTime;
    uniform vec3 uColor1;
    uniform vec3 uColor2;
    uniform vec3 uColor3;
    
    varying vec3 vNormal;
    varying vec3 vPosition;
    varying float vDisplacement;
    varying vec3 vViewPosition;
    
    void main() {
      vec3 viewDir = normalize(vViewPosition);
      float fresnel = pow(1.0 - max(dot(vNormal, viewDir), 0.0), 3.0);
      
      float colorMix1 = smoothstep(-0.3, 0.3, vDisplacement);
      float colorMix2 = smoothstep(0.0, 0.6, vDisplacement);
      
      vec3 baseColor = mix(uColor1, uColor2, colorMix1);
      baseColor = mix(baseColor, uColor3, colorMix2);
      
      vec3 rimColor = vec3(0.95, 0.85, 0.65);
      baseColor += rimColor * fresnel * 0.5;
      
      vec3 lightDir = normalize(vec3(1.0, 1.0, 2.0));
      vec3 halfDir = normalize(lightDir + viewDir);
      float spec = pow(max(dot(vNormal, halfDir), 0.0), 64.0);
      baseColor += vec3(1.0, 0.95, 0.9) * spec * 0.4;
      
      float ao = smoothstep(-0.5, 0.5, vDisplacement) * 0.3 + 0.7;
      baseColor *= ao;
      
      gl_FragColor = vec4(baseColor, 0.88);
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
  camera.position.set(0, 0, 5);

  // ── Fluid Mesh ──
  const geometry = new THREE.IcosahedronGeometry(1.2, 64);
  
  const uniforms = {
    uTime: { value: 0 },
    uNoiseScale: { value: 1.2 },
    uNoiseStrength: { value: 0.22 },
    uMouse: { value: new THREE.Vector2(0, 0) },
    uColor1: { value: new THREE.Color(0x0a0804) },
    uColor2: { value: new THREE.Color(0x3d2a0a) },
    uColor3: { value: new THREE.Color(0x8b6830) },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  // ── Ambient Particles ──
  const particleCount = 500;
  const particleGeometry = new THREE.BufferGeometry();
  const particlePositions = new Float32Array(particleCount * 3);
  const particleSizes = new Float32Array(particleCount);
  
  for (let i = 0; i < particleCount; i++) {
    particlePositions[i * 3] = (Math.random() - 0.5) * 20;
    particlePositions[i * 3 + 1] = (Math.random() - 0.5) * 20;
    particlePositions[i * 3 + 2] = (Math.random() - 0.5) * 10 - 3;
    particleSizes[i] = Math.random() * 2 + 0.5;
  }
  
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
  particleGeometry.setAttribute('size', new THREE.BufferAttribute(particleSizes, 1));

  const particleMaterial = new THREE.ShaderMaterial({
    vertexShader: `
      attribute float size;
      varying float vAlpha;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * (200.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
        vAlpha = smoothstep(15.0, 3.0, -mvPosition.z) * 0.2;
      }
    `,
    fragmentShader: `
      varying float vAlpha;
      void main() {
        float dist = length(gl_PointCoord - vec2(0.5));
        if (dist > 0.5) discard;
        float alpha = smoothstep(0.5, 0.1, dist) * vAlpha;
        gl_FragColor = vec4(0.94, 0.93, 0.9, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const particles = new THREE.Points(particleGeometry, particleMaterial);
  scene.add(particles);

  // ── Mouse Tracking ──
  const mouse = { x: 0, y: 0, targetX: 0, targetY: 0 };
  
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
    c1: new THREE.Color(0x0a0804),
    c2: new THREE.Color(0x3d2a0a),
    c3: new THREE.Color(0x8b6830),
  };

  // Expose global controller for 3D reactions
  window.wardrobeEngine = {
    setThemeColor(hexColor) {
      if (!hexColor) return;
      const base = new THREE.Color(hexColor);
      targetColors.c1.copy(base).multiplyScalar(0.2);
      targetColors.c2.copy(base).multiplyScalar(0.6);
      targetColors.c3.copy(base).multiplyScalar(1.2);
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
    
    // Smooth mouse
    mouse.x += (mouse.targetX - mouse.x) * 0.05;
    mouse.y += (mouse.targetY - mouse.y) * 0.05;
    
    // Lerp colors to target
    uniforms.uColor1.value.lerp(targetColors.c1, 0.03);
    uniforms.uColor2.value.lerp(targetColors.c2, 0.03);
    uniforms.uColor3.value.lerp(targetColors.c3, 0.03);
    
    // Update uniforms
    uniforms.uTime.value = elapsed;
    uniforms.uMouse.value.set(mouse.x, mouse.y);
    
    // Mesh rotation
    mesh.rotation.x = Math.sin(elapsed * 0.15) * 0.3 + mouse.y * 0.2;
    mesh.rotation.y = elapsed * 0.1 + mouse.x * 0.3;
    mesh.rotation.z = Math.cos(elapsed * 0.12) * 0.15;
    
    // Mesh position & scale relative to scroll
    const scaleFactor = Math.max(0.45, 1.0 - scrollProgress * 0.8);
    mesh.scale.setScalar(scaleFactor);
    mesh.position.y = scrollProgress * 1.5;
    
    // Camera subtle drift
    camera.position.x = mouse.x * 0.2;
    camera.position.y = mouse.y * 0.15;
    camera.lookAt(0, scrollProgress * 0.8, 0);
    
    // Animate particles
    const positions = particleGeometry.attributes.position.array;
    for (let i = 0; i < particleCount; i++) {
      positions[i * 3 + 1] += Math.sin(elapsed * 0.5 + i * 0.1) * 0.002;
      positions[i * 3] += Math.cos(elapsed * 0.3 + i * 0.05) * 0.001;
    }
    particleGeometry.attributes.position.needsUpdate = true;
    
    renderer.render(scene, camera);
  }

  animate();

})();
