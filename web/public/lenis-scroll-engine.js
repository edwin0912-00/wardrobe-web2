/* Production Lenis-Style Kinetic Scroll Engine */

class LenisKineticScroll {
  constructor(options = {}) {
    this.duration = options.duration || 1.2;
    this.ease = options.ease || 0.075;
    this.currentScroll = window.scrollY;
    this.targetScroll = window.scrollY;
    this.velocity = 0;
    this.listeners = [];

    this.init();
  }

  init() {
    window.addEventListener('scroll', () => {
      this.targetScroll = window.scrollY;
    }, { passive: true });

    this.animate();
  }

  on(event, callback) {
    if (event === 'scroll' && typeof callback === 'function') {
      this.listeners.push(callback);
    }
  }

  animate() {
    const diff = this.targetScroll - this.currentScroll;
    this.velocity = diff * this.ease;
    this.currentScroll += this.velocity;

    // Trigger scroll listeners
    const progress = Math.min(1, Math.max(0, this.currentScroll / ((document.documentElement.scrollHeight - window.innerHeight) || 1)));
    this.listeners.forEach((fn) => fn({
      scroll: this.currentScroll,
      velocity: this.velocity,
      progress: progress,
    }));

    requestAnimationFrame(() => this.animate());
  }

  scrollTo(targetY) {
    window.scrollTo({ top: targetY, behavior: 'smooth' });
  }
}

window.LenisEngine = LenisKineticScroll;
