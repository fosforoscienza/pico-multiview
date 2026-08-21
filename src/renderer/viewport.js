// Telecamera virtuale sopra l'immagine ricevuta dal visore.
//
// Cosa può fare davvero: lo stream contiene solo ciò che il visore disegna, cioè
// il campo visivo di chi lo indossa. La telecamera qui sotto permette di
// spostarsi e zoomare DENTRO quel fotogramma — utile perché la cattura è più
// larga di quello che si vede a colpo d'occhio (di norma è stereoscopica, due
// occhi affiancati). Il pulsante "faccia" riporta l'inquadratura esattamente
// sulla porzione che sta guardando il visitatore.
//
// Cosa NON può fare: girarsi a guardare dietro le spalle del visitatore. Quello
// richiederebbe una seconda telecamera dentro l'app VR (vedi README).

// Oltre questo rapporto larghezza/altezza consideriamo la cattura stereoscopica.
// Un PICO 4 rende 2160×2160 per occhio, quindi affiancati fanno esattamente 2:1;
// una cattura piatta invece sta sul 16:9 (1.78) o meno. La soglia sta in mezzo.
export const STEREO_ASPECT_THRESHOLD = 1.9;

/**
 * Porzione di fotogramma che corrisponde a "quello che vede chi indossa il visore".
 * Su una cattura stereoscopica affiancata è l'occhio sinistro; altrimenti tutto.
 */
export function wearerRect(frameWidth, frameHeight) {
  if (!frameWidth || !frameHeight) return null;
  if (frameWidth / frameHeight >= STEREO_ASPECT_THRESHOLD) {
    return { x: 0, y: 0, width: Math.round(frameWidth / 2), height: frameHeight };
  }
  return { x: 0, y: 0, width: frameWidth, height: frameHeight };
}

const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);

export class Viewport {
  constructor({ maxZoom = 5 } = {}) {
    this.maxZoom = maxZoom;
    this.frame = { width: 0, height: 0 };
    this.base = null; // porzione "visuale del visitatore"
    this.zoom = 1;
    this.cx = 0.5; // centro dell'inquadratura, normalizzato sul fotogramma
    this.cy = 0.5;
  }

  get ready() {
    return !!this.base && this.frame.width > 0;
  }

  /** Zoom minimo: quello che fa entrare tutto il fotogramma nell'inquadratura. */
  get minZoom() {
    if (!this.ready) return 1;
    return Math.min(1, this.base.width / this.frame.width, this.base.height / this.frame.height);
  }

  /**
   * Aggiorna la dimensione del fotogramma. Se cambia (primo frame, cambio di
   * qualità, rotazione) ricalcola la porzione del visitatore e ci torna sopra.
   */
  setFrameSize(width, height) {
    if (this.frame.width === width && this.frame.height === height) return false;
    this.frame = { width, height };
    this.base = wearerRect(width, height);
    this.home();
    return true;
  }

  /** Riporta l'inquadratura sulla visuale di chi indossa il visore. */
  home() {
    this.zoom = 1;
    if (this.base && this.frame.width) {
      this.cx = (this.base.x + this.base.width / 2) / this.frame.width;
      this.cy = (this.base.y + this.base.height / 2) / this.frame.height;
    } else {
      this.cx = 0.5;
      this.cy = 0.5;
    }
  }

  /** True se stiamo guardando esattamente quello che vede il visitatore. */
  get isHome() {
    if (!this.ready) return true;
    const hx = (this.base.x + this.base.width / 2) / this.frame.width;
    const hy = (this.base.y + this.base.height / 2) / this.frame.height;
    return Math.abs(this.zoom - 1) < 0.01 && Math.abs(this.cx - hx) < 0.005 && Math.abs(this.cy - hy) < 0.005;
  }

  /** Inquadratura corrente, in pixel del fotogramma, sempre dentro i bordi. */
  rect() {
    if (!this.ready) return { x: 0, y: 0, width: this.frame.width, height: this.frame.height };
    const width = Math.min(this.base.width / this.zoom, this.frame.width);
    const height = Math.min(this.base.height / this.zoom, this.frame.height);
    const x = clamp(this.cx * this.frame.width - width / 2, 0, this.frame.width - width);
    const y = clamp(this.cy * this.frame.height - height / 2, 0, this.frame.height - height);
    return { x, y, width, height };
  }

  /** Sposta l'inquadratura di uno spostamento espresso in pixel del fotogramma. */
  panByFramePixels(dx, dy) {
    if (!this.ready) return;
    this.cx = clamp(this.cx + dx / this.frame.width, 0, 1);
    this.cy = clamp(this.cy + dy / this.frame.height, 0, 1);
    this.#reclamp();
  }

  /**
   * Zoom attorno a un punto dell'inquadratura (0..1), così il dettaglio sotto il
   * puntatore resta fermo.
   */
  zoomBy(factor, anchorX = 0.5, anchorY = 0.5) {
    if (!this.ready) return;
    const before = this.rect();
    const fx = before.x + anchorX * before.width;
    const fy = before.y + anchorY * before.height;

    this.zoom = clamp(this.zoom * factor, this.minZoom, this.maxZoom);

    const after = this.rect();
    // Rimettiamo il punto ancorato sotto lo stesso punto dell'inquadratura.
    this.cx = clamp((fx - (anchorX - 0.5) * after.width) / this.frame.width, 0, 1);
    this.cy = clamp((fy - (anchorY - 0.5) * after.height) / this.frame.height, 0, 1);
    this.#reclamp();
  }

  #reclamp() {
    const r = this.rect();
    this.cx = (r.x + r.width / 2) / this.frame.width;
    this.cy = (r.y + r.height / 2) / this.frame.height;
  }

  /** Da coordinate 0..1 dell'inquadratura a coordinate 0..1 del fotogramma. */
  viewToFrame(nx, ny) {
    const r = this.rect();
    if (!this.frame.width) return { nx, ny };
    return {
      nx: (r.x + nx * r.width) / this.frame.width,
      ny: (r.y + ny * r.height) / this.frame.height,
    };
  }

  /** Quanto è ingrandita l'immagine rispetto alla visuale del visitatore. */
  get zoomLabel() {
    return `${this.zoom.toFixed(this.zoom < 1 ? 2 : 1)}×`;
  }
}
