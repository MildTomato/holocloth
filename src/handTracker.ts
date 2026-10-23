import { HandLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision';
import { CameraTracker, visionFileset } from './cameraTracker.ts';

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

/** A tracked hand, in image space (x, y in 0..1 of the frame). */
export interface TrackedHand {
  /** where the thumb and index finger pinch — the point that holds a corner */
  grip: { x: number; y: number };
  /**
   * wrist to middle knuckle, as a share of the frame height. The camera
   * gives no depth, so how big the hand looks stands in for how close it is.
   */
  size: number;
}

export interface HandsFrame {
  hands: TrackedHand[];
}

/** The hand landmarker, built once and shared. IMAGE mode is for stills (tests). */
let landmarkerPromise: Promise<HandLandmarker> | null = null;
export function getHandLandmarker(runningMode: 'VIDEO' | 'IMAGE' = 'VIDEO'): Promise<HandLandmarker> {
  if (runningMode === 'IMAGE') return createLandmarker('IMAGE');
  return (landmarkerPromise ??= createLandmarker('VIDEO').catch((err) => {
    landmarkerPromise = null;
    throw err;
  }));
}

async function createLandmarker(runningMode: 'VIDEO' | 'IMAGE') {
  return HandLandmarker.createFromOptions(await visionFileset(), {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
    runningMode,
    numHands: 2,
  });
}

// MediaPipe hand landmark indices
const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_TIP = 8;
const MIDDLE_KNUCKLE = 9;

/** Grip point and apparent size from one hand's 21 landmarks. */
export function readHand(lm: NormalizedLandmark[], aspect: number): TrackedHand {
  const dx = (lm[MIDDLE_KNUCKLE].x - lm[WRIST].x) * aspect;
  const dy = lm[MIDDLE_KNUCKLE].y - lm[WRIST].y;
  return {
    grip: {
      x: (lm[THUMB_TIP].x + lm[INDEX_TIP].x) / 2,
      y: (lm[THUMB_TIP].y + lm[INDEX_TIP].y) / 2,
    },
    size: Math.hypot(dx, dy),
  };
}

const BONES = HandLandmarker.HAND_CONNECTIONS;

/** Webcam hand tracking, up to two hands; the preview shows each hand's skeleton. */
export class HandTracker extends CameraTracker<HandsFrame> {
  private landmarker: HandLandmarker | null = null;
  private lastLandmarks: NormalizedLandmark[][] = [];

  protected async load() {
    this.landmarker = await getHandLandmarker('VIDEO');
  }

  protected detect(video: HTMLVideoElement, timestamp: number): HandsFrame | null {
    const found = this.landmarker?.detectForVideo(video, timestamp).landmarks ?? [];
    this.lastLandmarks = found;
    return found.length ? { hands: found.map((lm) => readHand(lm, this.aspect)) } : null;
  }

  protected draw(ctx: CanvasRenderingContext2D, w: number, h: number) {
    for (const lm of this.lastLandmarks) {
      ctx.beginPath();
      for (const { start, end } of BONES) {
        ctx.moveTo(lm[start].x * w, lm[start].y * h);
        ctx.lineTo(lm[end].x * w, lm[end].y * h);
      }
      ctx.stroke();
      // the grip: the point holding the corner
      const g = readHand(lm, this.aspect).grip;
      ctx.beginPath();
      ctx.arc(g.x * w, g.y * h, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
