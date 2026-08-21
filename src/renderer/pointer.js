// Traduce gli eventi del mouse sul canvas in coordinate normalizzate (0..1)
// dell'immagine del visore, tenendo conto delle bande nere di "object-fit: contain".

/**
 * @returns {{nx:number, ny:number, inside:boolean}}
 */
export function clientToNormalized(canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const vw = canvas.width || 1;
  const vh = canvas.height || 1;
  const scale = Math.min(rect.width / vw, rect.height / vh);
  const drawnW = vw * scale;
  const drawnH = vh * scale;
  const offsetX = (rect.width - drawnW) / 2;
  const offsetY = (rect.height - drawnH) / 2;
  const x = clientX - rect.left - offsetX;
  const y = clientY - rect.top - offsetY;
  const nx = x / drawnW;
  const ny = y / drawnH;
  return { nx, ny, inside: nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1 };
}

const BUTTON_PRIMARY = 1;
const BUTTON_SECONDARY = 2;
const BUTTON_TERTIARY = 4;

function domButtonToAndroid(button) {
  if (button === 2) return BUTTON_SECONDARY;
  if (button === 1) return BUTTON_TERTIARY;
  return BUTTON_PRIMARY;
}

/**
 * Collega il mouse a un canvas.
 * @param canvas elemento canvas
 * @param opts.serial seriale del visore
 * @param opts.isEnabled () => boolean — il puntatore è armato?
 * @param opts.onBack () => void — click destro
 * @returns funzione per staccare i listener
 */
export function attachPointer(canvas, { serial, isEnabled, onBack = null }) {
  let dragging = false;
  let activeButton = BUTTON_PRIMARY;

  const send = (type, ev, button = activeButton) => {
    const { nx, ny } = clientToNormalized(canvas, ev.clientX, ev.clientY);
    window.pico.pointer({ serial, type, nx, ny, button });
  };

  const onDown = (ev) => {
    if (!isEnabled()) return;
    if (ev.button === 2) return; // il destro fa "indietro", non un tocco
    const { inside } = clientToNormalized(canvas, ev.clientX, ev.clientY);
    if (!inside) return;
    ev.preventDefault();
    canvas.setPointerCapture?.(ev.pointerId);
    activeButton = domButtonToAndroid(ev.button);
    dragging = true;
    send('down', ev);
  };

  const onMove = (ev) => {
    if (!dragging || !isEnabled()) return;
    ev.preventDefault();
    send('move', ev);
  };

  const onUp = (ev) => {
    if (!dragging) return;
    dragging = false;
    ev.preventDefault();
    canvas.releasePointerCapture?.(ev.pointerId);
    send('up', ev);
  };

  const onCancel = (ev) => {
    if (!dragging) return;
    dragging = false;
    send('cancel', ev);
  };

  const onContextMenu = (ev) => {
    ev.preventDefault();
    if (isEnabled() && onBack) onBack();
  };

  const onWheel = (ev) => {
    if (!isEnabled()) return;
    const { nx, ny, inside } = clientToNormalized(canvas, ev.clientX, ev.clientY);
    if (!inside) return;
    ev.preventDefault();
    window.pico.scroll({
      serial,
      nx,
      ny,
      hscroll: Math.max(-1, Math.min(1, -ev.deltaX / 120)),
      vscroll: Math.max(-1, Math.min(1, -ev.deltaY / 120)),
    });
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('pointerleave', onCancel);
  canvas.addEventListener('contextmenu', onContextMenu);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  return () => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onCancel);
    canvas.removeEventListener('pointerleave', onCancel);
    canvas.removeEventListener('contextmenu', onContextMenu);
    canvas.removeEventListener('wheel', onWheel);
  };
}
