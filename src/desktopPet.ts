import type { WorkArea } from './edgeDock';

export const FIGMA_IDLE_SOURCES = [
  new URL('./assets/figma_svg/momo_v2/momo_v2_idle_01.svg', import.meta.url).href,
  new URL('./assets/figma_svg/momo_v2/momo_v2_idle_02.svg', import.meta.url).href,
  new URL('./assets/figma_svg/momo_v2/momo_v2_idle_03.svg', import.meta.url).href,
  new URL('./assets/figma_svg/momo_v2/momo_v2_idle_04.svg', import.meta.url).href,
  new URL('./assets/figma_svg/momo_v2/momo_v2_idle_05.svg', import.meta.url).href,
  new URL('./assets/figma_svg/momo_v2/momo_v2_idle_06.svg', import.meta.url).href,
  new URL('./assets/figma_svg/momo_v2/momo_v2_idle_07.svg', import.meta.url).href,
  new URL('./assets/figma_svg/momo_v2/momo_v2_idle_08.svg', import.meta.url).href,
];

export function figmaIdleFrameAt(time: number): number {
  const phase = Math.max(0, time) % 2675;
  return phase < 1800 ? 0 : Math.min(7, 1 + Math.floor((phase - 1800) / 125));
}

export interface PetContext {
  x: number;
  y: number;
  cursorX: number;
  cursorY: number;
  width: number;
  height: number;
  scale: number;
  pressed: boolean;
  visible: boolean;
  area: WorkArea;
}

export interface PetMotion {
  vx: number;
  vy: number;
  walking: boolean;
  facing: 'left' | 'right';
}

export const restingPet = (): PetMotion => ({ vx: 0, vy: 0, walking: false, facing: 'right' });

/** Semua koordinat native berupa piksel fisik; kecepatan dinyatakan dalam DIP/detik. */
export function stepDesktopPet(context: PetContext, motion: PetMotion, elapsed: number, time: number) {
  const { x, y, area } = context;
  const scale = context.scale > 0 ? context.scale : 1;
  const dt = Math.max(0, Math.min(elapsed, 0.08));
  const left = area.x + context.width / 2;
  const right = Math.max(left, area.x + area.width - context.width / 2);
  const top = area.y + context.height / 2;
  const bottom = Math.max(top, area.y + area.height - context.height / 2);
  if (context.pressed || !context.visible) return { x, y, motion: restingPet() };

  const dx = x - context.cursorX;
  const dy = y - context.cursorY;
  const distance = Math.hypot(dx, dy);
  const nearby = distance < 140 * scale;
  let tx = 0;
  let ty = 0;
  if (nearby) {
    // Pilih arah yang tetap bisa bergerak menjauh di sudut layar.
    let best = -Infinity;
    for (let i = 0; i < 32; i++) {
      const angle = i * Math.PI / 16;
      const ux = Math.cos(angle);
      const uy = Math.sin(angle);
      const nx = Math.max(left, Math.min(right, x + ux * 24 * scale));
      const ny = Math.max(top, Math.min(bottom, y + uy * 24 * scale));
      const continuity = (ux * motion.vx + uy * motion.vy) / (22 * scale);
      const gain = Math.hypot(nx - context.cursorX, ny - context.cursorY) - distance + continuity * 0.4;
      if (gain > best) { best = gain; tx = ux * 22 * scale; ty = uy * 22 * scale; }
    }
  } else if (time % 14000 >= 9000 && time % 14000 < 12000) {
    const direction = Math.floor(time / 14000) % 2 === 0 ? 1 : -1;
    tx = direction * 9 * scale;
    if (x + tx < left || x + tx > right) tx *= -1;
  }
  const ease = 1 - Math.exp(-dt * 9);
  const vx = motion.vx + (tx - motion.vx) * ease;
  const vy = motion.vy + (ty - motion.vy) * ease;
  const nx = Math.max(left, Math.min(right, x + vx * dt));
  const ny = Math.max(top, Math.min(bottom, y + vy * dt));
  const walking = Math.hypot(nx - x, ny - y) > 0.01 * scale;
  return { x: nx, y: ny, motion: { vx, vy, walking,
    facing: Math.abs(vx) > scale ? vx < 0 ? 'left' as const : 'right' as const : motion.facing } };
}

export function petGaitAt(distance: number) {
  const phase = ((distance / 14) % 1 + 1) % 1;
  const foot = (offset: number) => {
    const t = (phase + offset) % 1;
    if (t < 0.5) return { x: 4 - 16 * t, y: 0 };
    const swing = (t - 0.5) * 2;
    return { x: -4 + 8 * swing, y: -4 * Math.sin(Math.PI * swing) };
  };
  return { left: foot(0), right: foot(0.5),
    bob: -0.6 + 0.6 * Math.cos(phase * Math.PI * 4),
    arm: Math.sin(phase * Math.PI * 2) * 11,
    leaf: Math.sin(phase * Math.PI * 2 - 0.6) * 5 };
}

export function rigDesktopPet(svg: SVGSVGElement) {
  if (svg.querySelector('.pet-front')) return;
  svg.replaceChildren();
  const group = (name: string) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    node.classList.add(`pet-${name}`);
    return node;
  };
  const path = (parent: SVGElement, d: string, fill: string) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    node.setAttribute('d', d); node.setAttribute('fill', fill); parent.append(node);
  };
  const front = group('front');
  for (const [index, source] of FIGMA_IDLE_SOURCES.entries()) {
    const image = document.createElementNS('http://www.w3.org/2000/svg', 'image');
    image.setAttribute('href', source);
    image.setAttribute('width', '64'); image.setAttribute('height', '64');
    image.dataset.frame = String(index);
    image.style.display = index === 0 ? 'block' : 'none';
    front.append(image);
  }
  const profile = group('profile'); const body = group('body');
  const head = group('head'); const sprout = group('sprout');
  const left = group('left-foot'); const right = group('right-foot');
  const leftArm = group('left-arm'); const rightArm = group('right-arm');
  // Varian samping diminta pengguna; grid dan empat warna mengikuti atlas Figma.
  path(leftArm, 'M24 48H28V56H24Z', '#71BA83');
  path(left, 'M28 56H32V60H36V64H24V60H28Z', '#71BA83');
  path(right, 'M36 56H40V60H44V64H32V60H36Z', '#71BA83');
  body.append(leftArm, left, right);
  path(body, 'M28 44H40V48H44V52H40V56H28V52H24V48H28Z', '#71BA83');
  path(body, 'M32 48H40V52H32Z', '#C4F59B');
  path(head, 'M24 20H40V24H48V40H44V44H40V48H28V44H24V40H20V24H24Z', '#71BA83');
  path(head, 'M28 24H40V28H44V40H40V44H28V40H24V28H28Z', '#C4F59B');
  path(head, 'M40 32H44V36H40ZM40 40H44V44H40Z', '#15221A');
  path(sprout, 'M24 4H32V12H36V16H24V12H20V8H24Z', '#71BA83');
  path(sprout, 'M40 8H48V12H44V16H36V12H40Z', '#C4F59B');
  path(sprout, 'M28 16H36V20H28Z', '#AF8055');
  path(rightArm, 'M36 48H40V56H36Z', '#71BA83');
  head.append(sprout); body.append(head, rightArm); profile.append(body);
  svg.append(front, profile);
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('width', '64'); svg.setAttribute('height', '64');
}

export function mountPetGait(svg: SVGSVGElement) {
  const part = (name: string) => svg.querySelector<SVGGElement>(`.pet-profile .pet-${name}`)!;
  const left = part('left-foot'); const right = part('right-foot');
  const body = part('body'); const head = part('head'); const sprout = part('sprout');
  const leftArm = part('left-arm'); const rightArm = part('right-arm');
  const frames = [...svg.querySelectorAll<SVGImageElement>('.pet-front image')];
  let lastIdle = -1; let lastWalk = -1;
  return (distance: number, time: number, walking: boolean, reduced = false) => {
    const idle = reduced ? 0 : figmaIdleFrameAt(time);
    if (idle !== lastIdle) {
      for (const [index, image] of frames.entries()) image.style.display = index === idle ? 'block' : 'none';
      lastIdle = idle;
    }
    if (!walking) { lastWalk = -1; return; }
    const frame = Math.floor(distance / 14 * 8) % 8;
    if (frame === lastWalk) return;
    lastWalk = frame;
    const gait = petGaitAt(frame * 14 / 8);
    const pixel = (value: number) => Math.round(value / 2) * 2;
    const bob = pixel(gait.bob);
    left.style.transform = `translate(${pixel(gait.left.x)}px, ${pixel(gait.left.y) - bob}px)`;
    right.style.transform = `translate(${pixel(gait.right.x)}px, ${pixel(gait.right.y) - bob}px)`;
    body.style.transform = `translateY(${bob}px)`;
    head.style.transform = 'none';
    leftArm.style.transform = `translateX(${pixel(-gait.arm / 5)}px)`;
    rightArm.style.transform = `translateX(${pixel(gait.arm / 5)}px)`;
    sprout.style.transform = `translateX(${pixel(gait.leaf / 3)}px)`;
  };
}
