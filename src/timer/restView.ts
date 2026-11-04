import type { PlanPhase, TimerStatus } from '../types';

export function getRestPresentation(phase: PlanPhase, remaining: number, total: number, status: TimerStatus) {
  const active = phase.type === 'break' && status !== 'completed';
  const seconds = Number.isFinite(remaining) ? Math.max(0, Math.ceil(remaining)) : 0;
  const fraction = Number.isFinite(total) && total > 0 ? Math.min(1, seconds / total) : 0;
  return {
    active,
    time: `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`,
    fraction,
    tabLabel: active ? 'Istirahat' : 'Focus',
    status: status === 'paused' ? 'Istirahat dijeda'
      : status === 'waiting_next' ? 'Siap mulai istirahat'
      : 'Nikmati jedamu',
  };
}

export function renderRestPhase(root: Document, phase: PlanPhase, remaining: number, total: number, status: TimerStatus) {
  const fraction = Number.isFinite(total) && total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;
  root.getElementById('focus-ring-progress')?.style.setProperty('stroke-dashoffset', String(100 * (1 - fraction)));
  const focusStatus = root.getElementById('focus-clock-status');
  if (focusStatus) focusStatus.textContent = status === 'paused' ? 'Fokus dijeda' : status === 'running' ? 'Satu hal dulu' : status === 'completed' ? 'Rencana selesai' : 'Siap mulai';
  const view = getRestPresentation(phase, remaining, total, status);
  root.querySelector('#panel-focus')?.classList.toggle('is-resting', view.active);
  for (const id of ['rest-countdown', 'rest-reminder']) {
    const element = root.getElementById(id);
    if (element) element.hidden = !view.active;
  }
  const label = root.getElementById('tab-btn-focus');
  if (label) label.textContent = view.tabLabel;
  const time = root.getElementById('rest-time');
  if (time) time.textContent = view.time;
  const state = root.getElementById('rest-status');
  if (state && state.textContent !== view.status) state.textContent = view.status;
  root.getElementById('rest-ring-progress')?.style.setProperty('stroke-dashoffset', String(100 * (1 - view.fraction)));
}
