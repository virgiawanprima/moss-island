import { MusicMomo, type MomoFrame, type MomoIntensity } from './musicMomo';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Pisahkan piksel asli menjadi rig tanpa mengganti siluet, koordinat, atau palet. */
export function rigMusicMomo(svg: SVGSVGElement) {
  if (svg.querySelector('.momo-rig')) return;
  const group = (name: string) => {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', `momo-${name}`);
    return g;
  };
  const rig = group('rig');
  const body = group('body');
  const head = group('head');
  const parts = { torso: group('torso'), head, eyes: group('eyes'), mouth: group('mouth'),
    sprout: group('sprout'), leftArm: group('left-arm'), rightArm: group('right-arm'),
    leftFoot: group('left-foot'), rightFoot: group('right-foot') };
  for (const path of [...svg.querySelectorAll(':scope > path')]) {
    for (const d of path.getAttribute('d')?.match(/M[^M]+/g) ?? []) {
      const [x = 0, y = 0] = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).slice(0, 2).map(Number);
      const fill = path.getAttribute('fill');
      const part = y < 105 ? 'sprout' : fill === '#15221A' ? y === 117 ? 'eyes' : 'mouth'
        : y >= 141 ? x < 821 ? 'leftFoot' : 'rightFoot'
        : y >= 133 && x <= 805 ? 'leftArm' : y >= 133 && x >= 833 ? 'rightArm'
        : y < 129 ? 'head' : 'torso';
      const pixel = document.createElementNS(SVG_NS, 'path');
      pixel.setAttribute('d', d);
      pixel.setAttribute('fill', fill ?? '#71BA83');
      parts[part].append(pixel);
    }
    path.remove();
  }
  const headphones = svg.querySelector('#momo-headphone-gear');
  head.append(parts.eyes, parts.mouth, parts.sprout);
  const smile = group('smile');
  const smilePath = document.createElementNS(SVG_NS, 'path');
  smilePath.setAttribute('d', 'M813 123H817V127H813ZM817 127H825V129H817ZM825 123H829V127H825Z');
  smilePath.setAttribute('fill', '#15221A');
  smile.append(smilePath);
  const blush = group('blush');
  const blushPath = document.createElementNS(SVG_NS, 'path');
  blushPath.setAttribute('d', 'M807 123H813V125H807ZM829 123H835V125H829Z');
  blushPath.setAttribute('fill', '#F28B82');
  blush.append(blushPath);
  head.append(smile, blush);
  if (headphones) head.append(headphones);
  const beatHead = group('beat-head');
  const beatFoot = group('beat-foot');
  beatHead.append(head);
  beatFoot.append(parts.leftFoot);
  body.append(parts.torso, beatFoot, parts.rightFoot, beatHead, parts.leftArm, parts.rightArm);
  rig.append(body);
  svg.append(rig);
}

export function createMomoBeatMotion(head: SVGGElement, foot: SVGGElement, setActive: (active: boolean) => void = () => {}) {
  let nextHead = false;
  let animation: Animation | null = null;
  return {
    beat(intensity: MomoIntensity) {
      animation?.cancel();
      const target = nextHead ? head : foot;
      const transform = nextHead
        ? `rotate(${intensity === 'calm' ? 3 : 6}deg)`
        : `translateY(${intensity === 'calm' ? -1 : -2}px) rotate(${intensity === 'calm' ? -4 : -8}deg)`;
      nextHead = !nextHead;
      setActive(true);
      const current = target.animate([{ transform: 'none' }, { transform }, { transform: 'none' }],
        { duration: 230, easing: 'ease-out' });
      animation = current;
      current.onfinish = () => {
        if (animation !== current) return;
        animation = null;
        setActive(false);
      };
    },
    cancel() { animation?.cancel(); animation = null; setActive(false); },
  };
}

export function canAnimateMomoBeat(frame: Readonly<MomoFrame> | null, speakerOutput: boolean,
  animations: readonly Pick<Animation, 'playState' | 'pending'>[]): boolean {
  return !!frame?.active && !frame.reduced && frame.pose === 'rest'
    && frame.eyes === 'open' && frame.playback !== 'ended' && frame.playback !== 'disconnected'
    && (speakerOutput || frame.playback === 'playing')
    && !animations.some(animation => animation.pending || animation.playState === 'running');
}

export function mountMusicMomo(button: HTMLButtonElement, intensity: () => MomoIntensity,
  onVisibility?: (visible: boolean) => void) {
  const svg = button.querySelector('svg');
  if (!svg) throw new Error('Sprite Momo tidak tersedia');
  rigMusicMomo(svg);
  const moving = [...svg.querySelectorAll<SVGGElement>('.momo-body, .momo-head, .momo-left-arm, .momo-right-arm, .momo-left-foot, .momo-right-foot')];
  let frame: Readonly<MomoFrame> | null = null;
  let settling: Animation[] = [];
  const beatMotion = createMomoBeatMotion(svg.querySelector<SVGGElement>('.momo-beat-head')!,
    svg.querySelector<SVGGElement>('.momo-beat-foot')!, active => { button.dataset.beatActive = String(active); });
  const render = (next: Readonly<MomoFrame>) => {
    if (!next.active || next.reduced || next.pose !== 'rest' || next.eyes !== 'open'
      || next.playback === 'ended' || next.playback === 'disconnected') beatMotion.cancel();
    const settle = frame?.pose !== next.pose && ['settle', 'rest'].includes(next.pose) && next.active && !next.reduced;
    const before = settle ? moving.map((part) => getComputedStyle(part).transform) : [];
    for (const animation of settling) animation.cancel();
    settling = [];
    button.dataset.pose = next.pose;
    button.dataset.eyes = next.eyes;
    button.dataset.smile = String(next.smile);
    button.dataset.active = String(next.active);
    button.dataset.reduced = String(next.reduced);
    button.dataset.intensity = next.intensity;
    button.dataset.playback = next.playback;
    if (settle) {
      settling = moving.map((part, i) => part.animate([
        { transform: before[i] ?? 'none' }, { transform: getComputedStyle(part).transform },
      ], { duration: 240, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }));
    }
    frame = next;
  };
  const controller = new MusicMomo(render);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const widget = document.querySelector('#dynamic-island');
  const panel = button.closest('.tab-panel');
  const refresh = () => {
    const visible = !document.hidden && panel?.classList.contains('active') === true
    && widget?.classList.contains('state-expanded') === true
    && !widget.matches('.is-fading-out, .is-morphing, .is-switching-tab')
    && !document.querySelector('#modal-settings.active');
    controller.configure(visible, reduced.matches, intensity());
    onVisibility?.(visible && !reduced.matches);
    if (!visible || reduced.matches) beatMotion.cancel();
  };
  const observer = new MutationObserver(refresh);
  if (widget) observer.observe(widget, { attributes: true, attributeFilter: ['class'] });
  if (panel) observer.observe(panel, { attributes: true, attributeFilter: ['class'] });
  const modal = document.querySelector('#modal-settings');
  if (modal) observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
  const click = () => controller.interact();
  button.addEventListener('click', click);
  document.addEventListener('visibilitychange', refresh);
  reduced.addEventListener('change', refresh);
  const dispose = () => {
    observer.disconnect();
    button.removeEventListener('click', click);
    document.removeEventListener('visibilitychange', refresh);
    reduced.removeEventListener('change', refresh);
    window.removeEventListener('pagehide', hide);
    window.removeEventListener('pageshow', refresh);
    for (const animation of settling) animation.cancel();
    onVisibility?.(false);
    beatMotion.cancel();
    controller.dispose();
  };
  const hide = (event: PageTransitionEvent) => {
    if (event.persisted) { controller.configure(false, reduced.matches, intensity()); onVisibility?.(false); }
    else dispose();
  };
  window.addEventListener('pagehide', hide);
  window.addEventListener('pageshow', refresh);
  refresh();
  const beat = (speakerOutput = false) => {
    const animations = svg.getAnimations({ subtree: true }).filter(animation => {
      const name = 'animationName' in animation ? animation.animationName : '';
      return name !== 'momo-breathe' && name !== 'momo-leaf-follow';
    });
    if (!canAnimateMomoBeat(frame, speakerOutput, animations) || !frame) return;
    beatMotion.beat(frame.intensity);
  };
  return { controller, refresh, dispose, beat };
}
