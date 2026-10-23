import { FilesetResolver } from '@mediapipe/tasks-vision';

// keep the runtime in step with the installed @mediapipe/tasks-vision
const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm';

let filesetPromise: ReturnType<typeof FilesetResolver.forVisionTasks> | null = null;
/** The MediaPipe WASM runtime, loaded once for every tracker. */
export function visionFileset() {
  return (filesetPromise ??= FilesetResolver.forVisionTasks(WASM_BASE).catch((err) => {
    filesetPromise = null; // let a later attempt retry
    throw err;
  }));
}

export type TrackerStatus = 'starting' | 'loading' | 'searching' | 'tracking' | 'blocked' | 'error';

const PREVIEW_WIDTH = 220;

/**
 * Webcam tracking with a small mirrored preview in the corner: the feed,
 * with whatever is tracked drawn over it in hairlines. The feed stays on
 * this device — it's only shown in that preview and handed to the model.
 * Subclasses load a model, run it on a frame, and draw what it found.
 */
export abstract class CameraTracker<R> {
  onStatus: ((status: TrackerStatus) => void) | null = null;

  protected video = document.createElement('video');
  private preview = document.createElement('div');
  private overlay = document.createElement('canvas');
  private stream: MediaStream | null = null;
  private ready = false;
  private lastVideoTime = -1;
  private status: TrackerStatus | null = null;
  private stopped = false;

  constructor() {
    this.video.muted = true;
    this.video.playsInline = true;
    Object.assign(this.preview.style, {
      position: 'fixed', top: '16px', left: '16px', width: `${PREVIEW_WIDTH}px`,
      borderRadius: '10px', overflow: 'hidden', background: '#000',
      border: '1px solid rgba(255, 255, 255, 0.1)', pointerEvents: 'none', zIndex: '12',
    });
    // mirrored, so it moves like a mirror (and like the cloth)
    const mirrored = { display: 'block', width: '100%', transform: 'scaleX(-1)' };
    Object.assign(this.video.style, mirrored);
    Object.assign(this.overlay.style, mirrored, { position: 'absolute', inset: '0', height: '100%' });
    this.preview.append(this.video, this.overlay);
  }

  /** Load the model; throws if it can't. */
  protected abstract load(): Promise<void>;
  /** Run the model on the current frame; null when nothing was found. */
  protected abstract detect(video: HTMLVideoElement, timestamp: number): R | null;
  /** Draw the result over the preview, in canvas pixels. */
  protected abstract draw(ctx: CanvasRenderingContext2D, w: number, h: number, result: R): void;

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
    const aspect = this.video.videoWidth / this.video.videoHeight || 4 / 3;
    this.overlay.width = Math.round(PREVIEW_WIDTH * dpr);
    this.overlay.height = Math.round((PREVIEW_WIDTH * dpr) / aspect);

    this.setStatus('loading');
    try {
      await this.load();
    } catch (err) {
      console.error('[holocloth] tracking model failed to load', err);
      this.setStatus('error');
      return;
    }
    if (this.stopped) return this.release();
    this.ready = true;
    this.setStatus('searching');
  }

  /** The model's result for a new video frame; null when there's no new frame or nothing found. */
  poll(): R | null {
    const v = this.video;
    if (!this.ready || v.readyState < 2 || v.currentTime === this.lastVideoTime) return null;
    this.lastVideoTime = v.currentTime;
    const result = this.detect(v, performance.now());
    this.setStatus(result ? 'tracking' : 'searching');
    const c = this.overlay;
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, c.width, c.height);
      if (result) {
        // one device pixel: a true hairline on any screen
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.lineWidth = 1;
        this.draw(ctx, c.width, c.height, result);
      }
    }
    return result;
  }

  get lastStatus() {
    return this.status;
  }

  get frameAspect() {
    return this.aspect;
  }

  /** video width / height, to put image x and y in the same units */
  protected get aspect() {
    return this.video.videoWidth / this.video.videoHeight || 4 / 3;
  }

  stop() {
    this.stopped = true;
    this.release();
  }

  private release() {
    this.ready = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.preview.remove();
  }

  private setStatus(s: TrackerStatus) {
    if (s === this.status) return;
    this.status = s;
    this.onStatus?.(s);
  }
}
