/* Production-Grade WebGL GLSL Shader Engine for Active Theory Interface */

class ActiveGLSLEngine {
  constructor(canvasId = 'active-theory-canvas') {
    this.canvas = document.getElementById(canvasId) || this.createCanvas(canvasId);
    this.gl = this.canvas.getContext('webgl') || this.canvas.getContext('experimental-webgl');
    if (!this.gl) {
      console.warn('WebGL not supported, falling back to 2D canvas');
      return;
    }

    this.mouse = { x: 0.5, y: 0.5, targetX: 0.5, targetY: 0.5, velocity: 0 };
    this.scroll = { y: 0, targetY: 0, velocity: 0 };
    this.time = 0;

    this.initShaders();
    this.initBuffers();
    this.bindEvents();
    this.resize();
    this.render();
  }

  createCanvas(id) {
    const c = document.createElement('canvas');
    c.id = id;
    document.body.prepend(c);
    return c;
  }

  initShaders() {
    const vsSource = `
      attribute vec2 a_position;
      varying vec2 v_uv;
      void main() {
        v_uv = a_position * 0.5 + 0.5;
        v_uv.y = 1.0 - v_uv.y;
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `;

    const fsSource = `
      precision mediump float;
      varying vec2 v_uv;
      uniform vec2 u_resolution;
      uniform vec2 u_mouse;
      uniform float u_time;
      uniform float u_scroll_vel;

      // Simplex noise function
      vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

      float snoise(vec2 v) {
        const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                           -0.577350269189626, 0.024390243902439);
        vec2 i  = floor(v + dot(v, C.yy) );
        vec2 x0 = v -   i + dot(i, C.xx);
        vec2 i1;
        i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
        vec4 x12 = x0.xyxy + C.xxzz;
        x12.xy -= i1;
        i = mod289(i);
        vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
              + i.x + vec3(0.0, i1.x, 1.0 ) );
        vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
        m = m*m ;
        m = m*m ;
        vec3 x = 2.0 * fract(p * C.www) - 1.0;
        vec3 h = abs(x) - 0.5;
        vec3 ox = floor(x + 0.5);
        vec3 a0 = x - ox;
        m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
        vec3 g;
        g.x  = a0.x  * x0.x  + h.x  * x0.y;
        g.yz = a0.yz * x12.xz + h.yz * x12.yw;
        return 130.0 * dot(m, g);
      }

      void main() {
        vec2 st = gl_FragCoord.xy / u_resolution.xy;
        st.x *= u_resolution.x / u_resolution.y;

        // Mouse displacement
        float dist = distance(st, u_mouse * vec2(u_resolution.x/u_resolution.y, 1.0));
        float mouseEffect = smoothstep(0.4, 0.0, dist);

        // Fluid noise texture
        float n = snoise(st * 2.0 + vec2(u_time * 0.1, u_time * 0.05));
        float n2 = snoise(st * 4.0 - vec2(u_time * 0.15));

        // Base color palette: deep emerald black -> accent lime highlight
        vec3 colorBg = vec3(0.04, 0.06, 0.04);
        vec3 colorAccent = vec3(0.72, 1.0, 0.24); // #b8ff3d
        vec3 colorGlow = vec3(0.09, 0.23, 0.16); // #173b28

        float pattern = n * 0.5 + n2 * 0.5 + mouseEffect * 0.3;
        vec3 color = mix(colorBg, colorGlow, pattern * 0.8);
        color += colorAccent * (pow(mouseEffect, 2.5) * 0.4 + pow(max(0.0, n2), 4.0) * 0.15);

        // Chromatic aberration on fast scroll
        float shift = abs(u_scroll_vel) * 0.005;
        color.r += shift;
        color.b -= shift;

        gl_FragColor = vec4(color, 1.0);
      }
    `;

    const vertShader = this.compileShader(this.gl.VERTEX_SHADER, vsSource);
    const fragShader = this.compileShader(this.gl.FRAGMENT_SHADER, fsSource);

    this.program = this.gl.createProgram();
    this.gl.attachShader(this.program, vertShader);
    this.gl.attachShader(this.program, fragShader);
    this.gl.linkProgram(this.program);

    if (!this.gl.getProgramParameter(this.program, this.gl.LINK_STATUS)) {
      console.error('Program link error:', this.gl.getProgramInfoLog(this.program));
      return;
    }

    this.locations = {
      position: this.gl.getAttribLocation(this.program, 'a_position'),
      resolution: this.gl.getUniformLocation(this.program, 'u_resolution'),
      mouse: this.gl.getUniformLocation(this.program, 'u_mouse'),
      time: this.gl.getUniformLocation(this.program, 'u_time'),
      scrollVel: this.gl.getUniformLocation(this.program, 'u_scroll_vel'),
    };
  }

  compileShader(type, source) {
    const s = this.gl.createShader(type);
    this.gl.shaderSource(s, source);
    this.gl.compileShader(s);
    if (!this.gl.getShaderParameter(s, this.gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', this.gl.getShaderInfoLog(s));
    }
    return s;
  }

  initBuffers() {
    this.positionBuffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionBuffer);
    this.gl.bufferData(
      this.gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      this.gl.STATIC_DRAW
    );
  }

  bindEvents() {
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('mousemove', (e) => {
      this.mouse.targetX = e.clientX / window.innerWidth;
      this.mouse.targetY = 1.0 - e.clientY / window.innerHeight;
    });
  }

  resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.canvas.width = width;
    this.canvas.height = height;
    this.gl.viewport(0, 0, width, height);
  }

  render() {
    this.time += 0.016;

    // Smooth mouse lerp
    this.mouse.x += (this.mouse.targetX - this.mouse.x) * 0.08;
    this.mouse.y += (this.mouse.targetY - this.mouse.y) * 0.08;

    this.gl.useProgram(this.program);

    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionBuffer);
    this.gl.enableVertexAttribArray(this.locations.position);
    this.gl.vertexAttribPointer(this.locations.position, 2, this.gl.FLOAT, false, 0, 0);

    this.gl.uniform2f(this.locations.resolution, this.canvas.width, this.canvas.height);
    this.gl.uniform2f(this.locations.mouse, this.mouse.x, this.mouse.y);
    this.gl.uniform1f(this.locations.time, this.time);
    this.gl.uniform1f(this.locations.scrollVel, this.scroll.velocity);

    this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);

    requestAnimationFrame(() => this.render());
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { window.ActiveGLSL = new ActiveGLSLEngine(); });
} else {
  window.ActiveGLSL = new ActiveGLSLEngine();
}
