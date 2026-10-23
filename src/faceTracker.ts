import { FaceLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision';
import { CameraTracker, visionFileset } from './cameraTracker.ts';

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

export interface FaceFrame {
  landmarks: NormalizedLandmark[];
  /** video width / height, to put x and y in the same units */
  aspect: number;
}

/** The face landmarker, built once and shared. IMAGE mode is for stills (tests). */
let landmarkerPromise: Promise<FaceLandmarker> | null = null;
export function getFaceLandmarker(runningMode: 'VIDEO' | 'IMAGE' = 'VIDEO'): Promise<FaceLandmarker> {
  if (runningMode === 'IMAGE') return createLandmarker('IMAGE');
  return (landmarkerPromise ??= createLandmarker('VIDEO').catch((err) => {
    landmarkerPromise = null;
    throw err;
  }));
}

async function createLandmarker(runningMode: 'VIDEO' | 'IMAGE') {
  return FaceLandmarker.createFromOptions(await visionFileset(), {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
    runningMode,
    numFaces: 1,
  });
}

const MESH = FaceLandmarker.FACE_LANDMARKS_TESSELATION;

/** Webcam face tracking; the preview shows the tracked mesh. */
export class FaceTracker extends CameraTracker<FaceFrame> {
  private landmarker: FaceLandmarker | null = null;

  protected async load() {
    this.landmarker = await getFaceLandmarker('VIDEO');
  }

  protected detect(video: HTMLVideoElement, timestamp: number): FaceFrame | null {
    const face = this.landmarker?.detectForVideo(video, timestamp).faceLandmarks[0];
    return face ? { landmarks: face, aspect: this.aspect } : null;
  }

  protected draw(ctx: CanvasRenderingContext2D, w: number, h: number, { landmarks: face }: FaceFrame) {
    ctx.beginPath();
    for (const { start, end } of MESH) {
      ctx.moveTo(face[start].x * w, face[start].y * h);
      ctx.lineTo(face[end].x * w, face[end].y * h);
    }
    ctx.stroke();
  }
}
