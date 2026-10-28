import * as THREE from 'three';
import { MAX_PLATES, StackAnimator, type StackParams } from './cardStack.ts';

const THICKNESS = 0.045;
const plateM = new THREE.Matrix4();
/** the printed face sits a hair proud of the slab, so the two never z-fight */
const FACE_LIFT = 0.0004;
const CORNER_SEGMENTS = 10;
/** a small 45° chamfer where face meets side: the facet that glints as the card turns */
const CHAMFER = 0.006;

/** card outline: a rectangle with rounded corners (radius 0 = sharp), centred */
function cardOutline(width: number, height: number, radius: number) {
  const r = Math.min(Math.max(radius, 0), width / 2, height / 2);
  const x = -width / 2, y = -height / 2;
  const s = new THREE.Shape();
  s.moveTo(x + r, y);
  s.lineTo(x + width - r, y);
  if (r > 0) s.quadraticCurveTo(x + width, y, x + width, y + r);
  s.lineTo(x + width, y + height - r);
  if (r > 0) s.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  s.lineTo(x + r, y + height);
  if (r > 0) s.quadraticCurveTo(x, y + height, x, y + height - r);
  s.lineTo(x, y + r);
  if (r > 0) s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** radians of spin per pixel dragged */
const SPIN_PER_PX = 0.008;
/** fastest spin a flick can give it, rad/s — a lively few turns, not a blur */
const MAX_SPIN = 14;
/** how quickly a flung card slows, per second */
const SPIN_DRAG = 2.2;
/** below this speed (rad/s) the card eases back to face-on */
const SETTLE_BELOW = 1.5;
const SETTLE_RATE = 3;

/**
 * The artwork as a rigid metal card: a thin slab cut square at the edges,
 * art on polished, lacquered metal with a thin-film flash on the front;
 * brushed metal on the back and satin, machined edges. The linework is
 * printed, or etched into the metal. Drag to spin; it keeps turning, slows,
 * then settles face-on (front or back) and floats.
 */
export class MetalCard {
  readonly group = new THREE.Group();
  /** the metal slab: back and edges */
  readonly slab: THREE.Mesh<THREE.ExtrudeGeometry, THREE.Material[]>;
  /** the printed face — the only part stickers and the artwork live on */
  readonly face: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshPhysicalMaterial>;
  /** the stack's plates: every copy of the card, drawn instanced */
  readonly stackSlab: THREE.InstancedMesh<THREE.ExtrudeGeometry, THREE.Material[]>;
  readonly stackFace: THREE.InstancedMesh<THREE.ShapeGeometry, THREE.MeshPhysicalMaterial>;
  dragging = false;

  private stack = new StackAnimator();
  private stackParams: StackParams = { shape: 'Single', count: 48, twist: 0.5, spacing: 0.4, flow: 0 };
  private front: THREE.MeshPhysicalMaterial;
  private metal: THREE.MeshPhysicalMaterial;
  private edge: THREE.MeshPhysicalMaterial;
  private size = { w: 2, h: 3 };
  private corner = 0.04;
  private stickerMap: { value: THREE.Texture };
  /** how the artwork's linework is applied: printed, or etched into the metal */
  private etch = {
    uEtchMode: { value: 0 },
    uEtchDepth: { value: 0.5 },
    uEtchBevel: { value: 1 },
    uMapTexel: { value: new THREE.Vector2(1 / 2048, 1 / 3072) },
  };
  private rot = { x: 0, y: 0 };
  /** an exact angle (and offset) held by the cinematic reel; null = spin and settle */
  private posed: THREE.Euler | null = null;
  private posedAt = new THREE.Vector3();
  private vel = { x: 0, y: 0 };

  constructor(surface: THREE.Texture, stickers: THREE.Texture) {
    this.stickerMap = { value: stickers };
    this.front = new THREE.MeshPhysicalMaterial({
      map: surface,
      metalness: 0.85,
      roughness: 0.3,
      clearcoat: 1,
      clearcoatRoughness: 0.12,
      iridescence: 0.5,
      iridescenceIOR: 1.4,
      iridescenceThicknessRange: [180, 520],
    });
    this.front.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.etch, { uStickerMap: this.stickerMap });
      // helpers go after map_pars_fragment, where the artwork's map sampler is declared
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_pars_fragment>', /* glsl */ `#include <map_pars_fragment>
        uniform sampler2D uStickerMap;
        uniform float uEtchMode;   // 0 printed, 1 etched (bare metal), 2 etched + filled
        uniform float uEtchDepth;
        uniform float uEtchBevel;  // groove shoulder width, in artwork texels
        uniform vec2 uMapTexel;

        // how much of the artwork's dark linework is under uv
        float cardInkAt(vec2 uv) {
          float lum = dot(texture2D(map, uv).rgb, vec3(0.299, 0.587, 0.114));
          return 1.0 - smoothstep(0.12, 0.4, lum);
        }

        // tilt the normal by a height gradient measured across the artwork
        // (per uv), not across screen pixels — smooth, so fine lines don't
        // bead. The face is flat, so this tangent frame is exact.
        vec3 cardEtchPerturb(vec3 surfPos, vec3 surfNorm, vec2 uv, vec2 dHduv) {
          vec3 q0 = dFdx(surfPos), q1 = dFdy(surfPos);
          vec2 st0 = dFdx(uv), st1 = dFdy(uv);
          vec3 q1perp = cross(q1, surfNorm), q0perp = cross(surfNorm, q0);
          vec3 T = q1perp * st0.x + q0perp * st1.x;
          vec3 B = q1perp * st0.y + q0perp * st1.y;
          float det = max(dot(T, T), dot(B, B));
          float scale = det == 0.0 ? 0.0 : inversesqrt(det);
          return normalize(surfNorm - (dHduv.x * T + dHduv.y * B) * scale);
        }
      `)
        .replace('#include <map_fragment>', /* glsl */ `#include <map_fragment>
          float cardSticker = 0.0;
          float cardInk = 0.0;    // the artwork's linework
          float cardEtchH = 0.0;  // groove depth, 0..1
          vec2 cardEtchGrad = vec2(0.0);  // its slope across the artwork
          bool cardEtched = uEtchMode > 0.5;
          bool cardBare = cardEtched && uEtchMode < 1.5;
          {
            cardInk = cardInkAt(vMapUv);
            if (cardEtched) {
              // the groove's walls are as wide as the bevel: its slope is the
              // change in ink across that width
              vec2 o = uMapTexel * uEtchBevel;
              float l = cardInkAt(vMapUv - vec2(o.x, 0.0)), r = cardInkAt(vMapUv + vec2(o.x, 0.0));
              float d = cardInkAt(vMapUv - vec2(0.0, o.y)), u = cardInkAt(vMapUv + vec2(0.0, o.y));
              cardEtchH = max(cardInk, 0.25 * (l + r + d + u));
              cardEtchGrad = vec2(r - l, u - d) * 0.5;
            }
            // etched bare: the groove shows the plate itself, a cool silver,
            // shadowed inside the cut so each line reads as one line
            if (cardBare) {
              float shade = 1.0 - 0.55 * cardEtchH * clamp(uEtchDepth * 1.5, 0.0, 1.0);
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.56, 0.6) * shade, cardInk);
            }
            // stickers sit on top of everything
            vec4 stk = texture2D(uStickerMap, vMapUv);
            cardSticker = stk.a;
            diffuseColor.rgb = mix(diffuseColor.rgb, stk.rgb, stk.a);
          }`)
        // printed or filled ink is matte paint; a bare etched groove is frosted metal
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = cardBare
            ? mix(mix(roughnessFactor, 0.5, cardInk), 0.55, cardSticker * 0.5)
            : mix(roughnessFactor, 0.55, max(cardInk, cardSticker * 0.5));`)
        .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
          metalnessFactor = mix(metalnessFactor, 0.0, cardBare ? cardSticker : max(cardInk, cardSticker));`)
        // the groove: its shoulders bend the light, so the cut catches it as the card turns
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          if (cardEtched && uEtchDepth > 0.0) {
            // a cut: height falls into the ink, so the slope points out of it
            vec2 dHduv = -cardEtchGrad * uEtchDepth * 0.08 * (1.0 - cardSticker);
            normal = cardEtchPerturb(-vViewPosition, normal, vMapUv, dHduv / uMapTexel);
          }`)
        .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
          #ifdef USE_IRIDESCENCE
            material.iridescence *= 1.0 - max(cardInk, cardSticker);
          #endif`);
    };
    const metal = (this.metal = new THREE.MeshPhysicalMaterial({
      color: '#c3c8cf',
      metalness: 1,
      roughness: 0.38,
      anisotropy: 0.8,
      clearcoat: 0.3,
      clearcoatRoughness: 0.3,
    }));
    // machined edges: square-cut and chamfered, polished metal brushed along the edge
    this.edge = new THREE.MeshPhysicalMaterial({
      color: '#c9ced6',
      metalness: 1,
      roughness: 0.22,
      anisotropy: 0.8,
      clearcoat: 0.2,
      clearcoatRoughness: 0.15,
    });
    // extrude groups: 0 = the two caps (metal), 1 = the sides (edge)
    this.slab = new THREE.Mesh(new THREE.ExtrudeGeometry(), [metal, this.edge]);
    this.face = new THREE.Mesh(new THREE.ShapeGeometry(), this.front);
    this.stackSlab = new THREE.InstancedMesh(this.slab.geometry, [metal, this.edge], MAX_PLATES);
    this.stackFace = new THREE.InstancedMesh(this.face.geometry, this.front, MAX_PLATES);
    for (const m of [this.stackSlab, this.stackFace]) {
      m.count = 0;
      m.visible = false;
      // the formation moves every frame: cheaper to draw it than to cull it
      m.frustumCulled = false;
    }
    this.group.add(this.slab, this.face, this.stackSlab, this.stackFace);
    this.group.visible = false;
    this.rebuild();
  }

  /** Match the cloth's size (it follows the artwork's shape). */
  setSize(width: number, height: number) {
    if (width === this.size.w && height === this.size.h) return;
    this.size = { w: width, h: height };
    this.rebuild();
  }

  get dims() {
    return this.size;
  }

  /** Hold an exact angle (the cinematic reel drives it); null hands it back to spin and settle. */
  setPose(rot: THREE.Euler | null, at?: THREE.Vector3) {
    if (rot) {
      this.posed = rot;
      this.posedAt.copy(at ?? new THREE.Vector3());
      return;
    }
    if (this.posed) {
      this.rot = { x: this.posed.x, y: this.posed.y };
      this.vel = { x: 0, y: 0 };
      this.posed = null;
    }
  }

  /** Corner rounding in world units; 0 is a sharp rectangle. Edges stay square-cut. */
  setCorner(radius: number) {
    if (radius === this.corner) return;
    this.corner = radius;
    this.rebuild();
  }

  private rebuild() {
    const { w, h } = this.size;
    const outline = cardOutline(w, h, this.corner);
    // the slab: straight sides with a one-step chamfer at each face, centred
    // on z. The negative offset keeps the sides on the outline, so the
    // chamfer cuts inward and the card stays its full size.
    const slab = new THREE.ExtrudeGeometry(outline, {
      depth: THICKNESS - 2 * CHAMFER,
      curveSegments: CORNER_SEGMENTS,
      bevelEnabled: true,
      bevelThickness: CHAMFER,
      bevelSize: CHAMFER,
      bevelOffset: -CHAMFER,
      bevelSegments: 1,
    });
    slab.translate(0, 0, -(THICKNESS / 2 - CHAMFER));
    // the face: the outline inside the chamfer, uv 0..1 across the whole card
    // so the artwork keeps its place
    const inner = cardOutline(w - 2 * CHAMFER, h - 2 * CHAMFER, Math.max(0, this.corner - CHAMFER));
    const face = new THREE.ShapeGeometry(inner, CORNER_SEGMENTS);
    const pos = face.attributes.position;
    const uv = face.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / h + 0.5);
    }
    face.translate(0, 0, THICKNESS / 2 + FACE_LIFT);
    this.slab.geometry.dispose();
    this.face.geometry.dispose();
    this.slab.geometry = slab;
    this.face.geometry = face;
    if (this.stackSlab) {
      this.stackSlab.geometry = slab;
      this.stackFace.geometry = face;
    }
  }

  /** Copies of the card arranged into a formation (Single = just the card); Cycle moves through them all. */
  setStack(params: StackParams) {
    this.stackParams = { ...params, count: Math.round(THREE.MathUtils.clamp(params.count, 2, MAX_PLATES)) };
    // One (or an old link's Single) folds the plates back into one card
    this.stack.setTarget(params.cards !== 'Stack' ? 'Single' : params.shape);
  }

  /** whether the card is showing as a formation of plates (not a single card) */
  get stacked() {
    return !this.stack.collapsed;
  }

  /** Which plate a raycast hit, or null. */
  plateAt(hit: THREE.Intersection | null) {
    if (!hit || hit.instanceId === undefined) return null;
    return hit.object === this.stackSlab || hit.object === this.stackFace ? hit.instanceId : null;
  }

  /** Pull a plate out to the front (null puts it back); the card stops spinning meanwhile. */
  focusPlate(i: number | null) {
    this.stack.setFocus(i);
    if (i !== null) this.vel = { x: 0, y: 0 };
  }

  get focusedPlate() {
    return this.stack.focused;
  }

  /** Where a pulled-out plate sits, and which way it faces, in world space. */
  plateSpot(position: THREE.Vector3, normal: THREE.Vector3, up: THREE.Vector3) {
    this.group.updateWorldMatrix(true, false);
    position.copy(this.stack.front).applyMatrix4(this.group.matrixWorld);
    normal.set(0, 0, 1).transformDirection(this.group.matrixWorld);
    up.set(0, 1, 0).transformDirection(this.group.matrixWorld);
  }

  /** how many plates the stack is drawing */
  get plateCount() {
    return this.stackParams.count;
  }

  /**
   * A point on plate i's face, (u, v) from its middle in fractions of the
   * card (-0.5..0.5), and the face's normal — in world space, as it is now.
   */
  platePoint(i: number, u: number, v: number, point: THREE.Vector3, normal: THREE.Vector3) {
    this.group.updateWorldMatrix(true, false);
    this.stackSlab.getMatrixAt(i, plateM);
    plateM.premultiply(this.group.matrixWorld);
    const { w, h } = this.size;
    point.set(u * w, v * h, THICKNESS / 2).applyMatrix4(plateM);
    normal.set(0, 0, 1).transformDirection(plateM);
  }

  /** Where a world point lies on plate i, in fractions of the card from its middle. */
  plateUv(i: number, point: THREE.Vector3) {
    this.group.updateWorldMatrix(true, false);
    this.stackSlab.getMatrixAt(i, plateM);
    plateM.premultiply(this.group.matrixWorld).invert();
    const local = point.clone().applyMatrix4(plateM);
    return { u: local.x / this.size.w, v: local.y / this.size.h };
  }

  /** The solid metal that's showing — the card, or the stack's plates — for aiming rays at. */
  get solid(): THREE.Object3D {
    return this.stacked ? this.stackSlab : this.slab;
  }

  /** whether a hit landed on the card's printed face (the card's own, or a plate's) */
  isFace(object: THREE.Object3D) {
    return object === this.face || object === this.stackFace;
  }

  /** The surface textures are recreated when the artwork's shape changes. */
  setTextures(surface: THREE.Texture, stickers: THREE.Texture) {
    this.front.map = surface;
    this.stickerMap.value = stickers;
    const img = surface.image as { width?: number; height?: number } | undefined;
    if (img?.width && img.height) this.etch.uMapTexel.value.set(1 / img.width, 1 / img.height);
  }

  /**
   * Linework printed on the metal, or etched into it: bare (the groove shows
   * frosted plate) or filled with matte black. Depth 0..1; bevel is the
   * groove's shoulder width in artwork texels.
   */
  setEtch(ink: string, depth: number, bevel: number) {
    this.etch.uEtchMode.value = ink === 'Etched' ? 1 : ink === 'Etched + filled' ? 2 : 0;
    this.etch.uEtchDepth.value = depth;
    this.etch.uEtchBevel.value = bevel;
  }

  /**
   * The cloth's surface detail — its scratch bump map (tiled by Bump
   * Tiling, which lives on the shared texture) and grain roughness — so the
   * card has the same texture. The back and edges take a lighter dose.
   */
  setDetail(normalMap: THREE.Texture | null, roughnessMap: THREE.Texture | null) {
    for (const m of [this.front, this.metal, this.edge]) {
      const changed = !!m.normalMap !== !!normalMap || !!m.roughnessMap !== !!roughnessMap;
      m.normalMap = normalMap;
      m.roughnessMap = roughnessMap;
      // map presence changes the shader program
      if (changed) m.needsUpdate = true;
    }
  }

  setBump(strength: number) {
    this.front.normalScale.set(strength, strength);
    this.metal.normalScale.set(strength * 0.5, strength * 0.5);
    // the edges carry the full scratches, like the face
    this.edge.normalScale.set(strength, strength);
  }

  /** Spin by a pointer drag of (dx, dy) pixels over dt seconds. */
  drag(dx: number, dy: number, dt: number) {
    this.rot.y += dx * SPIN_PER_PX;
    this.rot.x += dy * SPIN_PER_PX;
    this.vel.y = THREE.MathUtils.clamp((dx * SPIN_PER_PX) / dt, -MAX_SPIN, MAX_SPIN);
    this.vel.x = THREE.MathUtils.clamp((dy * SPIN_PER_PX) / dt, -MAX_SPIN, MAX_SPIN);
  }

  update(dt: number, time: number) {
    this.updateStack(dt);
    if (this.posed) {
      this.group.rotation.copy(this.posed);
      this.group.position.copy(this.posedAt);
      return;
    }
    if (!this.dragging) {
      this.rot.x += this.vel.x * dt;
      this.rot.y += this.vel.y * dt;
      const slow = Math.exp(-SPIN_DRAG * dt);
      this.vel.x *= slow;
      this.vel.y *= slow;
      if (Math.hypot(this.vel.x, this.vel.y) < SETTLE_BELOW) {
        // face-on again, front or back, whichever is nearer; and level
        const ease = 1 - Math.exp(-SETTLE_RATE * dt);
        this.rot.y += (Math.round(this.rot.y / Math.PI) * Math.PI - this.rot.y) * ease;
        this.rot.x += (0 - this.rot.x) * ease;
      }
    }
    this.group.rotation.set(this.rot.x, this.rot.y, 0);
    // a slow float, so it never looks parked
    this.group.position.y = Math.sin(time * 0.9) * 0.04;
  }

  private updateStack(dt: number) {
    const { w, h } = this.size;
    // a pulled-out plate past the end of a shrunk stack goes back
    const f = this.stack.focused;
    if (f !== null && f >= this.stackParams.count) this.stack.setFocus(null);
    this.stack.update(dt, [this.stackSlab, this.stackFace], this.stackParams.count, w, h, THICKNESS, this.stackParams);
    // settled on one card: draw the card itself
    const single = this.stack.collapsed;
    this.slab.visible = this.face.visible = single;
    this.stackSlab.visible = this.stackFace.visible = !single;
  }
}
