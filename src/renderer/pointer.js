// Input del mouse sull'anteprima grande.
//
// Due modalità:
//   'view'  — trascinare sposta l'inquadratura, la rotellina zooma (nessun
//             evento viene inviato al visore: è sicuro anche mentre il
//             visitatore sta usando l'app)
//   'touch' — trascinare e cliccare diventano tocchi veri sullo schermo del
//             visore, la rotellina diventa scorrimento, il tasto destro "indietro"

/**
 * Coordinate del mouse normalizzate 0..1 sul contenuto del canvas, tenendo
 * conto delle bande nere di "object-fit: contain".
 * @returns {{nx:number, ny:number, inside:boolean}}
 */
export function clientToNormalized(canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const vw = canvas.width || 1;
  const vh = canvas.height || 1;
  const scale = Math.min(rect.width / vw, rect.height / vh);
  const drawnW = vw * scale;
  const drawnH = vh * scale;
  const x = clientX - rect.left - (rect.width - drawnW) / 2;
  const y = clientY - rect.top - (rect.height - drawnH) / 2;
  const nx = x / drawnW;
  const ny = y / drawnH;
  return { nx, ny, inside: nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1 };
}

/** Quanti pixel del canvas corrisponde un pixel sullo schermo del Mac. */
export function canvasPixelsPerClientPixel(canvas) {
  const rect = canvas.getBoundingClientRect();
  const vw = canvas.width || 1;
  const vh = canvas.height || 1;
  const scale = Math.min(rect.width / vw, rect.height / vh);
  return scale > 0 ? 1 / scale : 1;
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
 * @param canvas canvas dell'anteprima
 * @param h.getMode  () => 'view' | 'touch'
 * @param h.onPan    (dxCanvasPx, dyCanvasPx) => void
 * @param h.onZoom   (factor, anchorNx, anchorNy) => void
 * @param h.onTouch  (type, nx, ny, button) => void   // nx,ny sull'inquadratura
 * @param h.onScroll (nx, ny, hscroll, vscroll) => void
 * @param h.onBack   () => void
 * @returns funzione per staccare i listener
 */
export function attachPreviewInput(canvas, h) {
  let dragging = null; // 'pan' | 'touch'
  let activeButton = BUTTON_PRIMARY;
  let lastClient = null;

  const onDown = (ev) => {
    if (ev.button === 2) return; // il destro è "indietro", non un trascinamento
    const { nx, ny, inside } = clientToNormalized(canvas, ev.clientX, ev.clientY);
    if (!inside) return;
    ev.preventDefault();
    canvas.setPointerCapture?.(ev.pointerId);
    lastClient = { x: ev.clientX, y: ev.clientY };

    if (h.getMode() === 'touch') {
      dragging = 'touch';
      activeButton = domButtonToAndroid(ev.button);
      h.onTouch('down', nx, ny, activeButton);
    } else {
      dragging = 'pan';
      canvas.classList.add('grabbing');
    }
  };

  const onMove = (ev) => {
    if (!dragging) return;
    ev.preventDefault();
    if (dragging === 'pan') {
      const dx = ev.clientX - lastClient.x;
      const dy = ev.clientY - lastClient.y;
      lastClient = { x: ev.clientX, y: ev.clientY };
      h.onPan(dx, dy);
      return;
    }
    const { nx, ny } = clientToNormalized(canvas, ev.clientX, ev.clientY);
    h.onTouch('move', nx, ny, activeButton);
  };

  const endDrag = (ev, type) => {
    if (!dragging) return;
    const wasTouch = dragging === 'touch';
    dragging = null;
    canvas.classList.remove('grabbing');
    canvas.releasePointerCapture?.(ev.pointerId);
    if (wasTouch) {
      const { nx, ny } = clientToNormalized(canvas, ev.clientX, ev.clientY);
      h.onTouch(type, nx, ny, activeButton);
    }
  };

  const onUp = (ev) => endDrag(ev, 'up');
  const onCancel = (ev) => endDrag(ev, 'cancel');

  const onContextMenu = (ev) => {
    ev.preventDefault();
    if (h.getMode() === 'touch') h.onBack();
  };

  const onWheel = (ev) => {
    const { nx, ny, inside } = clientToNormalized(canvas, ev.clientX, ev.clientY);
    if (!inside) return;
    ev.preventDefault();
    if (h.getMode() === 'touch') {
      h.onScroll(nx, ny, Math.max(-1, Math.min(1, -ev.deltaX / 120)), Math.max(-1, Math.min(1, -ev.deltaY / 120)));
      return;
    }
    // Trackpad e mouse mandano delta molto diversi: normalizziamo.
    const step = Math.exp(-ev.deltaY / 400);
    h.onZoom(step, nx, ny);
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('contextmenu', onContextMenu);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  return () => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onCancel);
    canvas.removeEventListener('contextmenu', onContextMenu);
    canvas.removeEventListener('wheel', onWheel);
  };
}
