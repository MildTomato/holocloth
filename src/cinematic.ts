import * as THREE from 'three';

/**
 * Shots for the card's cinematic reel. Each shot holds a camera and swings
 * the card through a raking angle while pushing it toward the lens, so a
 * highlight rakes across the face; shots change with a hard cut. Framings
 * run from the whole card down to macro, where the frame is all surface —
 * metal, grooves, light. Every camera sits on the card's front side.
 */
export interface Shot {
  /** the card's angle at the start of the shot */
  rot: THREE.Euler;
  /** how far it swings over the shot (radians) — the light sweep */
  drift: { x: number; y: number };
  /** which way the highlight travels over the face */
  sweep: 'across' | 'down';
  /** how far the card pushes toward the camera over the shot (world units) */
  push: number;
  /** the point the camera frames, on the card's face, in card space */
  focus: THREE.Vector3;
  /** from the focus toward the camera, in card space: always the front side */
  view: THREE.Vector3;
  /** camera roll (dutch tilt), radians */
  roll: number;
  dist: number;
  /** seconds */
  duration: number;
  kind: 'macro' | 'close' | 'medium' | 'wide';
  /** pace of the swing: even, quick off the mark and settling, or easing in late */
  ease: 'glide' | 'snap' | 'creep' | 'even';
}

/** How far through its swing a card shot is, f (0..1) of the way through its time. */
export function shotProgress(shot: Shot, f: number) {
  switch (shot.ease) {
    case 'snap':
      return 1 - (1 - f) ** 3;
    case 'creep':
      return f * f * f;
    case 'glide':
      return f * f * (3 - 2 * f);
    default:
      return f;
  }
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const either = () => (Math.random() < 0.5 ? -1 : 1);

/** furthest the camera may swing off the face's normal, so it stays on the front */
const MAX_VIEW_ANGLE = 1.35;

export function nextShot(width: number, height: number, length: number, prev?: Shot): Shot {
  // mostly in close — macro and close-ups — with medium and wide for air;
  // never the same framing twice in a row
  let kind: Shot['kind'];
  do {
    const r = Math.random();
    kind = r < 0.35 ? 'macro' : r < 0.65 ? 'close' : r < 0.87 ? 'medium' : 'wide';
  } while (kind === prev?.kind);

  const dist = {
    macro: rand(0.55, 0.9),
    close: rand(1.0, 1.5),
    medium: rand(2.2, 3.0),
    wide: rand(3.8, 4.5),
  }[kind];
  const spread = { macro: 0.45, close: 0.4, medium: 0.2, wide: 0.04 }[kind];
  const focus = new THREE.Vector3(
    rand(-1, 1) * spread * (width / 2),
    rand(-1, 1) * spread * (height / 2),
    0,
  );

  // aggressive card angles, flipping side from the last shot
  const yawSide = prev ? -Math.sign(prev.rot.y || 1) : either();
  const rot = new THREE.Euler(rand(-0.7, 0.7), yawSide * rand(0.4, 1.2), rand(-0.5, 0.5));

  // the camera rakes in steeply — never square-on. Its total angle off the
  // face's normal (sideways and up/down together) stays inside the limit,
  // so the face is always toward it
  const el = rand(-0.75, 0.75);
  const azMax = Math.acos(Math.min(1, Math.cos(MAX_VIEW_ANGLE) / Math.cos(el)));
  const az = either() * rand(Math.min(0.5, azMax), azMax);
  const view = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));

  // the card swings hard through the shot — mostly across, sometimes down —
  // always turning toward the camera: each shot starts at its steepest and
  // turns into the light, never away from it
  const sweep = Math.random() < 0.3 ? 'down' : 'across';
  // how big the swing is varies shot to shot: a slow tilt to a hard turn
  const size = Math.random() < 0.2 ? rand(0.15, 0.4) : rand(0.6, 1.8);
  const drift = sweep === 'across'
    ? { x: rand(-0.06, 0.06), y: Math.sign(az) * rand(0.25, 0.45) * size }
    : { x: -Math.sign(el || 1) * rand(0.2, 0.35) * size, y: rand(-0.06, 0.06) };

  return {
    rot,
    drift,
    sweep,
    // some shots barely move in, some lunge
    push: dist * (Math.random() < 0.25 ? rand(0, 0.06) : rand(0.12, 0.42)),
    focus,
    view,
    roll: rand(-0.55, 0.55),
    dist,
    duration: length * rand(0.6, 1.5),
    kind,
    ease: (['even', 'glide', 'snap', 'creep'] as const)[Math.floor(Math.random() * 4)],
  };
}

/** The card's pose f (0..1) of the way through a shot: its angle, and how far it has pushed in. */
export function shotPose(shot: Shot, f: number, rot = new THREE.Euler(), pos = new THREE.Vector3()) {
  rot.set(shot.rot.x + shot.drift.x * f, shot.rot.y + shot.drift.y * f, shot.rot.z);
  // pushed straight toward the camera
  pos.copy(shot.view).applyEuler(shot.rot).multiplyScalar(shot.push * f);
  return { rot, pos };
}

/**
 * Where the shot's strip light goes: exactly where the face mirrors it into
 * the camera at mid-shot, at the point the shot frames. As the card swings,
 * the reflection — a bright bar — rakes over the face. The strip lies
 * across the direction of travel.
 */
export function shotLight(shot: Shot, camera: THREE.Vector3, distance = 3.2) {
  const { rot: mid, pos } = shotPose(shot, 0.5);
  const normal = new THREE.Vector3(0, 0, 1).applyEuler(mid);
  const point = shot.focus.clone().applyEuler(mid).add(pos);
  const toCamera = camera.clone().sub(point).normalize();
  // bounce the view ray (camera -> point) off the face: it continues to the light
  const toLight = toCamera.clone().negate().reflect(normal);
  // the card's own "up", so the strip lines up with the card, not the world
  const up = new THREE.Vector3(0, 1, 0).applyEuler(mid);
  return { position: point.clone().addScaledVector(toLight, distance), target: point, up };
}

/** Camera position, look-at point and up (with its dutch roll) for a shot, card at the origin. */
export function shotCamera(shot: Shot) {
  const target = shot.focus.clone().applyEuler(shot.rot);
  const dir = shot.view.clone().applyEuler(shot.rot);
  const up = new THREE.Vector3(Math.sin(shot.roll), Math.cos(shot.roll), 0).applyEuler(shot.rot);
  return { position: target.clone().addScaledVector(dir, shot.dist), target, up };
}

/**
 * A shot of the cloth (or of one plate of a stack), which moves by itself,
 * so here the camera and light do the moving. Each shot picks its own
 * camera move — an orbit, a push in or pull out, a slide across or up, a
 * roll, or near-stillness — with its own size and pace, while the strip
 * light travels across so its highlight runs over the surface. Always from
 * the front, where the artwork is.
 */
export type CameraMove = 'orbit' | 'push' | 'pull' | 'truck' | 'crane' | 'roll' | 'hold';

export interface ClothShot {
  kind: 'close' | 'medium' | 'wide';
  move: CameraMove;
  /** what the camera looks at, start and end of the shot */
  target: THREE.Vector3;
  targetTo: THREE.Vector3;
  camFrom: THREE.Vector3;
  camTo: THREE.Vector3;
  up: THREE.Vector3;
  upTo: THREE.Vector3;
  /** pace of the move: even, quick off the mark and settling, or easing in late */
  ease: 'glide' | 'snap' | 'creep';
  lightFrom: THREE.Vector3;
  lightTo: THREE.Vector3;
  /** the strip's long side, across the highlight's travel */
  lightUp: THREE.Vector3;
  duration: number;
}

/** How far through its move a shot is, f (0..1) of the way through its time. */
export function moveProgress(shot: ClothShot, f: number) {
  switch (shot.ease) {
    case 'snap':
      return 1 - (1 - f) ** 3;
    case 'creep':
      return f * f * f;
    default:
      return f * f * (3 - 2 * f);
  }
}

const MOVES: [CameraMove, number][] = [
  ['orbit', 3], ['push', 2], ['pull', 1.5], ['truck', 2], ['crane', 1.5], ['roll', 1], ['hold', 1],
];

function pickMove(prev?: CameraMove): CameraMove {
  const options = MOVES.filter(([m]) => m !== prev);
  let r = Math.random() * options.reduce((a, [, w]) => a + w, 0);
  for (const [m, w] of options) if ((r -= w) <= 0) return m;
  return options[0][0];
}

export function nextClothShot(
  point: THREE.Vector3,
  normal: THREE.Vector3,
  length: number,
  prev?: ClothShot,
): ClothShot {
  let kind: ClothShot['kind'];
  do {
    const r = Math.random();
    kind = r < 0.45 ? 'close' : r < 0.8 ? 'medium' : 'wide';
  } while (kind === prev?.kind);
  const dist = { close: rand(1.1, 1.7), medium: rand(2.3, 3.1), wide: rand(4.2, 5.0) }[kind];

  // the front: the artwork faces +z
  const n = normal.clone();
  if (n.z < 0) n.negate();
  // a frame around the spot's normal, to rake the camera off it
  const ref = Math.abs(n.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const side = ref.cross(n).normalize();
  const lift = n.clone().cross(side).normalize();
  const az = either() * rand(0.3, 0.9);
  const el = rand(-0.6, 0.6);
  const view = n.clone().multiplyScalar(Math.cos(az) * Math.cos(el))
    .addScaledVector(side, Math.sin(az) * Math.cos(el))
    .addScaledVector(lift, Math.sin(el))
    .normalize();

  const move = pickMove(prev?.move);
  const camFrom = point.clone().addScaledVector(view, dist);
  let camTo = camFrom.clone();
  const target = point.clone();
  const targetTo = point.clone();
  const roll = rand(-0.45, 0.45);
  let rollTo = roll;
  switch (move) {
    case 'orbit': {
      // round the spot: anything from a creep to a sweep, sometimes pushing in as it goes
      const arc = either() * rand(0.06, 0.55);
      const axis = Math.random() < 0.7 ? lift : side;
      camTo = point.clone().addScaledVector(view.clone().applyAxisAngle(axis, arc), dist * rand(0.8, 1.05));
      break;
    }
    case 'push':
      camTo = point.clone().addScaledVector(view, dist * rand(0.5, 0.82));
      break;
    case 'pull':
      // starts tight and backs off: a reveal
      camFrom.copy(point).addScaledVector(view, dist * rand(0.55, 0.75));
      camTo = point.clone().addScaledVector(view, dist * rand(1.05, 1.3));
      break;
    case 'truck': {
      // slide across, camera and its aim together, so the surface tracks past
      const by = side.clone().multiplyScalar(either() * dist * rand(0.15, 0.45));
      camTo = camFrom.clone().add(by);
      targetTo.add(by);
      break;
    }
    case 'crane': {
      const by = lift.clone().multiplyScalar(either() * dist * rand(0.15, 0.4));
      camTo = camFrom.clone().add(by);
      // the aim lags behind, so the angle on the surface changes as it rises
      targetTo.addScaledVector(by, 0.5);
      break;
    }
    case 'roll':
      rollTo = roll + either() * rand(0.25, 0.7);
      camTo = point.clone().addScaledVector(view, dist * rand(0.85, 0.95));
      break;
    case 'hold':
      // all but still: the light does the work
      camTo = point.clone().addScaledVector(view.clone().applyAxisAngle(lift, either() * 0.02), dist * 0.98);
      break;
  }
  const ease = move === 'hold' ? 'glide' : (['glide', 'glide', 'snap', 'creep'] as const)[Math.floor(Math.random() * 4)];

  // light: start where the sheet mirrors it into the camera, then travel
  // across, so the highlight runs over the surface
  const toLight = view.clone().negate().reflect(n);
  const sweepAxis = Math.random() < 0.7 ? lift : side;
  const swing = either() * rand(0.2, move === 'hold' ? 0.6 : 0.45);
  const lightFrom = point.clone().addScaledVector(toLight.clone().applyAxisAngle(sweepAxis, -swing), 3.2);
  const lightTo = point.clone().addScaledVector(toLight.clone().applyAxisAngle(sweepAxis, swing), 3.2);

  return {
    kind,
    move,
    target,
    targetTo,
    camFrom,
    camTo,
    up: lift.clone().applyAxisAngle(view, roll),
    upTo: lift.clone().applyAxisAngle(view, rollTo),
    ease,
    lightFrom,
    lightTo,
    lightUp: sweepAxis === lift ? side.clone() : lift.clone(),
    duration: length * rand(0.6, 1.5),
  };
}
