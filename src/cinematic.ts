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
  const drift = sweep === 'across'
    ? { x: rand(-0.06, 0.06), y: Math.sign(az) * rand(0.25, 0.45) }
    : { x: -Math.sign(el || 1) * rand(0.2, 0.35), y: rand(-0.06, 0.06) };

  return {
    rot,
    drift,
    sweep,
    push: dist * rand(0.12, 0.3),
    focus,
    view,
    roll: rand(-0.55, 0.55),
    dist,
    duration: length * rand(0.7, 1.3),
    kind,
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
