import { FaceLandmarker, FilesetResolver, type NormalizedLandmark } from '@mediapipe/tasks-vision';

// keep the runtime in step with the installed @mediapipe/tasks-vision
const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

export type FaceStatus = 'starting' | 'loading' | 'searching' | 'tracking' | 'blocked' | 'error';

export interface FaceFrame {
  landmarks: NormalizedLandmark[];
  /** video width / height, to put x and y in the same units */
  aspect: number;
}

/** The face landmarker, built once and shared by every tracker. */
let landmarkerPromise: Promise<FaceLandmarker> | null = null;
export function getFaceLandmarker(runningMode: 'VIDEO' | 'IMAGE' = 'VIDEO'): Promise<FaceLandmarker> {
  if (runningMode === 'IMAGE') return createLandmarker('IMAGE');
  return (landmarkerPromise ??= createLandmarker('VIDEO').catch((err) => {
    landmarkerPromise = null; // let a later attempt retry
    throw err;
  }));
}

async function createLandmarker(runningMode: 'VIDEO' | 'IMAGE') {
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  return FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
    runningMode,
    numFaces: 1,
  });
}

/** the tracked mesh, drawn over the preview */
const MESH = FaceLandmarker.FACE_LANDMARKS_TESSELATION;
const PREVIEW_WIDTH = 220;

/**
 * Webcam face tracking, with a small mirrored preview of the feed and the
 * tracked mesh in the corner. The feed stays on this device: it's only shown
 * in that preview and passed to the landmarker, never sent anywhere.
 */
export class FaceTracker {
  onStatus: ((status: FaceStatus) => void) | null = null;

  private video = document.createElement('video');
  private preview = document.createElement('div');
  private overlay = document.createElement('canvas');
  private stream: MediaStream | null = null;
  private landmarker: FaceLandmarker | null = null;
  private lastVideoTime = -1;
  private status: FaceStatus | null = null;
  private stopped = false;

  constructor() {
    this.video.muted = true;
    this.video.playsInline = true;
    Object.assign(this.preview.style, {
      position: 'fixed', top: '16px', left: '16px', width: `${PREVIEW_WIDTH}px`,
      borderRadius: '10px', overflow: 'hidden', background: '#000',
      border: '1px solid rgba(255, 255, 255, 0.1)', pointerEvents: 'none', zIndex: '12',
    });
    // mirrored, so it moves like a mirror (and like the sheet)
    const mirrored = { display: 'block', width: '100%', transform: 'scaleX(-1)' };
    Object.assign(this.video.style, mirrored);
    Object.assign(this.overlay.style, mirrored, { position: 'absolute', inset: '0', height: '100%' });
    this.preview.append(this.video, this.overlay);
  }

  async start() {
    this.setStatus('starting');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
    } catch (err) {
      console.warn('[holocloth] camera unavailable', err);
      this.setStatus('blocked');
      return;
    }
    if (this.stopped) return this.release();
    document.body.appendChild(this.preview);
    this.video.srcObject = this.stream;
    await this.video.play().catch(() => {});
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.overlay.width = Math.round(PREVIEW_WIDTH * dpr);
    this.overlay.height = Math.round((PREVIEW_WIDTH * dpr) / (this.video.videoWidth / this.video.videoHeight || 4 / 3));

    this.setStatus('loading');
    try {
      this.landmarker = await getFaceLandmarker('VIDEO');
    } catch (err) {
      console.error('[holocloth] face landmarker failed to load', err);
      this.setStatus('error');
      return;
    }
    if (this.stopped) return this.release();
    this.setStatus('searching');
  }

  /** Landmarks for a new video frame; null when there's no new frame or no face. */
  poll(): FaceFrame | null {
    const v = this.video;
    if (!this.landmarker || v.readyState < 2 || v.currentTime === this.lastVideoTime) return null;
    this.lastVideoTime = v.currentTime;
    const face = this.landmarker.detectForVideo(v, performance.now()).faceLandmarks[0];
    this.setStatus(face ? 'tracking' : 'searching');
    this.drawMesh(face);
    return face ? { landmarks: face, aspect: v.videoWidth / v.videoHeight } : null;
  }

  /** the tracked mesh as hairlines over the preview */
  private drawMesh(face: NormalizedLandmark[] | undefined) {
    const c = this.overlay;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    if (!face) return;
    // one device pixel: a true hairline on any screen
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const { start, end } of MESH) {
      const a = face[start], b = face[end];
      ctx.moveTo(a.x * c.width, a.y * c.height);
      ctx.lineTo(b.x * c.width, b.y * c.height);
    }
    ctx.stroke();
  }

  stop() {
    this.stopped = true;
    this.release();
  }

  private release() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.preview.remove();
    // the landmarker is shared and kept for the next time Face mode is on
    this.landmarker = null;
  }

  private setStatus(s: FaceStatus) {
    if (s === this.status) return;
    this.status = s;
    this.onStatus?.(s);
  }
}
