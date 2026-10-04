// A burst of paper confetti on a full-screen canvas, for big moments: a
// mission done, a word across the illusion, a bingo. Draws only while pieces
// are falling, and not at all for players who prefer reduced motion.

const COLORS = ['#f2777a', '#35b394', '#8c70d8', '#f4b942', '#1fbfae', '#ff8a00'];
const GRAVITY = 900; // px/s²

export function createConfetti(canvas) {
  const ctx = canvas.getContext('2d');
  let pieces = [];
  let last = 0;
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  function resize() {
    const ratio = Math.min(window.devicePixelRatio, 2);
    canvas.width = window.innerWidth * ratio;
    canvas.height = window.innerHeight * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);

  function frame(time) {
    // Real time, even when frames are slow, so a burst never lingers.
    const dt = Math.min(0.25, (time - (last || time)) / 1000);
    last = time;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    pieces = pieces.filter((p) => (p.life -= dt) > 0 && p.y < window.innerHeight + 40);
    for (const p of pieces) {
      p.vy += GRAVITY * dt;
      p.vx *= 0.99;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.spin += p.turn * dt;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.spin);
      ctx.globalAlpha = Math.min(1, p.life * 2);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2 + Math.abs(Math.sin(p.spin * 2)) * p.size * 0.4);
      ctx.restore();
    }
    if (pieces.length) requestAnimationFrame(frame);
    else last = 0;
  }

  // Throws count pieces up and out from (x, y), in page pixels.
  function burst(x = window.innerWidth / 2, y = window.innerHeight / 3, count = 80) {
    if (still) return;
    const idle = !pieces.length;
    for (let i = 0; i < count; i++) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const speed = 350 + Math.random() * 450;
      pieces.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        spin: Math.random() * Math.PI,
        turn: (Math.random() - 0.5) * 14,
        size: 7 + Math.random() * 6,
        color: COLORS[i % COLORS.length],
        life: 1.6 + Math.random() * 0.8,
      });
    }
    if (idle) requestAnimationFrame(frame);
  }

  return { burst };
}
