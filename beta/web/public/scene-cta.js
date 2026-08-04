/* Scene CTA behaviour: twinkling sparks + a sheen that tracks the cursor.
   Purely decorative — it never blocks or alters the button's own click. */

const CTA_SELECTOR = '#profile-look-scene, #create-scene';
const SPARK_COUNT = 7;

function decorate(button) {
  if (!button || button.dataset.ctaDecorated === '1') return;
  button.dataset.ctaDecorated = '1';

  // sparks sit just outside the label, spread along the pill
  for (let i = 0; i < SPARK_COUNT; i += 1) {
    const spark = document.createElement('i');
    spark.className = 'scene-cta-spark';
    spark.setAttribute('aria-hidden', 'true');
    const left = 6 + (88 / (SPARK_COUNT - 1)) * i + (i % 2 ? 2.5 : -2.5);
    const top = i % 2 ? 14 : 70;
    spark.style.left = `${left}%`;
    spark.style.top = `${top}%`;
    spark.style.setProperty('--delay', `${(i * 0.31).toFixed(2)}s`);
    spark.style.setProperty('--dur', `${(2.1 + (i % 3) * 0.45).toFixed(2)}s`);
    button.appendChild(spark);
  }

  button.addEventListener('pointermove', (event) => {
    const rect = button.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const mx = ((event.clientX - rect.left) / rect.width) * 100;
    const my = ((event.clientY - rect.top) / rect.height) * 100;
    button.style.setProperty('--scene-cta-mx', `${mx.toFixed(1)}%`);
    button.style.setProperty('--scene-cta-my', `${my.toFixed(1)}%`);
  });

  button.addEventListener('pointerleave', () => {
    button.style.setProperty('--scene-cta-mx', '50%');
    button.style.setProperty('--scene-cta-my', '50%');
  });
}

function scan() {
  document.querySelectorAll(CTA_SELECTOR).forEach(decorate);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', scan, { once: true });
} else {
  scan();
}

// The look detail panel is rendered on demand, so the button can appear later.
new MutationObserver(scan).observe(document.documentElement, {
  childList: true,
  subtree: true,
});
