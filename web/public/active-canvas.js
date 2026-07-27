/* Active Theory Style Interactive Canvas & Physics Engine (activetheory.net/work) */

(() => {
  let canvas, ctx;
  let width, height;
  let particles = [];
  let mouse = { x: 0, y: 0, targetX: 0, targetY: 0 };
  let scrollY = 0;
  let targetScrollY = 0;

  function initCanvas() {
    canvas = document.createElement('canvas');
    canvas.id = 'active-theory-canvas';
    document.body.prepend(canvas);
    ctx = canvas.getContext('2d');
    resize();
    createParticles();
    createCursor();
    bindEvents();
    animate();
  }

  function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  }

  function createParticles() {
    particles = [];
    const count = Math.floor((width * height) / 25000);
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        size: Math.random() * 2 + 0.8,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        alpha: Math.random() * 0.5 + 0.1,
      });
    }
  }

  function createCursor() {
    const cursor = document.createElement('div');
    cursor.className = 'active-cursor';
    document.body.appendChild(cursor);

    window.addEventListener('mousemove', (e) => {
      mouse.targetX = e.clientX;
      mouse.targetY = e.clientY;
      cursor.style.left = `${e.clientX}px`;
      cursor.style.top = `${e.clientY}px`;
    });

    document.addEventListener('mouseover', (e) => {
      if (e.target.closest('button, a, input, label, .active-card')) {
        cursor.classList.add('is-hovering');
      } else {
        cursor.classList.remove('is-hovering');
      }
    });
  }

  function bindEvents() {
    window.addEventListener('resize', () => {
      resize();
      createParticles();
    });

    window.addEventListener('scroll', () => {
      targetScrollY = window.scrollY;
      updateStopFrameCounter();
    });

    // 3D Card Tilt Interaction
    document.addEventListener('mousemove', (e) => {
      mouse.x += (mouse.targetX - mouse.x) * 0.1;
      mouse.y += (mouse.targetY - mouse.y) * 0.1;

      const cards = document.querySelectorAll('.active-card');
      cards.forEach((card) => {
        const rect = card.getBoundingClientRect();
        const cardCenterX = rect.left + rect.width / 2;
        const cardCenterY = rect.top + rect.height / 2;
        
        // Only tilt if near or over the card
        const distX = e.clientX - cardCenterX;
        const distY = e.clientY - cardCenterY;
        
        if (Math.abs(distX) < rect.width * 0.8 && Math.abs(distY) < rect.height * 0.8) {
          const rotateX = (-distY / (rect.height / 2)) * 8; // max 8 deg
          const rotateY = (distX / (rect.width / 2)) * 8;
          card.style.transform = `rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) translateZ(10px)`;
        } else {
          card.style.transform = 'rotateX(0deg) rotateY(0deg) translateZ(0px)';
        }
      });
    });
  }

  function updateStopFrameCounter() {
    const totalHeight = document.documentElement.scrollHeight - window.innerHeight;
    const progress = Math.min(1, Math.max(0, window.scrollY / (totalHeight || 1)));
    const currentFrame = Math.min(4, Math.floor(progress * 4) + 1);
    const counterEl = document.querySelector('#stop-frame-counter');
    if (counterEl) {
      counterEl.textContent = `0${currentFrame} / 04 STOP-FRAMES`;
    }
  }

  function animate() {
    ctx.clearRect(0, 0, width, height);

    // Subtle dark fluid gradient background
    const grad = ctx.createRadialGradient(
      width / 2 + (mouse.x - width / 2) * 0.1,
      height / 2 + (mouse.y - height / 2) * 0.1,
      100,
      width / 2,
      height / 2,
      Math.max(width, height)
    );
    grad.addColorStop(0, '#141c16');
    grad.addColorStop(0.5, '#0a0e0b');
    grad.addColorStop(1, '#050705');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // Floating particles
    ctx.fillStyle = '#b8ff3d';
    particles.forEach((p) => {
      p.x += p.vx;
      p.y += p.vy;

      if (p.x < 0) p.x = width;
      if (p.x > width) p.x = 0;
      if (p.y < 0) p.y = height;
      if (p.y > height) p.y = 0;

      ctx.globalAlpha = p.alpha * 0.6;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    requestAnimationFrame(animate);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCanvas);
  } else {
    initCanvas();
  }
})();
