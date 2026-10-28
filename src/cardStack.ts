import * as THREE from 'three';

/**
 * Many copies of the card arranged as one sculpture: thin plates, each
 * turned a little further than the last, so the stack reads as a single
 * twisting form and its edges catch the light in rhythm. Every arrangement
 * is a rule, not a scatter — plate i's place follows from i alone.
 */
export const STACK_SHAPES = ['Single', 'Twist', 'Wave', 'Fan', 'Bloom', 'Möbius', 'Ring', 'Flip', 'Helix', 'Vortex'] as const;
export type StackShape = (typeof STACK_SHAPES)[number];
/** the panel's choices: a shape, or Cycle through them all */
export const STACK_OPTIONS = [...STACK_SHAPES, 'Cycle'] as const;
/** Cycle's running order: out of one card and back into it */
const CYCLE: StackShape[] = ['Single', 'Twist', 'Wave', 'Möbius', 'Flip', 'Helix', 'Vortex', 'Bloom', 'Fan'];
/** seconds Cycle holds each formation, and how long the move between takes */
const HOLD = 3.2;
const MOVE = 2.6;
/** most plates drawn */
export const MAX_PLATES = 160;

export interface StackParams {
  /** 'One' shows just the card, whatever the shape; 'Stack' the formation */
  cards?: string;
  shape: string;
  /** how many plates */
  count: number;
  /** how far the form turns end to end, 0..1 of each shape's full turn */
  twist: number;
  /** gap between plates, in plate thicknesses */
  spacing: number;
  /** how fast the form turns through itself; 0 holds it still */
  flow: number;
}

const m = new THREE.Matrix4();
const q = new THREE.Quaternion();
const s = new THREE.Vector3();
const p = new THREE.Vector3();
const e = new THREE.Euler();
const basis = new THREE.Matrix4();

/**
 * Plate i of n's transform, card centred at the origin facing +z.
 * w, h: card size; t: thickness; phase: the flow, in turns.
 */
export function plateMatrix(
  shape: StackShape,
  i: number,
  n: number,
  w: number,
  h: number,
  t: number,
  { twist, spacing }: StackParams,
  phase: number,
  /** opens the formation out (radius, rise) to clear collisions; 1 = as designed */
  spread = 1,
  out = new THREE.Matrix4(),
) {
  // 0..1 along the form
  const f = n > 1 ? i / (n - 1) : 0;
  // round a closed loop: the last plate stops a step short of the first
  const loop = i / Math.max(1, n);
  // never closer than a thickness and a bit: parallel plates can't touch
  const gap = t * (1 + Math.max(0.3, spacing));
  switch (shape) {
    case 'Twist': {
      // a tower of plates going back from the face, each turned about the
      // stack's axis: front plate square to the viewer, the rest winding away
      const turn = twist * Math.PI * (1 + 0.25 * Math.sin(phase * Math.PI * 2));
      e.set(0, 0, -f * turn);
      q.setFromEuler(e);
      p.set(0, 0, -i * gap);
      s.setScalar(1);
      return out.compose(p, q, s);
    }
    case 'Fan': {
      // pivoted on the lower-left corner like a hand of cards, opening out
      const spread = twist * Math.PI * 0.75 * (0.85 + 0.15 * Math.sin(phase * Math.PI * 2));
      const a = (f - 0.5) * spread;
      q.setFromAxisAngle(Z, -a);
      // rotate about the corner: corner -> origin, turn, back
      const cx = -w / 2, cy = -h / 2;
      p.set(-cx, -cy, 0).applyQuaternion(q).add(new THREE.Vector3(cx, cy, -i * gap));
      s.setScalar(1);
      return out.compose(p, q, s);
    }
    case 'Ring':
    case 'Möbius': {
      // slats round a ring, each standing in the ring's cross-section (face
      // along the way round), so neighbours fan apart and never meet. In a
      // Möbius each slat turns within that plane as the ring goes round —
      // an odd number of half turns per lap closes the band on itself
      const scale = 0.32;
      const R = (h * scale * 0.5 + w * 0.42) * spread;
      const phi = loop * TAU + phase * TAU;
      const halfTurns = shape === 'Ring' ? 0 : twist < 0.75 ? 1 : 3;
      ringSlat(phi, (phi / 2) * halfTurns, R, q, p);
      s.setScalar(scale);
      return out.compose(p, q, s);
    }
    case 'Helix': {
      // a spiral stair: plates rise up the y axis, each turned about it
      const scale = 0.55;
      const turn = twist * Math.PI * 2;
      q.setFromAxisAngle(Y, f * turn + phase * Math.PI * 2);
      // lying almost flat, stepping up
      const lie = new THREE.Quaternion().setFromAxisAngle(X, -Math.PI / 2 + 0.35);
      q.multiply(lie);
      const rise = Math.max(gap * 2.2, (h * 1.2) / Math.max(1, n)) * spread;
      p.set(0, (i - (n - 1) / 2) * rise, 0);
      s.setScalar(scale);
      return out.compose(p, q, s);
    }
    case 'Wave': {
      // the Twist tower with a ripple running front to back through it:
      // each plate swings and slides a beat after the one in front. Only
      // within its own plane, so the plates stay parallel and never touch
      const beat = TAU * (phase * 3 - f * 1.5);
      q.setFromAxisAngle(Z, -f * twist * Math.PI * 0.5 + 0.35 * Math.sin(beat));
      p.set(0.15 * Math.sin(beat + 2), 0.2 * Math.sin(beat + 0.5), -i * gap);
      s.setScalar(1);
      return out.compose(p, q, s);
    }
    case 'Bloom': {
      // a rosette: every plate pivots on one corner, spread round a full
      // turn, opening and closing like an aperture
      const scale = 0.5;
      const open = 0.65 + 0.35 * Math.sin(TAU * phase * 2);
      q.setFromAxisAngle(Z, -f * TAU * (0.6 + 0.4 * twist) * open);
      // corner at the origin, the plate swinging about it
      p.set((w / 2) * scale, (h / 2) * scale, 0).applyQuaternion(q);
      p.z = -i * gap * scale;
      s.setScalar(scale);
      return out.compose(p, q, s);
    }
    case 'Flip': {
      // the ring of slats with waves running round it: each slat swings
      // from lying along the radius to standing up as a wave passes, all
      // within its own cross-section, so they never touch
      const scale = 0.32;
      const R = (h * scale * 0.5 + w * 0.42) * spread;
      const phi = loop * TAU;
      const waves = 1 + Math.round(twist * 4);
      ringSlat(phi, (Math.PI / 2) * (0.5 + 0.5 * Math.sin(waves * phi - TAU * phase * 3)), R, q, p);
      s.setScalar(scale);
      return out.compose(p, q, s);
    }
    case 'Vortex': {
      // fins on a spiral round a vertical axis, each standing out along
      // its radius, the whole column winding round
      const scale = 0.4;
      const r0 = 0.25 * spread;
      const a = f * TAU * (0.5 + twist * 1.5) + phase * TAU;
      // the fin's width runs out along the radius, its face round the turn
      q.setFromAxisAngle(Y, a - Math.PI / 2);
      const r = r0 + (w * scale) / 2;
      p.set(Math.sin(a) * r, (f - 0.5) * h * 0.9, Math.cos(a) * r);
      s.setScalar(scale);
      return out.compose(p, q, s);
    }
    default:
      return out.identity();
  }
}

const TAU = Math.PI * 2;

/**
 * A slat at angle phi round a ring of radius R, standing in the ring's
 * cross-section: its long side turned chi from the radius toward the
 * ring's axis, its face pointing the way round.
 */
function ringSlat(phi: number, chi: number, R: number, q: THREE.Quaternion, p: THREE.Vector3) {
  const radial = new THREE.Vector3(Math.cos(phi), Math.sin(phi), 0);
  const long = radial.clone().multiplyScalar(Math.cos(chi)).addScaledVector(Z, Math.sin(chi));
  const across = radial.clone().multiplyScalar(-Math.sin(chi)).addScaledVector(Z, Math.cos(chi));
  basis.makeBasis(across, long, new THREE.Vector3().crossVectors(across, long));
  q.setFromRotationMatrix(basis);
  p.copy(radial).multiplyScalar(R);
}
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

/** a pulled-out plate's spot, in the stack's space; pushed further out when the formation is deeper */
export const FRONT = new THREE.Vector3(0, 0, 1.4);
const FACE_ON = new THREE.Quaternion();
const ONE = new THREE.Vector3(1, 1, 1);
/** seconds to pull a plate out, or put it back */
const PULL = 1.1;

const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

const pa = new THREE.Vector3(), pb = new THREE.Vector3();
const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
const sa = new THREE.Vector3(), sb = new THREE.Vector3();
const ma = new THREE.Matrix4(), mb = new THREE.Matrix4();

// ---- collisions --------------------------------------------------------

/** a plate as an oriented box: centre, unit axes, half extents */
interface Box {
  c: THREE.Vector3;
  a: [THREE.Vector3, THREE.Vector3, THREE.Vector3];
  e: [number, number, number];
  /** bounding radius, for a quick reject */
  r: number;
}

function boxOf(m: THREE.Matrix4, w: number, h: number, t: number, pad: number): Box {
  const c = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  m.decompose(c, q, sc);
  const k = sc.x;
  const e: [number, number, number] = [(w * k) / 2 + pad, (h * k) / 2 + pad, (t * k) / 2 + pad];
  return {
    c,
    a: [X.clone().applyQuaternion(q), Y.clone().applyQuaternion(q), Z.clone().applyQuaternion(q)],
    e,
    r: Math.hypot(e[0], e[1], e[2]),
  };
}

/** Separating-axis test for two oriented boxes. */
function overlaps(A: Box, B: Box) {
  const d = new THREE.Vector3().subVectors(B.c, A.c);
  if (d.length() > A.r + B.r) return false;
  const R: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const AR: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      R[i][j] = A.a[i].dot(B.a[j]);
      AR[i][j] = Math.abs(R[i][j]) + 1e-6;
    }
  }
  const T = [d.dot(A.a[0]), d.dot(A.a[1]), d.dot(A.a[2])];
  for (let i = 0; i < 3; i++) {
    const rb = B.e[0] * AR[i][0] + B.e[1] * AR[i][1] + B.e[2] * AR[i][2];
    if (Math.abs(T[i]) > A.e[i] + rb) return false;
  }
  for (let j = 0; j < 3; j++) {
    const ra = A.e[0] * AR[0][j] + A.e[1] * AR[1][j] + A.e[2] * AR[2][j];
    if (Math.abs(T[0] * R[0][j] + T[1] * R[1][j] + T[2] * R[2][j]) > ra + B.e[j]) return false;
  }
  for (let i = 0; i < 3; i++) {
    const i1 = (i + 1) % 3, i2 = (i + 2) % 3;
    for (let j = 0; j < 3; j++) {
      const j1 = (j + 1) % 3, j2 = (j + 2) % 3;
      const ra = A.e[i1] * AR[i2][j] + A.e[i2] * AR[i1][j];
      const rb = B.e[j1] * AR[i][j2] + B.e[j2] * AR[i][j1];
      if (Math.abs(T[i2] * R[i1][j] - T[i1] * R[i2][j]) > ra + rb) return false;
    }
  }
  return true;
}

/**
 * Formations whose plates all lie parallel, a gap apart, can't touch
 * whatever they do within their planes. The rest are checked.
 */
const PARALLEL = new Set<StackShape>(['Single', 'Twist', 'Wave', 'Fan', 'Bloom']);

/** whether any two plates of a formation touch, at a few points through its flow */
function collides(shape: StackShape, n: number, w: number, h: number, t: number, params: StackParams, spread: number) {
  // keep a sliver of air between plates, not just "not inside"
  const pad = t * 0.25;
  for (const phase of [0, 0.13, 0.29, 0.41, 0.6, 0.77]) {
    const boxes: Box[] = [];
    for (let i = 0; i < n; i++) boxes.push(boxOf(plateMatrix(shape, i, n, w, h, t, params, phase, spread, ma), w, h, t, pad));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) if (overlaps(boxes[i], boxes[j])) return true;
    }
  }
  return false;
}

/**
 * How far a formation must open out (radius, rise) for no two plates to
 * touch: 1 if it's clear as designed, else the least spread that is.
 */
function clearSpread(shape: StackShape, n: number, w: number, h: number, t: number, params: StackParams) {
  if (PARALLEL.has(shape) || !collides(shape, n, w, h, t, params, 1)) return 1;
  let lo = 1, hi = 2;
  while (collides(shape, n, w, h, t, params, hi) && hi < 16) {
    lo = hi;
    hi *= 2;
  }
  for (let k = 0; k < 8; k++) {
    const mid = (lo + hi) / 2;
    if (collides(shape, n, w, h, t, params, mid)) lo = mid;
    else hi = mid;
  }
  return hi;
}

/**
 * Moves the plates. A change of formation never jumps: plates leave the old
 * one in order, front to back, each easing into its place in the new — a
 * wave through the stack — each on its own layer so they pass, not collide.
 * Cycle steps through every formation by itself.
 */
export class StackAnimator {
  /** what is on screen when nothing is moving */
  shape: StackShape = 'Single';
  private from: StackShape = 'Single';
  /** 0..1 through a move; 1 = settled */
  private move = 1;
  private hold = 0;
  private phase = 0;
  private cycleAt = 0;
  /** the plate pulled out to the front, if any, and how far out each plate is (0..1) */
  private focus: number | null = null;
  private out = new Float32Array(MAX_PLATES);
  /** each formation's clearing spread, for the settings it was worked out at */
  private spreads = new Map<string, number>();
  /** where a pulled-out plate is shown: clear in front of the formation */
  readonly front = FRONT.clone();

  /** Pull plate i out to the front, face-on; null sends it back into the formation. */
  setFocus(i: number | null) {
    this.focus = i;
  }

  get focused() {
    return this.focus;
  }

  /** true when every plate sits on the single card (draw the plain card instead) */
  get collapsed() {
    return this.shape === 'Single' && this.move >= 1;
  }

  /** Head for a formation (or Cycle). */
  setTarget(option: string) {
    const cycling = option === 'Cycle';
    if (cycling) {
      if (this.cycling) return;
      this.cycling = true;
      this.cycleAt = Math.max(0, CYCLE.indexOf(this.shape));
      this.hold = HOLD * 0.5; // first move comes soon
      return;
    }
    this.cycling = false;
    const shape = (STACK_SHAPES as readonly string[]).includes(option) ? (option as StackShape) : 'Single';
    this.goTo(shape);
  }

  private cycling = false;

  private goTo(shape: StackShape) {
    if (shape === this.shape) return;
    this.from = this.shape;
    this.shape = shape;
    this.move = 0;
  }

  private spreadFor(shape: StackShape, n: number, w: number, h: number, t: number, params: StackParams) {
    const key = `${shape}|${n}|${w}|${h}|${params.twist}|${params.spacing}`;
    let v = this.spreads.get(key);
    if (v === undefined) {
      v = clearSpread(shape, n, w, h, t, params);
      if (this.spreads.size > 64) this.spreads.clear();
      this.spreads.set(key, v);
    }
    return v;
  }

  /** Advance by dt and write every plate into the meshes. */
  update(
    dt: number,
    meshes: THREE.InstancedMesh[],
    n: number,
    w: number,
    h: number,
    t: number,
    params: StackParams,
  ) {
    this.phase += params.flow * dt * 0.06;
    if (this.move < 1) {
      this.move = Math.min(1, this.move + dt / MOVE);
    } else if (this.cycling) {
      this.hold += dt;
      if (this.hold >= HOLD) {
        this.hold = 0;
        this.cycleAt = (this.cycleAt + 1) % CYCLE.length;
        this.goTo(CYCLE[this.cycleAt]);
      }
    }
    const spreadTo = this.spreadFor(this.shape, n, w, h, t, params);
    const spreadFrom = this.move < 1 ? this.spreadFor(this.from, n, w, h, t, params) : 1;

    // the formation's reach, so a pulled-out plate can go round it, not through it
    const plateR = Math.hypot(w, h) / 2;
    let reach = 0, deepest = -Infinity;
    for (let i = 0; i < n; i++) {
      plateMatrix(this.shape, i, n, w, h, t, params, this.phase, spreadTo, mb);
      pb.setFromMatrixPosition(mb);
      reach = Math.max(reach, pb.length());
      deepest = Math.max(deepest, pb.z);
    }
    reach += plateR;
    // tilted plates can reach a half-diagonal past their centres
    this.front.set(0, 0, Math.max(FRONT.z, deepest + plateR + 0.1));

    // each plate's own move takes half the time, starting in turn
    const stagger = 0.5;
    for (let i = 0; i < n; i++) {
      plateMatrix(this.shape, i, n, w, h, t, params, this.phase, spreadTo, mb);
      if (this.move < 1) {
        const start = n > 1 ? (i / (n - 1)) * stagger : 0;
        const k = ease(THREE.MathUtils.clamp((this.move - start) / (1 - stagger), 0, 1));
        if (k < 1) {
          plateMatrix(this.from, i, n, w, h, t, params, this.phase, spreadFrom, ma);
          ma.decompose(pa, qa, sa);
          mb.decompose(pb, qb, sb);
          pa.lerp(pb, k);
          qa.slerp(qb, k);
          sa.lerp(sb, k);
          // plates in flight travel on their own layers — the first to
          // leave rides highest — so they pass over one another
          const lane = 0.35 + (1 - i / Math.max(1, n - 1)) * Math.max(1.2, n * t * 3);
          pa.z += Math.sin(k * Math.PI) * lane;
          mb.compose(pa, qa, sa);
        }
      }
      // a plate pulled out (or on its way back) leaves its slot for the front
      const target = i === this.focus ? 1 : 0;
      const o = (this.out[i] += THREE.MathUtils.clamp(target - this.out[i], -dt / PULL, dt / PULL));
      if (o > 0) this.pullOut(mb, ease(o), reach);
      for (const mesh of meshes) mesh.setMatrixAt(i, mb);
    }
    for (const mesh of meshes) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      // recomputed when a raycast needs it
      mesh.boundingSphere = null;
    }
  }

  /**
   * A plate k (0..1) of the way from its slot to the front, going round the
   * formation rather than through it: first it slides out sideways within
   * its own plane — never into its neighbours — until it's clear of
   * everything; then comes forward, turning to face the viewer; then slides
   * in to the middle.
   */
  private pullOut(m: THREE.Matrix4, k: number, reach: number) {
    m.decompose(pa, qa, sa);
    // within the plate's plane, away from the formation's middle
    const nrm = Z.clone().applyQuaternion(qa);
    const away = pa.clone().addScaledVector(nrm, -pa.dot(nrm));
    if (away.lengthSq() < 1e-4) away.copy(X).applyQuaternion(qa);
    away.normalize();
    // far enough that the plate, at any angle, can't reach the formation
    const side = pa.clone().addScaledVector(away, reach + Math.hypot(sa.x, sa.y) + 0.2);
    const sideFront = side.clone().setZ(Math.max(side.z, this.front.z));
    const seg = (a: number, b: number) => ease(THREE.MathUtils.clamp((k - a) / (b - a), 0, 1));
    const s1 = seg(0, 0.35), s2 = seg(0.35, 0.7), s3 = seg(0.7, 1);
    pb.copy(pa).lerp(side, s1).lerp(sideFront, s2).lerp(this.front, s3);
    qb.copy(qa).slerp(FACE_ON, s2);
    sb.copy(sa).lerp(ONE, s2);
    m.compose(pb, qb, sb);
  }
}
