// Landing page interaktif: animasi Momo, navigasi aktif

// ── Animasi sprite Momo ──────────────────────────────────────────────────────
const SPRITE_PATHS = {
  idle:      Array.from({length: 8}, (_, i) => `../../src/assets/figma_svg/momo_v2/momo_v2_idle_0${i + 1}.svg`),
  walk:      Array.from({length: 8}, (_, i) => `../../src/assets/figma_svg/momo_v2/momo_v2_walk_0${i + 1}.svg`),
  dance:     Array.from({length: 8}, (_, i) => `../../src/assets/figma_svg/momo_v2/momo_v2_dance_0${i + 1}.svg`),
  celebrate: Array.from({length: 8}, (_, i) => `../../src/assets/figma_svg/momo_v2/momo_v2_celebrate_0${i + 1}.svg`),
  drink:     Array.from({length: 8}, (_, i) => `../../src/assets/figma_svg/momo_v2/momo_v2_drink_0${i + 1}.svg`),
  sleep:     Array.from({length: 8}, (_, i) => `../../src/assets/figma_svg/momo_v2/momo_v2_sleep_0${i + 1}.svg`),
  wave:      Array.from({length: 8}, (_, i) => `../../src/assets/figma_svg/momo_v2/momo_v2_wave_0${i + 1}.svg`),
};

const FPS = { idle: 6, walk: 10, dance: 10, celebrate: 10, drink: 8, sleep: 4, wave: 8 };

const sprites = /** @type {NodeListOf<HTMLImageElement>} */ (document.querySelectorAll('.momo-sprite'));
const tabs = /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('.momo-tab'));

let currentAction = 'idle';
let frame = 0;
let timerId = 0;

function showFrame(f) {
  sprites.forEach((s, i) => s.classList.toggle('active', i === f));
}

function startAnim(action) {
  clearInterval(timerId);
  frame = 0;
  currentAction = action;
  const fps = FPS[action] ?? 6;
  const paths = SPRITE_PATHS[action];

  // Swap src untuk seluruh 8 slot
  sprites.forEach((s, i) => {
    s.src = paths[i];
  });

  timerId = setInterval(() => {
    frame = (frame + 1) % 8;
    showFrame(frame);
  }, 1000 / fps);
}

tabs.forEach(btn => {
  btn.addEventListener('click', () => {
    tabs.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    startAnim(btn.dataset.action);
  });
});

// Mulai dengan idle
startAnim('idle');

// ── Momo di hero (animasi walk sederhana) ────────────────────────────────────
const heroMomo = document.getElementById('heroMomo');
if (heroMomo) {
  const heroImg = document.createElement('img');
  heroImg.alt = '';
  heroImg.width = 64;
  heroImg.height = 64;
  heroImg.style.imageRendering = 'pixelated';
  heroImg.style.width = '100%';
  heroMomo.appendChild(heroImg);

  let heroFrame = 0;
  const heroFps = 8;
  setInterval(() => {
    heroFrame = (heroFrame + 1) % 8;
    heroImg.src = SPRITE_PATHS.walk[heroFrame];
  }, 1000 / heroFps);
}

// ── IntersectionObserver: highlight nav ──────────────────────────────────────
const sections = document.querySelectorAll('section[id]');
const navLinks = document.querySelectorAll('.site-header nav a[href^="#"]');

const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const id = entry.target.id;
      navLinks.forEach(a => {
        a.style.color = a.getAttribute('href') === `#${id}` ? 'var(--cream)' : '';
      });
    }
  });
}, { rootMargin: '-50% 0px -50% 0px' });

sections.forEach(s => observer.observe(s));
