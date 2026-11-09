// Unified mouse / touch / pen drag.
// Mouse drags start on press. Touch drags start after a long-press (holdMs) so an
// ordinary swipe still scrolls the page; a quick touch without movement is a tap.
// Pass holdMs: 0 for dedicated handles (give them `touch-action: none` in CSS).

const MOVE_SLOP = 8; // px a finger may wander before a pending long-press is abandoned

export function pointerDrag(e, { onStart, onMove, onEnd, onTap, holdMs = 280 } = {}) {
  const isMouse = e.pointerType === 'mouse';
  if (isMouse && e.button !== 0) return;

  const x0 = e.clientX, y0 = e.clientY;
  let active = false;
  let timer  = null;

  // Blocks native scrolling / long-press menus while a touch drag is in progress
  const blockTouch = (ev) => { if (active && ev.cancelable) ev.preventDefault(); };
  const blockMenu  = (ev) => ev.preventDefault();

  function activate() {
    active = true;
    if (!isMouse) navigator.vibrate?.(10);
    onStart?.(e);
  }

  function move(ev) {
    if (ev.pointerId !== e.pointerId) return;
    if (!active) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > MOVE_SLOP) cleanup(); // it's a scroll
      return;
    }
    onMove?.(ev);
  }

  function up(ev) {
    if (ev.pointerId !== e.pointerId) return;
    const wasActive = active;
    cleanup();
    if (wasActive) onEnd?.(ev);
    else if (ev.type === 'pointerup') onTap?.(ev);
  }

  function cleanup() {
    clearTimeout(timer);
    document.removeEventListener('pointermove',   move);
    document.removeEventListener('pointerup',     up);
    document.removeEventListener('pointercancel', up);
    document.removeEventListener('touchmove',     blockTouch);
    document.removeEventListener('contextmenu',   blockMenu);
    active = false;
  }

  document.addEventListener('pointermove',   move);
  document.addEventListener('pointerup',     up);
  document.addEventListener('pointercancel', up);
  document.addEventListener('touchmove',     blockTouch, { passive: false });
  document.addEventListener('contextmenu',   blockMenu);

  if (isMouse || holdMs <= 0) {
    if (isMouse) e.preventDefault();
    activate();
  } else {
    timer = setTimeout(activate, holdMs);
  }
}
