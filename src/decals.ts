import * as THREE from 'three';

export interface DecalItem {
  img: HTMLImageElement;
  /** center position in cloth UV space (u right, v up) */
  u: number;
  v: number;
  /** decal width as a fraction of cloth width */
  scale: number;
  /** degrees */
  rotation: number;
  /** from the sticker sheet: peels off on press, no edit mode needed */
  sticker?: boolean;
  /** transient size multiplier for the slap-down animation */
  pop?: number;
}

const LONG_SIDE = 2048;

/**
 * UV-space surface compositor: an optional full-bleed cloth image plus any
 * number of decal images, drawn into one canvas that the cloth material
 * samples. Because everything lives in UV space, graphics deform with the
 * cloth for free.
 */
export class SurfaceLayer {
  readonly canvas: HTMLCanvasElement;
  /** recreated when the canvas is resized — re-read after setAspect() */
  texture: THREE.CanvasTexture;
  /**
   * Stickers get their own layer so the material can tell vinyl from foil:
   * where this layer has alpha, the holo effect is switched off.
   */
  readonly stickerCanvas: HTMLCanvasElement;
  stickerTexture: THREE.CanvasTexture;
  decals: DecalItem[] = [];
  clothImage: HTMLImageElement | null = null;
  selected: DecalItem | null = null;

  private ctx: CanvasRenderingContext2D;
  private stickerCtx: CanvasRenderingContext2D;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = LONG_SIDE;
    this.canvas.height = LONG_SIDE;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.stickerCanvas = document.createElement('canvas');
    this.stickerCanvas.width = LONG_SIDE;
    this.stickerCanvas.height = LONG_SIDE;
    this.stickerCtx = this.stickerCanvas.getContext('2d')!;
    this.stickerTexture = new THREE.CanvasTexture(this.stickerCanvas);
    this.stickerTexture.colorSpace = THREE.SRGBColorSpace;
    this.redraw();
  }

  /**
   * Resize backing canvas to match the cloth aspect so texels stay square.
   * Returns true when the GPU texture had to be recreated (the old storage
   * cannot change dimensions) — the caller must re-bind `texture`.
   */
  setAspect(aspect: number): boolean {
    const w = aspect >= 1 ? LONG_SIDE : Math.round(LONG_SIDE * aspect);
    const h = aspect >= 1 ? Math.round(LONG_SIDE / aspect) : LONG_SIDE;
    if (this.canvas.width === w && this.canvas.height === h) {
      this.redraw();
      return false;
    }
    this.canvas.width = w;
    this.canvas.height = h;
    this.texture.dispose();
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.stickerCanvas.width = w;
    this.stickerCanvas.height = h;
    this.stickerTexture.dispose();
    this.stickerTexture = new THREE.CanvasTexture(this.stickerCanvas);
    this.stickerTexture.colorSpace = THREE.SRGBColorSpace;
    this.redraw();
    return true;
  }

  addDecal(img: HTMLImageElement): DecalItem {
    const item: DecalItem = { img, u: 0.5, v: 0.5, scale: 0.35, rotation: 0 };
    this.decals.push(item);
    this.selected = item;
    this.redraw();
    return item;
  }

  setClothImage(img: HTMLImageElement | null) {
    this.clothImage = img;
    this.redraw();
  }

  clear() {
    this.decals = [];
    this.clothImage = null;
    this.selected = null;
    this.redraw();
  }

  addSticker(img: HTMLImageElement, u: number, v: number, scale: number, rotation: number): DecalItem {
    const item: DecalItem = { img, u, v, scale, rotation, sticker: true, pop: 1 };
    this.decals.push(item);
    this.redrawStickers();
    return item;
  }

  remove(item: DecalItem) {
    const i = this.decals.indexOf(item);
    if (i < 0) return;
    this.decals.splice(i, 1);
    if (this.selected === item) this.selected = null;
    if (item.sticker) this.redrawStickers();
    else this.redraw();
  }

  /** Topmost sticker under the uv point (round die-cuts, so test the circle). */
  stickerAt(u: number, v: number): DecalItem | null {
    const W = this.canvas.width;
    const H = this.canvas.height;
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      if (!d.sticker) continue;
      const { w } = this.decalPixelSize(d);
      const dx = u * W - d.u * W;
      const dy = (1 - v) * H - (1 - d.v) * H;
      if (dx * dx + dy * dy <= (w * 0.42) ** 2) return d;
    }
    return null;
  }

  /** Topmost decal whose (rotated) rect contains the uv point, else null. */
  hitTest(u: number, v: number): DecalItem | null {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const px = u * W;
    const py = (1 - v) * H;
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      const { w, h } = this.decalPixelSize(d);
      const cx = d.u * W;
      const cy = (1 - d.v) * H;
      const a = (-d.rotation * Math.PI) / 180;
      const dx = px - cx;
      const dy = py - cy;
      const lx = dx * Math.cos(a) - dy * Math.sin(a);
      const ly = dx * Math.sin(a) + dy * Math.cos(a);
      if (Math.abs(lx) <= w / 2 && Math.abs(ly) <= h / 2) return d;
    }
    return null;
  }

  private decalPixelSize(d: DecalItem) {
    const W = this.canvas.width;
    const iw = d.img.naturalWidth || d.img.width || 300;
    const ih = d.img.naturalHeight || d.img.height || 300;
    const w = d.scale * (d.pop ?? 1) * W;
    const h = (w * ih) / iw;
    return { w, h };
  }

  redraw() {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (this.clothImage) {
      ctx.drawImage(this.clothImage, 0, 0, canvas.width, canvas.height);
    }
    for (const d of this.decals) if (!d.sticker) this.drawDecal(ctx, d);
    this.texture.needsUpdate = true;
    this.redrawStickers();
  }

  /** Sticker layer only — cheap enough to run every frame of a slap. */
  redrawStickers() {
    const { stickerCtx: ctx, stickerCanvas: canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const d of this.decals) if (d.sticker) this.drawDecal(ctx, d);
    this.stickerTexture.needsUpdate = true;
  }

  private drawDecal(ctx: CanvasRenderingContext2D, d: DecalItem) {
    const { w, h } = this.decalPixelSize(d);
    ctx.save();
    ctx.translate(d.u * this.canvas.width, (1 - d.v) * this.canvas.height);
    ctx.rotate((d.rotation * Math.PI) / 180);
    ctx.drawImage(d.img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  dispose() {
    this.texture.dispose();
    this.stickerTexture.dispose();
  }
}
