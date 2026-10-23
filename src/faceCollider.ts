import type { FaceFrame } from './faceTracker.ts';

/**
 * The face as something for the cloth to lie on: a height field over the
 * bed (world z, toward the camera) covering the cloth's area, rebuilt from
 * the face landmarks each video frame.
 *
 * A rounded head shell gives the outline under the sheet; the landmarks add
 * the face's own relief on top — measured from the face oval, so features
 * blend into the shell at the edge of the face. The face is centred on the
 * sheet and scaled to a constant width, so it doesn't matter where you sit
 * in the camera frame or how far away you are.
 */

// world units: the cloth is 2 wide, 3 tall, centred on the origin
const GRID_X0 = -1.3;
const GRID_X1 = 1.3;
const GRID_Y0 = -1.8;
const GRID_Y1 = 1.8;
const NX = 104;
const NY = 144;

/** face width (cheek to cheek) on the sheet — small next to it, like a sheet over a person */
const FACE_W = 0.75;
/** where the face sits on the sheet: just above centre, with cloth to spare all round */
const FACE_Y = 0.15;
/** how high the head shell rises off the bed: low, so the face's own features carry the shape */
const HEAD_H = 0.2;
/** head outline relative to the face's half-width / half-height */
const HEAD_PAD = 1.3;
/** each landmark fills a disc this wide, so the gaps between them close */
const SPLAT_R = 0.05;
/** blur passes: enough that the head's sides slope, so the sheet slides off them */
const BLUR_PASSES = 4;
/** share of the previous frame kept, to steady landmark jitter */
const SMOOTHING = 0.4;
/** frames for a newly found face to rise to full height, so it lifts the sheet instead of yanking it */
const RISE_FRAMES = 30;

// face oval, in MediaPipe's 478-point mesh, plus the four extremes
const OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400,
  377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
const RIGHT_EDGE = 234;
const LEFT_EDGE = 454;
const TOP = 10;
const CHIN = 152;

export class FaceCollider {
  private h = new Float32Array(NX * NY);
  private next = new Float32Array(NX * NY);
  private tmp = new Float32Array(NX * NY);
  private hasFace = false;
  private rise = 0;

  /** Height of the bed + head under (x, y); 0 is the bed. */
  heightAt(x: number, y: number): number {
    if (!this.hasFace) return 0;
    const gx = ((x - GRID_X0) / (GRID_X1 - GRID_X0)) * (NX - 1);
    const gy = ((y - GRID_Y0) / (GRID_Y1 - GRID_Y0)) * (NY - 1);
    if (gx < 0 || gy < 0 || gx >= NX - 1 || gy >= NY - 1) return 0;
    const ix = Math.floor(gx), iy = Math.floor(gy);
    const fx = gx - ix, fy = gy - iy;
    const i = iy * NX + ix;
    const h = this.h;
    const a = h[i] * (1 - fx) + h[i + 1] * fx;
    const b = h[i + NX] * (1 - fx) + h[i + NX + 1] * fx;
    return a * (1 - fy) + b * fy;
  }

  clear() {
    this.h.fill(0);
    this.hasFace = false;
    this.rise = 0;
  }

  update({ landmarks: lm, aspect }: FaceFrame) {
    // x and y in the same units (image widths); z is already roughly in x's units
    const X = (i: number) => lm[i].x;
    const Y = (i: number) => lm[i].y / aspect;
    const Z = (i: number) => lm[i].z;

    // cheek to cheek in 3D, so turning the head doesn't shrink the face
    const width = Math.hypot(X(LEFT_EDGE) - X(RIGHT_EDGE), Z(LEFT_EDGE) - Z(RIGHT_EDGE));
    if (width < 1e-4) return;
    const k = FACE_W / width;
    const cx = (X(LEFT_EDGE) + X(RIGHT_EDGE)) / 2;
    const cy = (Y(TOP) + Y(CHIN)) / 2;
    let zRef = 0;
    for (const i of OVAL) zRef += Z(i);
    zRef /= OVAL.length;

    // head shell: an ellipsoid a little wider and taller than the face
    const ax = (FACE_W / 2) * HEAD_PAD;
    const ay = (Math.abs(Y(CHIN) - Y(TOP)) * k / 2) * HEAD_PAD;
    const shell = (x: number, y: number) => {
      const r = (x / ax) ** 2 + ((y - FACE_Y) / ay) ** 2;
      return r < 1 ? HEAD_H * Math.sqrt(1 - r) : 0;
    };

    const out = this.next;
    const sx = (GRID_X1 - GRID_X0) / (NX - 1);
    const sy = (GRID_Y1 - GRID_Y0) / (NY - 1);
    for (let j = 0; j < NY; j++) {
      const y = GRID_Y0 + j * sy;
      for (let i = 0; i < NX; i++) out[j * NX + i] = shell(GRID_X0 + i * sx, y);
    }

    // features on top of the shell; mirrored, so the sheet moves like a mirror
    const rx = Math.ceil(SPLAT_R / sx);
    const ry = Math.ceil(SPLAT_R / sy);
    for (let n = 0; n < lm.length; n++) {
      const wx = -(X(n) - cx) * k;
      const wy = -(Y(n) - cy) * k + FACE_Y;
      const relief = Math.max(0, (zRef - Z(n)) * k);
      const h = shell(wx, wy) + relief;
      const gi = Math.round((wx - GRID_X0) / sx);
      const gj = Math.round((wy - GRID_Y0) / sy);
      for (let dj = -ry; dj <= ry; dj++) {
        const j = gj + dj;
        if (j < 0 || j >= NY) continue;
        for (let di = -rx; di <= rx; di++) {
          const i = gi + di;
          if (i < 0 || i >= NX) continue;
          if ((di * sx) ** 2 + (dj * sy) ** 2 > SPLAT_R ** 2) continue;
          const c = j * NX + i;
          if (h > out[c]) out[c] = h;
        }
      }
    }

    // soften the splats into a surface, then ease toward it from last frame
    for (let b = 0; b < BLUR_PASSES; b++) this.blur(out);
    this.rise = Math.min(1, this.rise + 1 / RISE_FRAMES);
    const lift = this.rise * this.rise * (3 - 2 * this.rise); // smoothstep
    const keep = this.hasFace ? SMOOTHING : 0;
    for (let c = 0; c < out.length; c++) this.h[c] = this.h[c] * keep + out[c] * lift * (1 - keep);
    this.hasFace = true;
  }

  private blur(a: Float32Array) {
    const t = this.tmp;
    for (let j = 0; j < NY; j++) {
      for (let i = 0; i < NX; i++) {
        let s = 0, n = 0;
        for (let dj = -1; dj <= 1; dj++) {
          const jj = j + dj;
          if (jj < 0 || jj >= NY) continue;
          for (let di = -1; di <= 1; di++) {
            const ii = i + di;
            if (ii < 0 || ii >= NX) continue;
            s += a[jj * NX + ii];
            n++;
          }
        }
        t[j * NX + i] = s / n;
      }
    }
    a.set(t);
  }
}
