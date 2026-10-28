import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ClothSim, type HangMode } from './cloth.ts';
import { createHoloMaterial, type HoloUniforms } from './holoMaterial.ts';
import { SurfaceLayer, type DecalItem } from './decals.ts';
import { normalMapFromImage } from './textures.ts';
import { MacroDofPass } from './dofPass.ts';
import { BAKED_POSE } from './bakedPose.ts';
import { gridSvg, growthSvg, barsSvg, asciiSvg, asciiGrid, ditherSvg, ditherGrid, sampleLuminance, loadImage, fetchDataUrl } from './gridArt.ts';
import { FaceTracker } from './faceTracker.ts';
import { MetalCard } from './card.ts';
import type { StackParams } from './cardStack.ts';
import {
  nextShot, shotCamera, shotLight, shotPose, nextClothShot, moveProgress, shotProgress, type Shot, type ClothShot,
} from './cinematic.ts';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { HandTracker, type HandsFrame } from './handTracker.ts';
import type { TrackerStatus } from './cameraTracker.ts';
import { FaceCollider } from './faceCollider.ts';

/** Per-version snapshot of everything image-related (session-scoped). */
export interface ImagesState {
  clothImage: HTMLImageElement | null;
  decals: DecalItem[];
}

export interface HoloParams {
  performance: string;
  /** webcam hands hold the poster's corners */
  hands: boolean;
  /** Flag / Poster / Original / Face / Card */
  mode: string;
  /** the card's cinematic reel: cuts between raking shots with a light sweep */
  cinematic: boolean;
  /** the metal card: linework printed or etched, and its corners */
  card: {
    ink: string;
    etchDepth: number;
    etchBevel: number;
    corner: number;
    /** roughly how long each cinematic shot holds (s), and how dramatic its light is */
    shotLength: number;
    drama: number;
  };
  /** Card mode: dragging the card 'Spin card's it, or 'Move camera' orbits */
  drag?: string;
  /** Card mode: 'One' card, or a 'Stack' of them */
  cards?: string;
  /** copies of the card stacked into a formation, and how it moves */
  stack?: StackParams;
  physics: {
    viscosity: number;
    stiffness: number;
    iterations: number;
    smoothing: number;
    grabRadius: number;
    gravity: number;
    hang: string;
    pinSpread: number;
    wind: number;
    windDir: number;
    flutter: number;
    gust: number;
    dynamicWind: boolean;
    bend: number;
    compress: number;
    selfCollide: boolean;
    stretch: number;
    faceDepth: number;
  };
  material: {
    preset: string;
    finish: string;
    baseColor: string;
    holoIntensity: number;
    holoScale: number;
    bandFreq: number;
    saturation: number;
    hueShift: number;
    sparkle: number;
    specTint: number;
    iridescence: number;
    roughness: number;
    metalness: number;
    clearcoat: number;
    coatRoughness: number;
    sheen: number;
    bump: number;
    bumpTiling: number;
  };
  grid: {
    pattern: string;
    /** Flower: which flower is set in type */
    flower?: string;
    /** Flower: glyph size, Small to Huge */
    type?: string;
    /** Flower: set in type (ASCII) or dithered (Atkinson, Bayer, Halftone) */
    style?: string;
    /** Growth: how many halvings from Petabyte down to Prototype */
    steps: number;
    rows: number;
    depth: number;
    fill: number;
    endCircles: boolean;
    guides: boolean;
    seed: number;
  };
  images: {
    edit: boolean;
    useImage: boolean;
    scale: number;
    rotation: number;
    opacity: number;
    cornerRadius: number;
  };
  render: {
    background: string;
    exposure: number;
    environment: number;
    bloom: number;
    bloomThreshold: number;
    noise: number;
    toneMapping: string;
    occlusion: boolean;
    occlusionStrength: number;
    dof: boolean;
    dofAperture: number;
    dofBlur: number;
    dofRange: number;
  };
}

const TONE_MAPPINGS: Record<string, THREE.ToneMapping> = {
  AgX: THREE.AgXToneMapping,
  ACES: THREE.ACESFilmicToneMapping,
  Neutral: THREE.NeutralToneMapping,
};

/** the Flower artwork's photos: each a single stem on solid black */
const flowerSrc = (name: string) =>
  `/artwork/flowers/${name.toLowerCase()}.jpg`;

const CLOTH_LONG_SIDE = 3;
/** seconds for the camera to move in on a pulled-out plate, or back */
const PLATE_CAM_TIME = 0.9;
// Hands: the camera frame maps onto this world width, centred this high
const HOLD_SPAN = 3.2;
const HOLD_CENTER_Y = 1.0;
/** hand size (wrist to middle knuckle, share of frame height) when far / near */
const HAND_FAR = 0.12;
const HAND_NEAR = 0.32;
/** how far the held corner sits from the wall, far hand to near hand */
const HOLD_Z_FAR = -0.6;
const HOLD_Z_NEAR = 0.9;
/** sticker width as a fraction of cloth width */
const STICKER_SCALE = 0.26;
const CLOTH_SEGMENTS = 48;
const WHITE = new THREE.Color(0xffffff);


const GrainShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uAmount: { value: 0.08 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uAmount;
    uniform float uTime;
    varying vec2 vUv;
    // sinless hash (Dave Hoskins style): sin-based hashes lose precision at
    // large arguments on some ANGLE backends (Chrome on Windows/Metal) and
    // collapse into marching bands — this one stays white noise everywhere
    float gHash(vec3 p3) {
      p3 = fract(p3 * 0.1031);
      p3 += dot(p3, p3.zyx + 31.32);
      return fract((p3.x + p3.y) * p3.z);
    }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      // coords wrapped to keep magnitudes float32-safe; time is a hash
      // dimension, not an offset, so no pattern travels between frames
      vec2 p = mod(gl_FragCoord.xy, 1024.0);
      float n = gHash(vec3(p, mod(uTime * 120.0, 512.0))) - 0.5;
      c.rgb += n * uAmount;
      gl_FragColor = c;
    }
  `,
};

export class HoloApp {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls!: OrbitControls;
  private composer: EffectComposer;
  private bloomPass: UnrealBloomPass;
  private dofPass: MacroDofPass;
  private grainPass: ShaderPass;
  private cavityAttr!: THREE.BufferAttribute;
  private sim!: ClothSim;
  private clothMesh: THREE.Mesh;
  private card: MetalCard;
  private cardMode = false;
  private revealed = false;
  private cardDragId: number | null = null;
  private cardLast = { x: 0, y: 0, t: 0 };
  /** a press on the stack that may turn out to be a click: on a plate, or on nothing */
  private plateClick: { id: number; x: number; y: number; plate: number | null } | null = null;
  /**
   * The camera's move in on a pulled-out plate: 0 at rest, 1 framing it.
   * `rest` is where it was before, to go back to.
   */
  private plateCam = { k: 0, rest: null as { position: THREE.Vector3; target: THREE.Vector3; up: THREE.Vector3 } | null };
  /** the card's cinematic reel: the shot on screen, and the camera to go back to */
  private cine: {
    /** a card shot, in Card mode */
    shot: Shot | null;
    /** a cloth shot, in the other modes */
    cloth: ClothShot | null;
    /** which the current shot is of, to cut when the mode changes */
    forCard: boolean;
    /**
     * a shot of one plate of the stack: which spot it's on (so the camera
     * can follow it as the formation moves), and where that spot was when
     * the shot was framed
     */
    plate: { i: number; u: number; v: number; start: THREE.Vector3 } | null;
    t0: number;
    saved: { position: THREE.Vector3; target: THREE.Vector3 };
  } | null = null;
  /** the reel's focus distance, eased so it doesn't flicker between plates */
  private cineFocusDist = 0;
  private cinePose = new THREE.Euler();
  private cinePos = new THREE.Vector3();
  private cineFocus = new THREE.Vector3();
  private shotLength = 2.2;
  /** 0..1: how dark the room goes and how hot the strip light is while the reel runs */
  private drama = 0.7;
  /** the reel's strip light, placed per shot so its reflection sweeps the face */
  private cineLight: THREE.RectAreaLight | null = null;
  private rectLightsReady = false;
  private clothGeometry!: THREE.BufferGeometry;
  private holoUniforms: HoloUniforms;
  private holoMaterial: THREE.MeshPhysicalMaterial;
  private surface: SurfaceLayer;
  private bumpSource: HTMLImageElement | null = null;
  private thumbCache = new WeakMap<HTMLImageElement, string>();
  private perfProfile = 'High';
  private clothSegments = CLOTH_SEGMENTS;
  private currentPR = Math.min(window.devicePixelRatio, 2);
  private background = new THREE.Color('#0b0c12');
  private clock = new THREE.Clock();
  private elapsed = 0;
  private raycaster = new THREE.Raycaster();
  private pointerNdc = new THREE.Vector2();
  private dragPlane = new THREE.Plane();
  private grabbing = false;
  private grabPointerId: number | null = null;
  private draggingDecal = false;
  private decalGrabOffset = { u: 0, v: 0 };
  private pickingFocus = false;
  private focusVertex: number | null = null;
  private pickReleaseId: number | null = null;
  private spaceHeld = false;
  private focusTmp = new THREE.Vector3();
  private editMode = false;
  private prevUseImage = false;
  private hoverCursor = 'default';
  private resizeObserver: ResizeObserver;
  private params: HoloParams | null = null;
  private disposed = false;

  /** App-level hook: fired when a decal is selected or resized via wheel. */
  onDecalSelect: ((scale: number, rotation: number) => void) | null = null;
  /** App-level hook: any uploaded image (cloth/decal/bump) changed. */
  onImagesChanged: (() => void) | null = null;
  /** App-level hook: a sticker was peeled off the cloth; the app carries it from here. */
  onStickerPick: ((item: DecalItem, e: PointerEvent) => void) | null = null;
  /** App-level hook: face tracking state, for the on-screen notice */
  onFaceStatus: ((status: TrackerStatus | null) => void) | null = null;
  /** App-level hook: hand tracking state, for the on-screen notice */
  onHandStatus: ((status: TrackerStatus | null) => void) | null = null;
  /** webcam hands holding the poster's corners (Hands on) */
  private handTracker: HandTracker | null = null;
  private latestHands: HandsFrame | null = null;
  /** each top corner's held position, eased toward the hand (or back to the wall) */
  private grips: ({ x: number; y: number; z: number } | null)[] = [null, null];
  /** webcam tracking while the cloth lies over your face (Face mode) */
  private faceTracker: FaceTracker | null = null;
  private faceCollider = new FaceCollider();
  /** stickers mid slap-down, animating their pop back to 1 */
  private slaps: { item: DecalItem; t0: number }[] = [];
  /** last grid settings applied; a change regenerates the cloth art */
  private gridKey = '';
  private gridJob = 0;
  private gridTimer: number | null = null;
  private gridField: Promise<string> | null = null;
  /** a photo uploaded for the Flower artwork, in place of the chosen flower; and a count that changes with it */
  private flowerUpload: string | null = null;
  private flowerVersion = 0;
  private lastFlower: string | undefined;
  private originalArt: Promise<HTMLImageElement> | null = null;

  constructor(private host: HTMLElement) {
    const width = host.clientWidth || window.innerWidth;
    const height = host.clientHeight || window.innerHeight;

    this.renderer = new THREE.WebGLRenderer({
      antialias: false, // MSAA happens on the composer's render target
      powerPreference: 'high-performance',
      stencil: false,
      alpha: true, // transparent-background export
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    host.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = this.background;
    this.camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 200);
    this.camera.position.set(...BAKED_POSE.camera);

    // image-based lighting from a neutral studio room
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = envTex;
    pmrem.dispose();

    // accent rims for specular interest — cool one side, warm the other
    const rimA = new THREE.DirectionalLight(0x7fd4ff, 1.1);
    rimA.position.set(-4, 2.5, -3);
    const rimB = new THREE.DirectionalLight(0xff9ad5, 0.9);
    rimB.position.set(4.5, -1.5, -2.5);
    const key = new THREE.DirectionalLight(0xffffff, 0.7);
    key.position.set(1.5, 3, 4);
    this.scene.add(rimA, rimB, key);

    // surface layer (uploaded graphics) + cloth
    this.surface = new SurfaceLayer();
    const holo = createHoloMaterial(this.surface.texture, this.surface.stickerTexture);
    this.holoMaterial = holo.material;
    this.holoUniforms = holo.uniforms;
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    if (this.holoMaterial.roughnessMap) this.holoMaterial.roughnessMap.anisotropy = maxAniso;
    this.surface.texture.anisotropy = maxAniso;
    this.surface.stickerTexture.anisotropy = maxAniso;

    // the artwork as a metal card (Card mode), sized with the cloth
    this.card = new MetalCard(this.surface.texture, this.surface.stickerTexture);
    this.scene.add(this.card.group);
    this.card.setDetail(this.holoMaterial.normalMap, this.holoMaterial.roughnessMap);

    this.clothMesh = new THREE.Mesh(undefined, this.holoMaterial);
    this.clothMesh.frustumCulled = false;
    // hidden until the app has loaded its assets and calls reveal()
    this.clothMesh.visible = false;
    this.buildCloth(1);
    this.scene.add(this.clothMesh);

    // interaction listeners BEFORE OrbitControls so grabs win the pointer
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onWindowBlur);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 1.6;
    this.controls.maxDistance = 30;
    this.controls.target.set(...BAKED_POSE.target);
    this.controls.update();

    // post: MSAA + half-float HDR chain, bloom, tonemap+sRGB, grain
    const rt = new THREE.WebGLRenderTarget(width, height, {
      samples: 8,
      type: THREE.HalfFloatType,
    });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.dofPass = new MacroDofPass(this.scene, this.camera);
    this.dofPass.enabled = false;
    this.composer.addPass(this.dofPass);
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 0.18, 0.85, 1.0);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());
    this.grainPass = new ShaderPass(GrainShader);
    this.composer.addPass(this.grainPass);

    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(host);

    this.renderer.setAnimationLoop(this.tick);

    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__holo = this;
    }
  }

  private clothAspect = 1;

  /** (Re)build the sim + geometry for a given aspect ratio (w/h). */
  private buildCloth(aspect: number) {
    this.clothAspect = aspect;
    const w = aspect >= 1 ? CLOTH_LONG_SIDE : CLOTH_LONG_SIDE * aspect;
    const h = aspect >= 1 ? CLOTH_LONG_SIDE / aspect : CLOTH_LONG_SIDE;
    const segs = this.clothSegments;
    const segX = aspect >= 1 ? segs : Math.max(10, Math.round(segs * aspect));
    const segY = aspect >= 1 ? Math.max(10, Math.round(segs / aspect)) : segs;
    this.sim = new ClothSim(w, h, segX, segY);
    this.card.setSize(w, h);
    // a fresh sim starts free-floating: hold it the way the panel says, or a
    // rebuild (performance switch, new image shape) drops the flag/poster
    if (this.params) {
      this.sim.setPinSpread(this.params.physics.pinSpread);
      this.sim.setHang(this.params.physics.hang as HangMode);
    }
    if (this.faceTracker) this.sim.setCollider(this.faceCollider);
    const geo = new THREE.PlaneGeometry(w, h, segX, segY);
    const posAttr = new THREE.BufferAttribute(this.sim.positions, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', posAttr);
    this.cavityAttr = new THREE.BufferAttribute(new Float32Array(this.sim.count), 1);
    this.cavityAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aCavity', this.cavityAttr);
    geo.computeVertexNormals();
    const old = this.clothMesh.geometry;
    this.clothMesh.geometry = geo;
    this.clothGeometry = geo;
    if (old) old.dispose();
    this.holoUniforms.uClothSize.value.set(w, h);
    this.focusVertex = null; // vertex indices are invalid after a rebuild
    this.cancelInteraction();
  }

  /** Fully tear down any in-flight grab/decal drag (e.g. cloth rebuilt). */
  private cancelInteraction() {
    if (this.grabPointerId !== null &&
        this.renderer.domElement.hasPointerCapture(this.grabPointerId)) {
      this.renderer.domElement.releasePointerCapture(this.grabPointerId);
    }
    this.grabbing = false;
    this.draggingDecal = false;
    this.grabPointerId = null;
    this.sim.endGrab();
    // buildCloth also runs in the constructor, before controls exist
    if (this.controls) this.controls.enabled = true;
  }

  applyParams(p: HoloParams) {
    this.params = p;
    this.updateGridArt(p.grid);
    // spread first: setHang pins at the current spread
    this.sim.setPinSpread(p.physics.pinSpread);
    this.sim.setHang(p.physics.hang as HangMode);
    this.setFaceTracking(p.physics.hang === 'Face');
    this.setHandTracking(!!p.hands);
    this.setCardMode(p.mode === 'Card');
    if (p.card) {
      this.card.setEtch(p.card.ink, p.card.etchDepth, p.card.etchBevel);
      this.card.setCorner(p.card.corner);
    }
    if (p.stack) this.card.setStack({ ...p.stack, cards: p.cards });
    this.drama = p.card?.drama ?? 0.7;
    this.setCinematic(!!p.cinematic, p.card?.shotLength ?? 2.2);
    this.faceCollider.depth = p.physics.faceDepth;
    if (p.performance !== this.perfProfile) this.applyPerfProfile(p.performance);
    const m = this.holoMaterial;
    m.color.set(p.material.baseColor);
    m.roughness = p.material.roughness;
    m.metalness = p.material.metalness;
    m.clearcoat = p.material.clearcoat;
    m.clearcoatRoughness = p.material.coatRoughness;
    m.sheen = p.material.sheen;
    // sheen fibers carry the dye color, halfway toward white at the rim
    m.sheenColor.set(p.material.baseColor).lerp(WHITE, 0.5);
    m.iridescence = p.material.iridescence;
    m.normalScale.set(p.material.bump, p.material.bump);
    this.card.setBump(p.material.bump);
    if (m.normalMap) m.normalMap.repeat.set(p.material.bumpTiling, p.material.bumpTiling);
    // material.envMapIntensity is ignored when lighting comes from
    // scene.environment — the renderer reads scene.environmentIntensity
    this.scene.environmentIntensity = p.render.environment;

    const u = this.holoUniforms;
    u.uHoloIntensity.value = p.material.holoIntensity;
    u.uHoloScale.value = p.material.holoScale;
    u.uBandFreq.value = p.material.bandFreq;
    u.uSaturation.value = p.material.saturation;
    u.uHueShift.value = p.material.hueShift;
    u.uSparkle.value = p.material.sparkle;
    u.uSpecTint.value = p.material.specTint;
    u.uSurfaceOpacity.value = p.images.opacity;
    u.uCornerRound.value = p.images.cornerRadius;

    this.background.set(p.render.background);
    this.renderer.toneMappingExposure = p.render.exposure;
    const tm = TONE_MAPPINGS[p.render.toneMapping] ?? THREE.AgXToneMapping;
    if (this.renderer.toneMapping !== tm) this.renderer.toneMapping = tm;
    this.bloomPass.strength = p.render.bloom;
    this.bloomPass.threshold = p.render.bloomThreshold;
    this.grainPass.uniforms.uAmount.value = p.render.noise;
    u.uCavityAmount.value = p.render.occlusion ? p.render.occlusionStrength : 0;
    this.dofPass.enabled = p.render.dof;
    this.dofPass.setParams(p.render.dofAperture * 1e-2, p.render.dofBlur, p.render.dofRange * 0.5);

    this.editMode = p.images.edit;
    this.controls.enableZoom = !this.editMode;

    // the useImage toggle doubles as the image-as-cloth state indicator;
    // edge-triggered so a stale false from a mid-upload render can't wipe
    // a freshly set image
    if (this.prevUseImage && !p.images.useImage && this.surface.clothImage) {
      this.removeClothImage();
    }
    this.prevUseImage = p.images.useImage;

    // sliders drive the selected decal
    const sel = this.surface.selected;
    if (sel && (sel.scale !== p.images.scale || sel.rotation !== p.images.rotation)) {
      sel.scale = p.images.scale;
      sel.rotation = p.images.rotation;
      this.surface.redraw();
    }
  }

  /**
   * Original = the hand-drawn construction; Generated = the power-of-two
   * grid built from these settings. Debounced, and stale results dropped,
   * so dragging a slider doesn't queue up renders.
   */
  private updateGridArt(g: HoloParams['grid']) {
    if (!g) return;
    const generated = g.pattern === 'Generated' || g.pattern === 'Growth' || g.pattern === 'Bars' || g.pattern === 'Flower';
    const key = g.pattern === 'Generated'
      ? ['Generated', g.rows, g.depth, g.fill, g.endCircles, g.guides, g.seed].join('|')
      : g.pattern === 'Growth'
        ? ['Growth', g.steps, g.guides].join('|')
        : g.pattern === 'Flower' ? `Flower|${g.flower}|${g.style}|${g.type}|${this.flowerVersion}`
        : g.pattern === 'Bars' ? 'Bars' : 'Original';
    if (key === this.gridKey) return;
    // picking a flower from the list replaces an uploaded photo
    if (g.flower !== this.lastFlower && this.lastFlower !== undefined) this.flowerUpload = null;
    this.lastFlower = g.flower;
    const first = this.gridKey === '';
    this.gridKey = key;
    // at boot the app is already loading the original as the startup image
    if (first && !generated) return;
    const job = ++this.gridJob;
    if (this.gridTimer !== null) window.clearTimeout(this.gridTimer);
    this.gridTimer = window.setTimeout(() => {
      this.gridTimer = null;
      const art = generated
        ? this.generateGridArt(g)
        : (this.originalArt ??= loadImage('/artwork/construction.svg'));
      art.then((img) => {
        if (job !== this.gridJob || this.disposed) return;
        this.swapClothArt(img);
      }).catch((err) => console.error('[holocloth] grid art failed', err));
    }, 90);
  }

  private async generateGridArt(g: HoloParams['grid']) {
    const field = await (this.gridField ??= fetchDataUrl('/artwork/field.png'));
    if (g.pattern === 'Flower') {
      const src = this.flowerUpload ?? flowerSrc(g.flower ?? 'Tulip');
      const style = g.style ?? 'ASCII';
      let svg: string;
      if (style === 'ASCII') {
        const { cols, rows } = asciiGrid(g.type);
        svg = asciiSvg(await sampleLuminance(src, cols, rows), cols, rows, field, g.type);
      } else {
        const { cols, rows } = ditherGrid(g.type, style);
        svg = ditherSvg(await sampleLuminance(src, cols, rows, 1), cols, rows, field, style, g.type);
      }
      return loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    }
    const svg = g.pattern === 'Bars' ? barsSvg(field) : g.pattern === 'Growth'
      ? growthSvg({ rows: g.steps, guides: g.guides }, field)
      : gridSvg({
        rows: g.rows,
        depth: g.depth,
        fill: g.fill,
        endCircles: g.endCircles,
        guides: g.guides,
        seed: Math.round(g.seed),
      }, field);
    return loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  }

  /**
   * Face mode: the webcam drives a collider the sheet lies on. Off again
   * releases the camera straight away.
   */
  private setFaceTracking(on: boolean) {
    if (on === !!this.faceTracker) return;
    if (on) {
      const tracker = new FaceTracker();
      tracker.onStatus = (s) => this.onFaceStatus?.(s);
      this.faceTracker = tracker;
      this.sim.setCollider(this.faceCollider);
      void tracker.start();
    } else {
      this.faceTracker?.stop();
      this.faceTracker = null;
      this.faceCollider.clear();
      this.sim.setCollider(null);
      this.onFaceStatus?.(null);
    }
  }

  /** Hands on: the webcam's hands hold the poster's top corners. */
  private setHandTracking(on: boolean) {
    if (on === !!this.handTracker) return;
    if (on) {
      const tracker = new HandTracker();
      tracker.onStatus = (s) => this.onHandStatus?.(s);
      this.handTracker = tracker;
      this.latestHands = null;
      void tracker.start();
    } else {
      this.handTracker?.stop();
      this.handTracker = null;
      this.latestHands = null;
      this.grips = [null, null];
      for (let k = 0; k < this.sim.pinCount; k++) this.sim.holdPin(k, null);
      this.onHandStatus?.(null);
    }
  }

  /**
   * Each hand holds the top corner on its side, at its thumb-index pinch.
   * Mirrored like the preview; how big the hand looks stands in for how
   * close it is, bringing that corner toward you. A corner whose hand is
   * gone eases back onto its wall pin.
   */
  private holdWithHands() {
    const tracker = this.handTracker!;
    const fresh = tracker.poll();
    if (fresh || tracker.lastStatus === 'searching') this.latestHands = fresh;
    if (this.sim.pinCount !== 2) return; // hands hold the poster's two corners

    const aspect = tracker.frameAspect;
    const targets: ({ x: number; y: number; z: number } | null)[] = [null, null];
    const held = (this.latestHands?.hands ?? []).map((h) => {
      const t = THREE.MathUtils.clamp((h.size - HAND_FAR) / (HAND_NEAR - HAND_FAR), 0, 1);
      return {
        x: -(h.grip.x - 0.5) * HOLD_SPAN,
        y: HOLD_CENTER_Y + (0.5 - h.grip.y) * (HOLD_SPAN / aspect),
        z: THREE.MathUtils.lerp(HOLD_Z_FAR, HOLD_Z_NEAR, t),
      };
    });
    if (held.length >= 2) {
      held.sort((a, b) => a.x - b.x);
      targets[0] = held[0];
      targets[1] = held[held.length - 1];
    } else if (held.length === 1) {
      targets[held[0].x < 0 ? 0 : 1] = held[0];
    }

    for (let k = 0; k < 2; k++) {
      const goal = targets[k] ?? this.sim.pinRestOf(k);
      const g = (this.grips[k] ??= { ...this.sim.pinRestOf(k) });
      const ease = targets[k] ? 0.35 : 0.06;
      g.x += (goal.x - g.x) * ease;
      g.y += (goal.y - g.y) * ease;
      g.z += (goal.z - g.z) * ease;
      this.sim.holdPin(k, g);
    }
  }

  /** Run the sim ahead without rendering, so a still opens on a flag already in the wind. */
  warmUp(seconds: number) {
    if (!this.params) return;
    for (let t = 0; t < seconds; t += 1 / 60) this.sim.step(1 / 60, this.params.physics);
    this.clothGeometry.attributes.position.needsUpdate = true;
    this.clothGeometry.computeVertexNormals();
  }

  /** Aim the camera at the cloth's centre (the default view leaves room for the panel). */
  frameCloth() {
    this.clothGeometry.computeBoundingBox();
    const box = this.clothGeometry.boundingBox;
    if (!box) return;
    box.getCenter(this.controls.target);
    this.controls.update();
  }

  /** Startup art just landed: put the chosen grid pattern over it, unless it's Original. */
  /** Set the Flower artwork from another photo (best: a subject lit on a black ground). */
  setFlowerImage(img: HTMLImageElement) {
    this.flowerUpload = img.src;
    this.flowerVersion++;
    if (this.params) this.updateGridArt(this.params.grid);
  }

  refreshGridArt() {
    if (!this.params) return;
    this.gridKey = '';
    this.updateGridArt(this.params.grid);
  }

  /** New artwork on the same cloth: keep the drape unless the shape changes. */
  private swapClothArt(img: HTMLImageElement) {
    const iw = img.naturalWidth || img.width || 1;
    const ih = img.naturalHeight || img.height || 1;
    const aspect = Math.min(3, Math.max(1 / 3, iw / ih));
    if (Math.abs(aspect - this.clothAspect) > 1e-3) {
      this.setClothImage(img);
      return;
    }
    this.surface.setClothImage(img);
    this.onImagesChanged?.();
  }

  resetCloth() {
    this.sim.reset();
    this.clothGeometry.attributes.position.needsUpdate = true;
    this.clothGeometry.computeVertexNormals();
  }

  poke() {
    this.sim.poke(1);
  }

  /** Peel every sticker off. */
  clearStickers() {
    for (const d of [...this.surface.decals]) if (d.sticker) this.surface.remove(d);
    this.slaps = [];
    this.onImagesChanged?.();
  }

  addDecal(img: HTMLImageElement) {
    const item = this.surface.addDecal(img);
    this.onDecalSelect?.(item.scale, item.rotation);
    this.onImagesChanged?.();
  }

  setClothImage(img: HTMLImageElement) {
    const iw = img.naturalWidth || img.width || 1;
    const ih = img.naturalHeight || img.height || 1;
    const aspect = Math.min(3, Math.max(1 / 3, iw / ih));
    this.surface.setClothImage(img);
    if (this.surface.setAspect(aspect)) this.rebindSurfaceTexture();
    this.buildCloth(aspect);
    this.onImagesChanged?.();
  }

  clearImages() {
    this.surface.clear();
    if (this.surface.setAspect(1)) this.rebindSurfaceTexture();
    this.buildCloth(1);
    this.onImagesChanged?.();
  }

  /** Drop only the cloth image (decals stay), back to the square cloth. */
  removeClothImage() {
    this.surface.setClothImage(null);
    if (this.surface.setAspect(1)) this.rebindSurfaceTexture();
    this.buildCloth(1);
    this.onImagesChanged?.();
  }

  get hasClothImage() {
    return this.surface.clothImage !== null;
  }

  /** Show the cloth once the app's assets are in place. */
  reveal() {
    this.revealed = true;
    this.showMode();
  }

  /** Card mode swaps the cloth for the metal card; the cloth sim rests meanwhile. */
  private setCardMode(on: boolean) {
    if (on === this.cardMode) return;
    this.cardMode = on;
    this.showMode();
  }

  private showMode() {
    this.clothMesh.visible = this.revealed && !this.cardMode;
    this.card.group.visible = this.revealed && this.cardMode;
  }

  /**
   * The card's cinematic reel: hold a shot, drifting the card so light
   * sweeps the face, then cut — instantly — to the next. The camera is
   * driven while it runs and handed back where it was after.
   */
  private setCinematic(on: boolean, length: number) {
    this.shotLength = length;
    if (on === !!this.cine) return;
    if (on) {
      this.cine = {
        shot: null,
        cloth: null,
        plate: null,
        forCard: this.cardMode,
        t0: 0,
        saved: { position: this.camera.position.clone(), target: this.controls.target.clone() },
      };
      this.controls.enabled = false;
      if (!this.rectLightsReady) {
        RectAreaLightUniformsLib.init();
        this.rectLightsReady = true;
      }
      this.cineLight = new THREE.RectAreaLight(0xffffff, 1, 1, 1);
      this.scene.add(this.cineLight);
      this.cutToNextShot();
    } else {
      const { saved } = this.cine!;
      this.cine = null;
      this.card.setPose(null);
      if (this.cineLight) {
        this.scene.remove(this.cineLight);
        this.cineLight.dispose();
        this.cineLight = null;
      }
      this.camera.up.set(0, 1, 0);
      if (this.params) {
        const r = this.params.render;
        this.scene.environmentIntensity = r.environment;
        this.dofPass.enabled = r.dof;
        this.dofPass.setParams(r.dofAperture * 1e-2, r.dofBlur, r.dofRange * 0.5);
      }
      this.camera.position.copy(saved.position);
      this.controls.target.copy(saved.target);
      this.controls.enabled = true;
      this.controls.update();
    }
  }

  /** Hard cut to a new shot: of the card in Card mode, otherwise of the cloth. */
  private cutToNextShot() {
    const c = this.cine!;
    c.t0 = this.elapsed;
    c.forCard = this.cardMode;
    const light = this.cineLight;
    c.plate = null;
    if (this.cardMode && this.card.stacked) {
      // a stack: shots of real plates, gliding like the cloth's, from
      // angles where nothing stands between the camera and the plate
      this.card.setPose(null);
      c.shot = null;
      const { shot, plate } = this.stackShot(c.cloth ?? undefined);
      c.cloth = shot;
      c.plate = plate;
      this.placeCamera(shot.camFrom, shot.target, shot.up);
      if (light) {
        light.width = 0.45;
        light.height = 4;
      }
    } else if (this.cardMode) {
      c.cloth = null;
      const { w, h } = this.card.dims;
      c.shot = nextShot(w, h, this.shotLength, c.shot ?? undefined);
      const { position, target, up } = shotCamera(c.shot);
      this.placeCamera(position, target, up);
      // the strip light where the face mirrors it into this camera mid-shot,
      // lying across the way the highlight travels
      if (light) {
        const l = shotLight(c.shot, position);
        light.position.copy(l.position);
        light.up.copy(l.up);
        light.lookAt(l.target);
        const across = c.shot.sweep === 'across';
        light.width = across ? 0.45 : 4;
        light.height = across ? 4 : 0.45;
      }
    } else {
      // card shots are for the card: release it if it was posed
      this.card.setPose(null);
      c.shot = null;
      const { point, normal } = this.clothSpot();
      c.cloth = nextClothShot(point, normal, this.shotLength, c.cloth ?? undefined);
      this.placeCamera(c.cloth.camFrom, c.cloth.target, c.cloth.up);
      if (light) {
        light.width = 0.45;
        light.height = 4;
      }
    }
    this.runCinematic();
  }

  /**
   * A shot of one plate of the stack. Picks a spot on a plate and a camera
   * move for it, and keeps it only if the plate is in clear view from both
   * ends of the move; after a few misses, a wider look at the whole stack.
   */
  private stackShot(prev?: ClothShot) {
    const point = new THREE.Vector3(), normal = new THREE.Vector3();
    const n = this.card.plateCount;
    let fallback: { shot: ClothShot; plate: { i: number; u: number; v: number; start: THREE.Vector3 } } | null = null;
    for (let attempt = 0; attempt < 24; attempt++) {
      const i = Math.floor(Math.random() * n);
      const u = THREE.MathUtils.randFloat(-0.35, 0.35), v = THREE.MathUtils.randFloat(-0.35, 0.35);
      this.card.platePoint(i, u, v, point, normal);
      const shot = nextClothShot(point, normal, this.shotLength, prev);
      const plate = { i, u, v, start: point.clone() };
      if (this.inClearView(shot.camFrom, point) && this.inClearView(shot.camTo, point)) return { shot, plate };
      // blocked: aim instead at whatever plate the camera does see that way
      fallback ??= this.retarget(shot);
    }
    if (fallback) return fallback;
    // nothing in that direction at all: aim at the first plate, from the front
    this.card.platePoint(0, 0, 0, point, normal);
    return { shot: nextClothShot(point, normal, this.shotLength, prev), plate: { i: 0, u: 0, v: 0, start: point.clone() } };
  }

  /** Re-aim a shot at the first plate surface its camera sees toward the target. */
  private retarget(shot: ClothShot) {
    const dir = shot.target.clone().sub(shot.camFrom).normalize();
    this.raycaster.set(shot.camFrom, dir);
    const hit = this.raycaster.intersectObject(this.card.solid, false)[0];
    if (!hit || hit.instanceId === undefined) return null;
    const { u, v } = this.card.plateUv(hit.instanceId, hit.point);
    // keep the move (a slide carries its aim with it), now on the visible spot
    shot.targetTo.add(hit.point).sub(shot.target);
    shot.target.copy(hit.point);
    return { shot, plate: { i: hit.instanceId, u, v, start: hit.point.clone() } };
  }

  /** Whether a straight line from the camera reaches this point before any other plate. */
  private inClearView(from: THREE.Vector3, point: THREE.Vector3) {
    const dir = point.clone().sub(from);
    const dist = dir.length();
    this.raycaster.set(from, dir.normalize());
    const hit = this.raycaster.intersectObject(this.card.solid, false)[0];
    return !hit || hit.distance > dist - 0.03;
  }

  private placeCamera(position: THREE.Vector3, target: THREE.Vector3, up: THREE.Vector3) {
    this.camera.position.copy(position);
    this.controls.target.copy(target);
    this.camera.up.copy(up); // dutch tilt
    this.camera.lookAt(target);
  }

  /** A spot on the sheet to frame — away from the edges — and its surface normal. */
  private clothSpot() {
    const s = this.sim;
    const r = Math.floor(THREE.MathUtils.randFloat(0.15, 0.85) * (s.rows - 1));
    const col = Math.floor(THREE.MathUtils.randFloat(0.15, 0.85) * (s.cols - 1));
    const i = (r * s.cols + col) * 3;
    const p = s.positions;
    const n = this.clothGeometry.attributes.normal.array;
    return {
      point: new THREE.Vector3(p[i], p[i + 1], p[i + 2]),
      normal: new THREE.Vector3(n[i], n[i + 1], n[i + 2]).normalize(),
    };
  }

  private runCinematic() {
    const c = this.cine!;
    // switched between card and cloth mid-reel: cut to a shot of what's showing
    if (c.forCard !== this.cardMode) {
      this.cutToNextShot();
      return;
    }
    const duration = c.shot?.duration ?? c.cloth?.duration ?? 0;
    const t = this.elapsed - c.t0;
    if (t >= duration) {
      this.cutToNextShot();
      return;
    }
    const f = t / duration;
    let kind: string;
    if (c.shot) {
      const shot = c.shot;
      kind = shot.kind;
      shotPose(shot, shotProgress(shot, f), this.cinePose, this.cinePos);
      this.card.setPose(this.cinePose, this.cinePos);
      this.cineFocus.copy(shot.focus).applyEuler(this.cinePose).add(this.cinePos);
    } else {
      // the cloth moves by itself: glide the camera and carry the light across
      const shot = c.cloth!;
      kind = shot.kind;
      const ease = moveProgress(shot, f);
      // a plate of the stack drifts with its formation: camera and light go with it
      const shift = new THREE.Vector3();
      if (c.plate) {
        const now = new THREE.Vector3();
        this.card.platePoint(c.plate.i, c.plate.u, c.plate.v, now, new THREE.Vector3());
        shift.subVectors(now, c.plate.start);
      }
      const target = shot.target.clone().lerp(shot.targetTo, ease).add(shift);
      this.camera.position.lerpVectors(shot.camFrom, shot.camTo, ease).add(shift);
      this.camera.up.copy(shot.up).lerp(shot.upTo, ease).normalize();
      this.camera.lookAt(target);
      this.cineFocus.copy(target);
      const light = this.cineLight;
      if (light) {
        light.position.lerpVectors(shot.lightFrom, shot.lightTo, f).add(shift);
        light.up.copy(shot.lightUp);
        light.lookAt(target);
      }
    }
    // depth of field on the framed spot. The sharp zone scales with the shot
    // distance so it holds the spot and its surroundings; past it, blur
    // builds gradually (full only a quarter of the distance further out),
    // to a modest maximum — never a thin sharp strip with the rest smeared
    // focus on whatever is at the middle of the frame: in a stack that may
    // be a nearer plate than the one aimed at, or one behind a gap
    let focusDist = this.camera.position.distanceTo(this.cineFocus);
    if (this.cardMode) {
      const look = this.cineFocus.clone().sub(this.camera.position).normalize();
      this.raycaster.set(this.camera.position, look);
      const hit = this.raycaster.intersectObject(this.card.solid, false)[0];
      if (hit) focusDist = hit.distance;
    }
    // a cut snaps focus; within a shot it eases, like a focus puller
    this.cineFocusDist = t < 0.05 || this.cineFocusDist === 0
      ? focusDist
      : THREE.MathUtils.lerp(this.cineFocusDist, focusDist, 0.15);
    focusDist = this.cineFocusDist;
    const maxBlur = (0.01 + 0.02 * this.drama) * (kind === 'wide' ? 0.5 : 1);
    this.dofPass.enabled = true;
    this.dofPass.setParams(maxBlur / 0.25, maxBlur, focusDist * 0.15);
    this.dofPass.setFocus(focusDist);
    // drama: dim the room so the sweep is the star, and push the light
    if (this.params) {
      this.scene.environmentIntensity = this.params.render.environment * (1 - 0.78 * this.drama);
    }
    if (this.cineLight) this.cineLight.intensity = 6 + 34 * this.drama;
  }

  /**
   * Pull a plate of the stack out to the front and move the camera in,
   * square to it; null puts it back and returns the camera to where it was.
   */
  private focusPlate(plate: number | null) {
    if (plate !== null && this.card.focusedPlate === null && this.plateCam.k === 0) {
      this.plateCam.rest = {
        position: this.camera.position.clone(),
        target: this.controls.target.clone(),
        up: this.camera.up.clone(),
      };
    }
    this.card.focusPlate(plate);
  }

  /** Ease the camera toward a pulled-out plate, or back to rest. */
  private updatePlateCamera(dt: number) {
    const c = this.plateCam;
    const focused = this.card.focusedPlate !== null;
    // anything that ends the stack, or the reel taking the camera, sends it back
    if (focused && (!this.cardMode || !this.card.stacked || this.cine)) this.card.focusPlate(null);
    const goal = this.card.focusedPlate !== null ? 1 : 0;
    // at rest there is nothing to do; held on a plate, keep following it as it floats
    if (!c.rest || (c.k === 0 && goal === 0)) return;
    c.k = THREE.MathUtils.clamp(c.k + (goal ? dt : -dt) / PLATE_CAM_TIME, 0, 1);
    const k = c.k < 0.5 ? 4 * c.k ** 3 : 1 - (-2 * c.k + 2) ** 3 / 2;
    // framed square-on, the plate filling most of the height
    const spot = new THREE.Vector3(), normal = new THREE.Vector3(), up = new THREE.Vector3();
    this.card.plateSpot(spot, normal, up);
    const { w, h } = this.card.dims;
    const half = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const dist = Math.max(h / 2, w / 2 / this.camera.aspect) / half / 0.8;
    const at = spot.clone().addScaledVector(normal, dist);
    this.camera.position.copy(c.rest.position).lerp(at, k);
    this.controls.target.copy(c.rest.target).lerp(spot, k);
    this.camera.up.copy(c.rest.up).lerp(up, k).normalize();
    this.camera.lookAt(this.controls.target);
    this.controls.enabled = c.k === 0;
    if (c.k === 0) c.rest = null;
  }

  /** Any part of the card under the pointer — for spinning it. */
  private raycastCard(): THREE.Intersection | null {
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    return this.raycaster.intersectObject(this.card.group, true)[0] ?? null;
  }

  private startCardSpin(e: PointerEvent) {
    // Move camera: dragging the card orbits instead, and the view stays where it's left
    if (this.params?.drag === 'Move camera') return;
    if (!this.raycastCard()) return; // empty space: let OrbitControls orbit
    this.card.dragging = true;
    this.cardDragId = e.pointerId;
    this.cardLast = { x: e.clientX, y: e.clientY, t: performance.now() };
    this.controls.enabled = false;
    this.renderer.domElement.setPointerCapture(e.pointerId);
    this.renderer.domElement.style.cursor = 'grabbing';
  }

  /** Small data-URL preview of an image, cached per element. */
  private thumbnailOf(img: HTMLImageElement): string {
    let url = this.thumbCache.get(img);
    if (url) return url;
    const iw = img.naturalWidth || img.width || 1;
    const ih = img.naturalHeight || img.height || 1;
    const scale = 96 / Math.max(iw, ih);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(iw * scale));
    c.height = Math.max(1, Math.round(ih * scale));
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    url = c.toDataURL('image/png');
    this.thumbCache.set(img, url);
    return url;
  }

  getClothThumbnail(): string | null {
    return this.surface.clothImage ? this.thumbnailOf(this.surface.clothImage) : null;
  }

  getDecalThumbnails(): string[] {
    return this.surface.decals.map((d) => this.thumbnailOf(d.img));
  }

  removeDecal(index: number) {
    const d = this.surface.decals[index];
    if (!d) return;
    this.surface.decals.splice(index, 1);
    if (this.surface.selected === d) this.surface.selected = null;
    this.surface.redraw();
    this.onImagesChanged?.();
  }

  /** Capture image state for the version manager. */
  snapshotImages(): ImagesState {
    return {
      clothImage: this.surface.clothImage,
      decals: this.surface.decals.map((d) => ({ ...d })),
    };
  }

  /** Restore a version's image state (cloth image + decals). */
  restoreImages(s: ImagesState) {
    this.surface.clothImage = s.clothImage;
    this.surface.decals = s.decals.map((d) => ({ ...d }));
    this.surface.selected = null;
    let aspect = 1;
    if (s.clothImage) {
      const iw = s.clothImage.naturalWidth || s.clothImage.width || 1;
      const ih = s.clothImage.naturalHeight || s.clothImage.height || 1;
      aspect = Math.min(3, Math.max(1 / 3, iw / ih));
    }
    if (this.surface.setAspect(aspect)) this.rebindSurfaceTexture();
    if (aspect !== this.clothAspect) this.buildCloth(aspect);
    this.onImagesChanged?.();
  }

  /**
   * Quality/performance trade-off: render scale, MSAA samples, and cloth
   * resolution. 'High' matches the original behavior.
   */
  private applyPerfProfile(profile: string) {
    this.perfProfile = profile;
    const dpr = window.devicePixelRatio;
    this.currentPR = profile === 'Low' ? 1 : profile === 'Medium' ? Math.min(dpr, 1.5) : Math.min(dpr, 2);
    const samples = profile === 'Low' ? 0 : profile === 'Medium' ? 4 : 8;
    const segs = profile === 'Low' ? 28 : profile === 'Medium' ? 36 : 48;
    const w = this.host.clientWidth || window.innerWidth;
    const h = this.host.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(this.currentPR);
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(this.currentPR);
    // MSAA sample count lives on the composer's ping-pong targets; force
    // reallocation so the new count takes effect
    this.composer.renderTarget1.samples = samples;
    this.composer.renderTarget2.samples = samples;
    this.composer.renderTarget1.dispose();
    this.composer.renderTarget2.dispose();
    this.composer.setSize(w, h);
    if (segs !== this.clothSegments) {
      this.clothSegments = segs;
      this.buildCloth(this.clothAspect);
    }
  }

  /** Swap the cloth's bump/normal map; null removes it entirely. */
  setBumpMap(img: HTMLImageElement | null) {
    const old = this.holoMaterial.normalMap;
    let tex: THREE.Texture | null = null;
    if (img) {
      tex = normalMapFromImage(img);
      tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      const tiling = this.params?.material.bumpTiling ?? 3;
      tex.repeat.set(tiling, tiling);
    }
    this.bumpSource = img;
    this.holoMaterial.normalMap = tex;
    // map presence changes the shader program
    if (!!old !== !!tex) this.holoMaterial.needsUpdate = true;
    this.card.setDetail(tex, this.holoMaterial.roughnessMap);
    if (old) old.dispose();
    this.onImagesChanged?.();
  }

  get hasBumpMap() {
    return this.bumpSource !== null;
  }

  getBumpThumbnail(): string | null {
    return this.bumpSource ? this.thumbnailOf(this.bumpSource) : null;
  }

  /** After SurfaceLayer recreates its texture, point the shader at it. */
  private rebindSurfaceTexture() {
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.surface.texture.anisotropy = maxAniso;
    this.surface.stickerTexture.anisotropy = maxAniso;
    this.holoUniforms.uSurfaceMap.value = this.surface.texture;
    this.holoUniforms.uStickerMap.value = this.surface.stickerTexture;
    this.card.setTextures(this.surface.texture, this.surface.stickerTexture);
  }

  /** Render one frame at high resolution and download it as a PNG. */
  exportPNG(transparent = false) {
    const w = this.host.clientWidth || window.innerWidth;
    const h = this.host.clientHeight || window.innerHeight;
    const normalPR = this.currentPR;
    const exportPR = Math.min(4, Math.max(2, 3200 / Math.max(w, h)));
    if (transparent) {
      this.scene.background = null;
      this.renderer.setClearColor(0x000000, 0);
    }
    this.renderer.setPixelRatio(exportPR);
    this.composer.setPixelRatio(exportPR);
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.composer.render();
    const url = this.renderer.domElement.toDataURL('image/png');
    if (transparent) {
      this.scene.background = this.background;
      this.renderer.setClearColor(0x000000, 1);
    }
    this.renderer.setPixelRatio(normalPR);
    this.composer.setPixelRatio(normalPR);
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    const a = document.createElement('a');
    a.href = url;
    const tag = transparent ? 'holocloth-nobg' : 'holocloth';
    a.download = `${tag}-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
    a.click();
  }

  private updatePointer(e: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  private raycastCloth(): THREE.Intersection | null {
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    if (this.cardMode) {
      // in Card mode the "surface" is the card's printed face
      const hit = this.raycaster.intersectObject(this.card.group, true)[0];
      return hit && this.card.isFace(hit.object) ? hit : null;
    }
    this.clothGeometry.computeBoundingSphere();
    const hits = this.raycaster.intersectObject(this.clothMesh, false);
    return hits.length > 0 ? hits[0] : null;
  }

  /** Cloth UV under a client-space point, or null when off the cloth. */
  uvAt(clientX: number, clientY: number): THREE.Vector2 | null {
    return this.clothHitAt(clientX, clientY)?.uv ?? null;
  }

  private clothHitAt(clientX: number, clientY: number) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    return this.raycastCloth();
  }

  /**
   * Slap a sticker onto the cloth under the pointer. Returns false when the
   * pointer is off the cloth — the sticker is discarded.
   */
  stickAt(clientX: number, clientY: number, img: HTMLImageElement, rotation: number): boolean {
    const hit = this.clothHitAt(clientX, clientY);
    if (!hit?.uv) return false;
    const item = this.surface.addSticker(img, hit.uv.x, hit.uv.y, STICKER_SCALE, rotation);
    item.pop = 1.3;
    this.slaps.push({ item, t0: this.elapsed });
    // the hand pushes the fabric back as the sticker lands
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    this.sim.impulse(hit.point, dir.multiplyScalar(0.02), this.sim.width * 0.22);
    this.onImagesChanged?.();
    return true;
  }

  endStickerDrag() {
    this.controls.enabled = true;
  }

  /** One-shot: next click on the cloth becomes the DOF focal point. */
  startPickFocus() {
    this.pickingFocus = true;
    this.renderer.domElement.style.cursor = 'crosshair';
  }

  /** Back to auto focus (orbit target). */
  clearPickFocus() {
    this.focusVertex = null;
  }

  /** Hold Space + left-drag = pan (design-tool style). */
  private onKeyDown = (e: KeyboardEvent) => {
    if (e.code !== 'Space' || e.repeat) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
    this.spaceHeld = true;
    this.controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
    if (!this.grabbing && !this.draggingDecal && !this.pickingFocus) {
      this.renderer.domElement.style.cursor = 'grab';
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (e.code !== 'Space') return;
    this.spaceHeld = false;
    this.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
  };

  private onWindowBlur = () => {
    // cmd-tab away mid-hold: never leave pan mode stuck on
    this.spaceHeld = false;
    this.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
  };

  private onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || this.grabbing || this.draggingDecal) return;
    this.updatePointer(e);
    if (this.pickingFocus) {
      this.pickingFocus = false;
      this.renderer.domElement.style.cursor = 'default';
      const pick = this.raycastCloth();
      if (pick) {
        // nearest cloth vertex — the focal point rides the fabric
        const p = this.sim.positions;
        let best = 0;
        let bestD2 = Infinity;
        for (let i = 0; i < this.sim.count; i++) {
          const dx = p[i * 3] - pick.point.x;
          const dy = p[i * 3 + 1] - pick.point.y;
          const dz = p[i * 3 + 2] - pick.point.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < bestD2) { bestD2 = d2; best = i; }
        }
        this.focusVertex = best;
      }
      // swallow this click so it neither grabs nor orbits
      this.pickReleaseId = e.pointerId;
      this.controls.enabled = false;
      return;
    }
    // Space held: step aside so OrbitControls pans with the left button
    if (this.spaceHeld) return;
    // the reel is running: a click cuts to the next shot
    if (this.cine) {
      this.cutToNextShot();
      return;
    }
    if (this.cardMode && this.card.stacked) {
      // a click on a plate pulls it out; a click anywhere else puts it back
      const plate = this.card.plateAt(this.raycastCard());
      this.plateClick = { id: e.pointerId, x: e.clientX, y: e.clientY, plate };
      if (this.card.focusedPlate !== null) return; // the camera is on it: no spinning or orbiting
    }
    const hit = this.raycastCloth();
    if (!hit) {
      if (this.cardMode) this.startCardSpin(e); // back or edge of the card
      return;
    }

    // stickers peel off on press, ahead of cloth grabbing
    const peeled = hit.uv ? this.surface.stickerAt(hit.uv.x, hit.uv.y) : null;
    if (peeled && this.onStickerPick) {
      this.surface.remove(peeled);
      this.slaps = this.slaps.filter((s) => s.item !== peeled);
      this.controls.enabled = false; // endStickerDrag() turns it back on
      this.onStickerPick(peeled, e);
      this.onImagesChanged?.();
      return;
    }

    if (this.cardMode) {
      this.startCardSpin(e);
      return;
    }

    if (this.editMode) {
      if (!hit.uv) return;
      const d = this.surface.hitTest(hit.uv.x, hit.uv.y);
      if (!d) return; // no decal under pointer: let OrbitControls rotate
      this.surface.selected = d;
      this.draggingDecal = true;
      this.decalGrabOffset.u = d.u - hit.uv.x;
      this.decalGrabOffset.v = d.v - hit.uv.y;
      this.grabPointerId = e.pointerId;
      this.controls.enabled = false;
      this.renderer.domElement.setPointerCapture(e.pointerId);
      this.renderer.domElement.style.cursor = 'move';
      this.onDecalSelect?.(d.scale, d.rotation);
      return;
    }

    const radius = this.params?.physics.grabRadius ?? 0.45;
    if (!this.sim.startGrab(hit.point, radius)) return;
    this.grabbing = true;
    this.grabPointerId = e.pointerId;
    this.controls.enabled = false;
    // drag on a camera-facing plane through the grab point
    const normal = new THREE.Vector3();
    this.camera.getWorldDirection(normal);
    this.dragPlane.setFromNormalAndCoplanarPoint(normal, hit.point);
    this.renderer.domElement.setPointerCapture(e.pointerId);
    this.renderer.domElement.style.cursor = 'grabbing';
  };

  private onPointerMove = (e: PointerEvent) => {
    if (this.cardDragId !== null) {
      if (e.pointerId !== this.cardDragId) return;
      const now = performance.now();
      const dt = Math.max(1, now - this.cardLast.t) / 1000;
      this.card.drag(e.clientX - this.cardLast.x, e.clientY - this.cardLast.y, dt);
      this.cardLast = { x: e.clientX, y: e.clientY, t: now };
      return;
    }
    const active = this.grabbing || this.draggingDecal;
    if (active && e.pointerId !== this.grabPointerId) return;
    this.updatePointer(e);
    if (this.draggingDecal) {
      const hit = this.raycastCloth();
      const sel = this.surface.selected;
      if (hit?.uv && sel) {
        sel.u = hit.uv.x + this.decalGrabOffset.u;
        sel.v = hit.uv.y + this.decalGrabOffset.v;
        this.surface.redraw();
      }
      return;
    }
    if (!this.grabbing) return;
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const target = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.dragPlane, target)) {
      this.sim.moveGrab(target);
    }
  };

  private onPointerUp = (e: PointerEvent) => {
    const click = this.plateClick;
    if (click && e.pointerId === click.id) {
      this.plateClick = null;
      if (Math.hypot(e.clientX - click.x, e.clientY - click.y) < 6) {
        if (click.plate !== null) this.focusPlate(click.plate);
        else if (this.card.focusedPlate !== null) this.focusPlate(null);
      }
    }
    if (this.cardDragId !== null && e.pointerId === this.cardDragId) {
      this.card.dragging = false;
      this.cardDragId = null;
      this.controls.enabled = true;
      if (this.renderer.domElement.hasPointerCapture(e.pointerId)) {
        this.renderer.domElement.releasePointerCapture(e.pointerId);
      }
      this.renderer.domElement.style.cursor = this.hoverCursor;
      return;
    }
    if (e.pointerId === this.pickReleaseId) {
      this.pickReleaseId = null;
      this.controls.enabled = true;
      return;
    }
    const active = this.grabbing || this.draggingDecal;
    if (!active || e.pointerId !== this.grabPointerId) return;
    this.grabbing = false;
    this.draggingDecal = false;
    this.grabPointerId = null;
    this.sim.endGrab();
    this.controls.enabled = true;
    if (this.renderer.domElement.hasPointerCapture(e.pointerId)) {
      this.renderer.domElement.releasePointerCapture(e.pointerId);
    }
    this.renderer.domElement.style.cursor = this.hoverCursor;
  };

  private onWheel = (e: WheelEvent) => {
    if (!this.editMode) return;
    const sel = this.surface.selected;
    if (!sel) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    sel.scale = THREE.MathUtils.clamp(sel.scale * Math.exp(-e.deltaY * 0.0012), 0.02, 2.5);
    this.surface.redraw();
    this.onDecalSelect?.(sel.scale, sel.rotation);
  };

  private onResize() {
    const width = this.host.clientWidth || window.innerWidth;
    const height = this.host.clientHeight || window.innerHeight;
    if (width === 0 || height === 0) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
  }

  private tick = () => {
    if (this.disposed) return;
    const dt = this.clock.getDelta();
    this.elapsed += dt;
    this.grainPass.uniforms.uTime.value = this.elapsed % 61.7;

    if (this.slaps.length > 0) {
      // damped overshoot: lands big, dips just under, settles at 1
      this.slaps = this.slaps.filter((s) => {
        const t = this.elapsed - s.t0;
        if (t >= 0.45) {
          s.item.pop = 1;
          return false;
        }
        s.item.pop = 1 + 0.3 * Math.exp(-9 * t) * Math.cos(14 * t);
        return true;
      });
      this.surface.redrawStickers();
    }

    if (this.cine) this.runCinematic();
    if (this.cardMode) this.card.update(dt, this.elapsed);
    if (this.params && !this.cardMode) {
      const face = this.faceTracker?.poll();
      if (face) this.faceCollider.update(face);
      if (this.handTracker) this.holdWithHands();
      this.sim.step(dt, this.params.physics);
      this.clothGeometry.attributes.position.needsUpdate = true;
      this.clothGeometry.computeVertexNormals();
    }

    if (this.params?.render.occlusion && !this.cardMode) {
      this.sim.computeCavity(
        this.clothGeometry.attributes.normal.array,
        this.cavityAttr.array as Float32Array,
      );
      this.cavityAttr.needsUpdate = true;
    }
    if (this.params?.render.dof) {
      // picked focal point rides the fabric; otherwise focus the orbit target
      let focusDist: number;
      if (this.focusVertex !== null && this.focusVertex < this.sim.count) {
        const p = this.sim.positions;
        const i = this.focusVertex * 3;
        this.focusTmp.set(p[i], p[i + 1], p[i + 2]);
        focusDist = this.camera.position.distanceTo(this.focusTmp);
      } else {
        focusDist = this.camera.position.distanceTo(this.controls.target);
      }
      this.dofPass.setFocus(focusDist);
    }

    // hover cursor feedback (skip while dragging/picking/panning; off on Low)
    if (!this.grabbing && !this.draggingDecal && !this.pickingFocus && !this.spaceHeld &&
        this.perfProfile !== 'Low') {
      const hit = this.cardMode ? this.raycastCard() : this.raycastCloth();
      let cursor = 'default';
      if (hit) {
        cursor = this.editMode
          ? hit.uv && this.surface.hitTest(hit.uv.x, hit.uv.y) ? 'move' : 'default'
          : 'grab';
      }
      if (cursor !== this.hoverCursor) {
        this.hoverCursor = cursor;
        this.renderer.domElement.style.cursor = cursor;
      }
    }

    this.updatePlateCamera(dt);
    // the reel places the camera itself; damped controls would ease its cuts
    if (!this.cine && this.plateCam.k === 0) this.controls.update();
    this.composer.render();
  };

  dispose() {
    this.disposed = true;
    this.faceTracker?.stop();
    this.handTracker?.stop();
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerUp);
    canvas.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onWindowBlur);
    this.controls.dispose();
    this.dofPass.dispose();
    this.composer.dispose();
    this.clothGeometry.dispose();
    this.holoMaterial.dispose();
    this.surface.dispose();
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry && mesh.geometry !== this.clothGeometry) mesh.geometry.dispose();
    });
    this.renderer.dispose();
    canvas.remove();
  }
}
