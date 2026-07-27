/* Production Inertial Scroll Physics & Stop-Frame Machine */

class ActiveScrollPhysics {
  constructor() {
    this.currentY = window.scrollY;
    this.targetY = window.scrollY;
    this.velocity = 0;
    this.ease = 0.075;
    this.stopFrames = [
      { id: 'stop-01', name: '01 / 04 IDENTITY ANCHOR' },
      { id: 'stop-02', name: '02 / 04 GARMENT SCANNER' },
      { id: 'stop-03', name: '03 / 04 SCENE ENVIRONMENT' },
      { id: 'stop-04', name: '04 / 04 CAMPAIGN EXHIBITION' },
    ];

    this.bindEvents();
    this.update();
  }

  bindEvents() {
    window.addEventListener('scroll', () => {
      this.targetY = window.scrollY;
    }, { passive: true });

    // 3D Parallax & Raycasting for Work Cards
    document.addEventListener('mousemove', (e) => {
      const cards = document.querySelectorAll('.active-card');
      const mouseX = (e.clientX / window.innerWidth) * 2 - 1;
      const mouseY = -(e.clientY / window.innerHeight) * 2 + 1;

      cards.forEach((card) => {
        const rect = card.getBoundingClientRect();
        if (rect.top < window.innerHeight && rect.bottom > 0) {
          const tiltX = (mouseY * 6).toFixed(2);
          const tiltY = (mouseX * 6).toFixed(2);
          card.style.transform = `perspective(1200px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) translateZ(12px)`;
        }
      });
    });
  }

  update() {
    // Lerp scroll position
    const diff = this.targetY - this.currentY;
    this.velocity = diff * this.ease;
    this.currentY += this.velocity;

    // Pass velocity to WebGL Engine if active
    if (window.ActiveGLSL) {
      window.ActiveGLSL.scroll.velocity = this.velocity;
    }

    // Determine current stop frame
    const maxScroll = (document.documentElement.scrollHeight - window.innerHeight) || 1;
    const progress = Math.min(1, Math.max(0, this.currentY / maxScroll));
    const frameIndex = Math.min(3, Math.floor(progress * 4));
    
    const counterEl = document.getElementById('stop-frame-counter');
    if (counterEl && this.stopFrames[frameIndex]) {
      counterEl.textContent = this.stopFrames[frameIndex].name;
    }

    // Active HUD tab sync
    const navBtns = document.querySelectorAll('.hud-nav-btn');
    navBtns.forEach((btn, idx) => {
      if (idx === frameIndex) {
        btn.classList.add('is-active');
      } else {
        btn.classList.remove('is-active');
      }
    });

    requestAnimationFrame(() => this.update());
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { window.ActivePhysics = new ActiveScrollPhysics(); });
} else {
  window.ActivePhysics = new ActiveScrollPhysics();
}
