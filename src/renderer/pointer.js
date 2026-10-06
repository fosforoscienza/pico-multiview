// Input del mouse (e delle dita, su iPad) sull'anteprima grande.
//
// Serve solo a guardare: trascinare sposta l'inquadratura, la rotellina e la
// pinch a due dita zoomano. Niente arriva al visore — è sicuro anche mentre il
// visitatore lo sta usando.

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

/**
 * @param canvas canvas dell'anteprima
 * @param h.onPan    (dxClientPx, dyClientPx) => void
 * @param h.onZoom   (factor, anchorNx, anchorNy) => void
 * @returns funzione per staccare i listener
 */
export function attachPreviewInput(canvas, h) {
  let dragging = false;
  let lastClient = null;
  let pinch = null; // { distance, midX, midY }

  /** Puntatori attivi: serve per riconoscere la pinch a due dita su iPad. */
  const pointers = new Map();

  const capture = (pointerId) => {
    try {
      canvas.setPointerCapture?.(pointerId);
    } catch {
      /* il puntatore non è più attivo: pazienza, il gesto funziona lo stesso */
    }
  };

  const release = (pointerId) => {
    try {
      canvas.releasePointerCapture?.(pointerId);
    } catch {
      /* già rilasciato */
    }
  };

  const pinchState = () => {
    const [a, b] = [...pointers.values()];
    return {
      distance: Math.hypot(a.x - b.x, a.y - b.y),
      midX: (a.x + b.x) / 2,
      midY: (a.y + b.y) / 2,
    };
  };

  const onDown = (ev) => {
    if (ev.button === 2) return;
    const { inside } = clientToNormalized(canvas, ev.clientX, ev.clientY);
    if (!inside) return;
    ev.preventDefault();
    // Prima registriamo il dito, poi proviamo a catturarlo: se la cattura
    // fallisce (capita con puntatori già rilasciati) il gesto deve comunque
    // partire, non morire con un'eccezione a metà.
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    capture(ev.pointerId);

    // Secondo dito: si passa da trascinamento a pinch.
    if (pointers.size === 2) {
      dragging = false;
      canvas.classList.remove('grabbing');
      pinch = pinchState();
      return;
    }
    if (pointers.size > 1) return; // le dita in più non aprono un nuovo gesto

    lastClient = { x: ev.clientX, y: ev.clientY };
    dragging = true;
    canvas.classList.add('grabbing');
  };

  const onMove = (ev) => {
    if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

    if (pinch && pointers.size === 2) {
      ev.preventDefault();
      const next = pinchState();
      if (pinch.distance > 0 && next.distance > 0) {
        const { nx, ny } = clientToNormalized(canvas, next.midX, next.midY);
        h.onZoom(next.distance / pinch.distance, nx, ny);
      }
      // Muovendo le due dita insieme si sposta anche l'inquadratura.
      h.onPan(next.midX - pinch.midX, next.midY - pinch.midY);
      pinch = next;
      return;
    }

    if (!dragging) return;
    ev.preventDefault();
    const dx = ev.clientX - lastClient.x;
    const dy = ev.clientY - lastClient.y;
    lastClient = { x: ev.clientX, y: ev.clientY };
    h.onPan(dx, dy);
  };

  const endDrag = (ev) => {
    pointers.delete(ev.pointerId);
    release(ev.pointerId);

    if (pinch) {
      // Finita la pinch non si torna a trascinare con il dito rimasto:
      // aspettiamo che si stacchino tutte.
      if (pointers.size < 2) pinch = null;
      return;
    }
    dragging = false;
    canvas.classList.remove('grabbing');
  };

  const onContextMenu = (ev) => ev.preventDefault();

  const onWheel = (ev) => {
    const { nx, ny, inside } = clientToNormalized(canvas, ev.clientX, ev.clientY);
    if (!inside) return;
    ev.preventDefault();
    // Trackpad e mouse mandano delta molto diversi: normalizziamo.
    const step = Math.exp(-ev.deltaY / 400);
    h.onZoom(step, nx, ny);
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('contextmenu', onContextMenu);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  return () => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', endDrag);
    canvas.removeEventListener('pointercancel', endDrag);
    canvas.removeEventListener('contextmenu', onContextMenu);
    canvas.removeEventListener('wheel', onWheel);
  };
}
