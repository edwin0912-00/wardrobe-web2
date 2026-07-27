/* ============================================================
   WARDROBE STUDIO — 3D AIR COLLISION & KINETIC PHYSICS ENGINE
   Multiple floating 3D fashion garments (Jacket, Pants, Sleeves, Drapes)
   floating in zero-gravity mid-air behind the UI, colliding dynamically
   and reacting to mouse turbulence & breathing rhythm.
   ============================================================ */

(function() {
  'use strict';

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

  const vertexShader = `
    ${simplexNoiseGLSL}
    uniform float uTime;
    uniform vec2 uMouse;
    
    varying vec3 vNormal;
    varying vec3 vPosition;
    varying float vDisplacement;
    varying vec3 vViewPosition;
    varying vec2 vUv;
    
    void main() {
      vUv = uv;
      vec3 pos = position;
      
      // Floating Air turbulence wave
      float wave = snoise(vec3(pos.x * 2.5 + uMouse.x, pos.y * 2.5 + uTime * 0.5, pos.z * 2.5 + uMouse.y)) * 0.09;
      vec3 newPos = pos + normal * wave;
      
      vDisplacement = wave;
      vNormal = normalize(normalMatrix * normal);
      vPosition = newPos;
      
      vec4 mvPosition = modelViewMatrix * vec4(newPos, 1.0);
      vViewPosition = -mvPosition.xyz;
      gl_Position = projectionMatrix * mvPosition;
    }
  `;

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
    
    void main() {
      vec3 viewDir = normalize(vViewPosition);
      float fresnel = pow(1.0 - max(dot(vNormal, viewDir), 0.0), 2.2);
      
      // Holographic Iridescent Shift
      float irid = sin(vDisplacement * 12.0 + uTime * 1.8 + fresnel * 4.0) * 0.5 + 0.5;
      vec3 iridColor = vec3(
        sin(irid * 3.14159),
        sin(irid * 3.14159 + 2.094),
        sin(irid * 3.14159 + 4.188)
      );

      vec3 color = mix(uColor1, uColor2, vDisplacement * 2.0 + 0.5);
      color = mix(color, uColor3, fresnel * 0.7);
      color = mix(color, iridColor * 0.8, fresnel * 0.6);

      // Cyan-Gold rim glow
      vec3 glow = vec3(0.0, 0.95, 1.0) * pow(fresnel, 2.5) * 0.5;
      color += glow;

      float grain = (random(vUv * 2.0 + fract(uTime * 0.07)) - 0.5) * 0.08;
      color += grain;

      gl_FragColor = vec4(color, 0.94);
    }
  `;

  const canvas = document.getElementById('canvas');
  if (!canvas) return;

  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, alpha: true, powerPreference: 'high-performance'
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 0, 7.0);

  const uniforms = {
    uTime: { value: 0 },
    uMouse: { value: new THREE.Vector2(0, 0) },
    uColor1: { value: new THREE.Color(0x06080a) },
    uColor2: { value: new THREE.Color(0x281a08) },
    uColor3: { value: new THREE.Color(0xdcb888) },
  };

  const garmentMaterial = new THREE.ShaderMaterial({
    vertexShader, fragmentShader, uniforms, transparent: true, side: THREE.DoubleSide, depthWrite: false
  });

  // ── 3D AIR COLLISION OBJECTS SYSTEM ──
  const collisionContainer = new THREE.Group();
  scene.add(collisionContainer);

  // Floating Garment 1: Outer Jacket Torso
  const jacketGeo = new THREE.CylinderGeometry(0.7, 0.55, 1.6, 32, 16, true);
  const jacketMesh = new THREE.Mesh(jacketGeo, garmentMaterial);
  jacketMesh.position.set(-0.2, 0.3, 0);

  // Floating Garment 2: Left Floating Sleeve
  const lSleeveGeo = new THREE.CylinderGeometry(0.22, 0.16, 1.3, 24, 12, true);
  const lSleeveMesh = new THREE.Mesh(lSleeveGeo, garmentMaterial);
  lSleeveMesh.position.set(-1.3, 0.5, 0.5);
  lSleeveMesh.rotation.z = 0.45;

  // Floating Garment 3: Right Floating Sleeve
  const rSleeveGeo = new THREE.CylinderGeometry(0.22, 0.16, 1.3, 24, 12, true);
  const rSleeveMesh = new THREE.Mesh(rSleeveGeo, garmentMaterial);
  rSleeveMesh.position.set(1.3, 0.5, -0.3);
  rSleeveMesh.rotation.z = -0.45;

  // Floating Garment 4: Left Trousers Leg
  const lLegGeo = new THREE.CylinderGeometry(0.28, 0.2, 1.7, 24, 16, true);
  const lLegMesh = new THREE.Mesh(lLegGeo, garmentMaterial);
  lLegMesh.position.set(-0.45, -1.2, 0.2);
  lLegMesh.rotation.z = 0.12;

  // Floating Garment 5: Right Trousers Leg
  const rLegGeo = new THREE.CylinderGeometry(0.28, 0.2, 1.7, 24, 16, true);
  const rLegMesh = new THREE.Mesh(rLegGeo, garmentMaterial);
  rLegMesh.position.set(0.45, -1.2, -0.2);
  rLegMesh.rotation.z = -0.12;

  // Floating Garment 6: Silk Drape Scarf
  const scarfGeo = new THREE.TorusKnotGeometry(0.9, 0.18, 96, 24, 2, 3);
  const scarfMesh = new THREE.Mesh(scarfGeo, garmentMaterial);
  scarfMesh.position.set(0, 0.2, -0.8);

  collisionContainer.add(jacketMesh, lSleeveMesh, rSleeveMesh, lLegMesh, rLegMesh, scarfMesh);

  // ── Volumetric Laser Beams ──
  const laserGroup = new THREE.Group();
  const laserGeo = new THREE.CylinderGeometry(0.01, 0.08, 14, 16);
  const laserMatCyan = new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending });
  const laserMatMagenta = new THREE.MeshBasicMaterial({ color: 0xff0088, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending });

  const l1 = new THREE.Mesh(laserGeo, laserMatCyan); l1.position.set(-4, 0, -2); l1.rotation.z = -0.6; laserGroup.add(l1);
  const l2 = new THREE.Mesh(laserGeo, laserMatCyan); l2.position.set(4, 0, -2); l2.rotation.z = 0.6; laserGroup.add(l2);
  const l3 = new THREE.Mesh(laserGeo, laserMatMagenta); l3.position.set(-3, 3, -3); l3.rotation.z = -0.3; l3.rotation.x = 0.4; laserGroup.add(l3);
  const l4 = new THREE.Mesh(laserGeo, laserMatMagenta); l4.position.set(3, -3, -3); l4.rotation.z = 0.3; l4.rotation.x = -0.4; laserGroup.add(l4);
  scene.add(laserGroup);

  // ── Mouse Air Interaction & Collision Physics ──
  const mouse = { x: 0, y: 0, targetX: 0, targetY: 0, vx: 0, vy: 0 };
  const crtLayer = document.querySelector('.l-crt-vhs-layer');

  document.addEventListener('mousemove', (e) => {
    mouse.targetX = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.targetY = -(e.clientY / window.innerHeight) * 2 + 1;
    if (crtLayer) {
      crtLayer.style.transform = `translate(${-mouse.targetX * 12}px, ${-mouse.targetY * 12}px)`;
    }
  });

  window.wardrobeEngine = {
    setThemeColor(hexColor) {
      if (!hexColor) return;
      const base = new THREE.Color(hexColor);
      uniforms.uColor1.value.copy(base).multiplyScalar(0.2);
      uniforms.uColor2.value.copy(base).multiplyScalar(0.6);
      uniforms.uColor3.value.copy(base).multiplyScalar(1.4);
    }
  };

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);
    const elapsed = clock.getElapsedTime();

    // Damped Mouse Physics
    mouse.vx += (mouse.targetX - mouse.x) * 0.08;
    mouse.vy += (mouse.targetY - mouse.y) * 0.08;
    mouse.vx *= 0.82; mouse.vy *= 0.82;
    mouse.x += mouse.vx; mouse.y += mouse.vy;

    uniforms.uTime.value = elapsed;
    uniforms.uMouse.value.set(mouse.x, mouse.y);

    // Dynamic Zero-Gravity Air Collision Motion for 3D Garment Parts
    const t = elapsed * 1.2;
    jacketMesh.position.x = -0.2 + Math.sin(t * 0.8) * 0.25 + mouse.x * 0.8;
    jacketMesh.position.y = 0.3 + Math.cos(t * 0.6) * 0.18 + mouse.y * 0.6;
    jacketMesh.rotation.y = Math.sin(t * 0.5) * 0.3 + mouse.x * 0.5;

    lSleeveMesh.position.x = -1.3 + Math.cos(t * 0.9) * 0.35 + mouse.x * 1.2;
    lSleeveMesh.position.y = 0.5 + Math.sin(t * 0.7) * 0.25 + mouse.y * 0.9;
    lSleeveMesh.rotation.z = 0.45 + Math.sin(t * 1.1) * 0.2;

    rSleeveMesh.position.x = 1.3 - Math.cos(t * 0.9) * 0.35 + mouse.x * 1.2;
    rSleeveMesh.position.y = 0.5 - Math.sin(t * 0.7) * 0.25 + mouse.y * 0.9;
    rSleeveMesh.rotation.z = -0.45 - Math.sin(t * 1.1) * 0.2;

    lLegMesh.position.x = -0.45 + Math.sin(t * 0.7) * 0.2 + mouse.x * 0.6;
    lLegMesh.position.y = -1.2 + Math.cos(t * 0.5) * 0.2 + mouse.y * 0.4;

    rLegMesh.position.x = 0.45 - Math.sin(t * 0.7) * 0.2 + mouse.x * 0.6;
    rLegMesh.position.y = -1.2 - Math.cos(t * 0.5) * 0.2 + mouse.y * 0.4;

    scarfMesh.rotation.x = t * 0.2 + mouse.y * 0.4;
    scarfMesh.rotation.y = t * 0.3 + mouse.x * 0.4;

    camera.position.x = mouse.x * 0.3;
    camera.position.y = mouse.y * 0.25;
    camera.lookAt(0, 0, 0);

    renderer.render(scene, camera);
  }

  animate();

})();
