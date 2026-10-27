import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const THICKNESS = 0.045;
const RADIUS = 0.09;
const SEGMENTS = 6;
/** box geometry face groups: +x, -x, +y, -y, +z (front), -z (back) */
export const CARD_FRONT = 4;

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
 * The artwork as a rigid metal card: a thin rounded slab, art printed on
 * polished, lacquered metal with a thin-film flash on the front; bare
 * brushed metal on the back and edges. Dark ink and stickers read as matte
 * print on the metal, not chrome. Drag to spin; it keeps turning, slows,
 * then settles face-on (front or back) and floats.
 */
export class MetalCard {
  readonly group = new THREE.Group();
  readonly mesh: THREE.Mesh<RoundedBoxGeometry, THREE.Material[]>;
  dragging = false;

  private front: THREE.MeshPhysicalMaterial;
  private metal: THREE.MeshPhysicalMaterial;
  private stickerMap: { value: THREE.Texture };
  private rot = { x: 0, y: 0 };
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
      shader.uniforms.uStickerMap = this.stickerMap;
      shader.fragmentShader = 'uniform sampler2D uStickerMap;\n' + shader.fragmentShader
        .replace('#include <map_fragment>', /* glsl */ `#include <map_fragment>
          // stickers on top; dark ink and stickers are matte print, not metal
          float cardSticker = 0.0;
          float cardInk = 0.0;
          {
            vec4 stk = texture2D(uStickerMap, vMapUv);
            cardSticker = stk.a;
            diffuseColor.rgb = mix(diffuseColor.rgb, stk.rgb, stk.a);
            float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
            cardInk = 1.0 - smoothstep(0.12, 0.4, lum);
          }`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = mix(roughnessFactor, 0.55, max(cardInk, cardSticker * 0.5));`)
        .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
          metalnessFactor = mix(metalnessFactor, 0.0, max(cardInk, cardSticker));`)
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
    this.mesh = new THREE.Mesh(
      new RoundedBoxGeometry(2, 3, THICKNESS, SEGMENTS, RADIUS),
      [metal, metal, metal, metal, this.front, metal],
    );
    this.group.add(this.mesh);
    this.group.visible = false;
  }

  /** Match the cloth's size (it follows the artwork's shape). */
  setSize(width: number, height: number) {
    this.mesh.geometry.dispose();
    this.mesh.geometry = new RoundedBoxGeometry(width, height, THICKNESS, SEGMENTS, RADIUS);
  }

  /** The surface textures are recreated when the artwork's shape changes. */
  setTextures(surface: THREE.Texture, stickers: THREE.Texture) {
    this.front.map = surface;
    this.stickerMap.value = stickers;
  }

  /**
   * The cloth's surface detail — its scratch bump map (tiled by Bump
   * Tiling, which lives on the shared texture) and grain roughness — so the
   * card has the same texture. The back and edges take a lighter dose.
   */
  setDetail(normalMap: THREE.Texture | null, roughnessMap: THREE.Texture | null) {
    for (const m of [this.front, this.metal]) {
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
  }

  /** Spin by a pointer drag of (dx, dy) pixels over dt seconds. */
  drag(dx: number, dy: number, dt: number) {
    this.rot.y += dx * SPIN_PER_PX;
    this.rot.x += dy * SPIN_PER_PX;
    this.vel.y = THREE.MathUtils.clamp((dx * SPIN_PER_PX) / dt, -MAX_SPIN, MAX_SPIN);
    this.vel.x = THREE.MathUtils.clamp((dy * SPIN_PER_PX) / dt, -MAX_SPIN, MAX_SPIN);
  }

  update(dt: number, time: number) {
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
}
