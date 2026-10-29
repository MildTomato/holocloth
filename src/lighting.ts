import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/**
 * Lighting setups. Each is an environment (what the metal reflects and is
 * lit by: a room of glowing panels, rendered once into a PMREM) and up to
 * three direct lights for crisp specular. Studio is the original: the
 * neutral room with a cool rim, a warm rim and a white key.
 *
 * The camera looks down -z at the card, so panels toward +z (behind the
 * camera) are what a face-on card mirrors; panels to the sides catch it
 * as it turns.
 */
export const LIGHTING = ['Studio', 'Softbox', 'Strips', 'Window', 'Neon', 'Ring', 'Sunset', 'Supabase', 'Aurora', 'Green Neon'] as const;

/** Supabase green, #3ECF8E, as linear-ish light colour */
const GREEN: [number, number, number] = [0.24, 0.81, 0.56];

type DirLight = { color: THREE.ColorRepresentation; intensity: number; position: [number, number, number] };

/** the direct lights per setup; missing ones are off */
const LIGHTS: Record<string, DirLight[]> = {
  Studio: [
    { color: 0x7fd4ff, intensity: 1.1, position: [-4, 2.5, -3] },
    { color: 0xff9ad5, intensity: 0.9, position: [4.5, -1.5, -2.5] },
    { color: 0xffffff, intensity: 0.7, position: [1.5, 3, 4] },
  ],
  Softbox: [
    { color: 0xffffff, intensity: 1.2, position: [0.5, 5, 3] },
    { color: 0xf2f4ff, intensity: 0.3, position: [-3, 0, 4] },
  ],
  Strips: [
    { color: 0xffffff, intensity: 1.4, position: [-4, 1, -3] },
    { color: 0xffffff, intensity: 1.4, position: [4, 1, -3] },
    { color: 0xffffff, intensity: 0.25, position: [0, 2, 5] },
  ],
  Window: [
    { color: 0xffe9cc, intensity: 1.4, position: [-5, 2, 2.5] },
    { color: 0xcfe0ff, intensity: 0.25, position: [4, 0, 3] },
  ],
  Neon: [
    { color: 0xff2fa8, intensity: 1.6, position: [-4, 1, -2] },
    { color: 0x22d6ff, intensity: 1.6, position: [4, -0.5, -2] },
  ],
  Ring: [{ color: 0xffffff, intensity: 0.9, position: [0, 0.5, 5] }],
  Sunset: [
    { color: 0xff9a4d, intensity: 1.6, position: [-5, 0.6, 3] },
    { color: 0x5c7cff, intensity: 0.4, position: [4, 3, 1] },
  ],
  Supabase: [
    { color: 0x3ecf8e, intensity: 1.6, position: [-5, 0.6, 3] },
    { color: 0x1b6b8f, intensity: 0.4, position: [4, 3, 1] },
  ],
  Aurora: [
    { color: 0x6dffc0, intensity: 1.1, position: [-2, 5, 2] },
    { color: 0x2bb3c0, intensity: 0.8, position: [4, 2, -2] },
  ],
  'Green Neon': [
    { color: 0x3ecf8e, intensity: 1.6, position: [-4, 1, -2] },
    { color: 0xb6ff5c, intensity: 1.2, position: [4, -0.5, -2] },
  ],
};

/**
 * A sky: a colour overhead, a glowing horizon, dark ground, and a low sun
 * off to the front left.
 */
function sky(scene: THREE.Scene, top: THREE.Color, horizon: THREE.Color, ground: THREE.Color, sunColor: THREE.Color) {
  const dome = new THREE.SphereGeometry(15, 48, 24);
  const colors: number[] = [];
  const pos = dome.attributes.position;
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 15;
    if (y >= 0) c.copy(horizon).lerp(top, Math.pow(y, 0.45));
    else c.copy(horizon).lerp(ground, Math.min(1, -y * 4));
    colors.push(c.r, c.g, c.b);
  }
  dome.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  scene.add(new THREE.Mesh(dome, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const sun = new THREE.Mesh(new THREE.SphereGeometry(0.9, 24, 12), new THREE.MeshBasicMaterial({ color: sunColor }));
  sun.position.set(-8, 1, 7);
  scene.add(sun);
}

/** an emissive panel, brightness above 1 so it reads as a light source */
function panel(scene: THREE.Scene, w: number, h: number, color: [number, number, number], at: [number, number, number]) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(...color), side: THREE.DoubleSide }),
  );
  mesh.position.set(...at);
  mesh.lookAt(0, 0, 0);
  scene.add(mesh);
  return mesh;
}

/** the room itself: a box, its walls a flat dim tone */
function room(scene: THREE.Scene, tone: number) {
  scene.add(new THREE.Mesh(
    new THREE.BoxGeometry(30, 30, 30),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(tone, tone, tone), side: THREE.BackSide }),
  ));
}

const s = (k: number, rgb: [number, number, number]): [number, number, number] => [rgb[0] * k, rgb[1] * k, rgb[2] * k];

/** The scene each setup's environment is rendered from. */
function environmentScene(name: string): THREE.Scene {
  if (name === 'Studio') return new RoomEnvironment();
  const scene = new THREE.Scene();
  switch (name) {
    case 'Softbox': {
      // product photography: a big soft box in front, one overhead, two tall strips at the sides
      room(scene, 0.06);
      panel(scene, 7, 5, s(3, [1, 1, 1]), [0, 1.5, 7]);
      panel(scene, 9, 9, s(4, [1, 1, 1]), [0, 7, 1]);
      panel(scene, 1.4, 7, s(4, [1, 1, 1]), [-5, 0.5, 3]);
      panel(scene, 1.4, 7, s(4, [1, 1, 1]), [5, 0.5, 3]);
      break;
    }
    case 'Strips': {
      // a dark studio and hard strips: clean lines of light slide over the metal
      room(scene, 0.01);
      panel(scene, 0.5, 12, s(14, [1, 1, 1]), [-1.6, 0, 7]);
      panel(scene, 0.5, 12, s(14, [1, 1, 1]), [1.6, 0, 7]);
      panel(scene, 0.35, 12, s(10, [1, 1, 1]), [-5, 0, 3]);
      panel(scene, 0.35, 12, s(10, [1, 1, 1]), [5, 0, 3]);
      panel(scene, 10, 0.3, s(8, [1, 1, 1]), [0, 5, 4]);
      break;
    }
    case 'Window': {
      // one big daylight window, front left; a white bounce card to the right
      room(scene, 0.18);
      panel(scene, 6, 8, s(4.5, [1, 0.94, 0.86]), [-4.5, 1.5, 6]);
      panel(scene, 3, 4, s(0.9, [1, 1, 1]), [5, -0.5, 4]);
      break;
    }
    case 'Neon': {
      // a black room with coloured tubes: magenta and cyan in front, violet overhead
      room(scene, 0.01);
      panel(scene, 0.4, 10, s(10, [1, 0.1, 0.6]), [-2.2, 0, 6.5]);
      panel(scene, 0.4, 10, s(10, [0.1, 0.8, 1]), [2.2, 0, 6.5]);
      panel(scene, 0.3, 10, s(6, [1, 0.1, 0.6]), [-5, 0, 2]);
      panel(scene, 0.3, 10, s(6, [0.1, 0.8, 1]), [5, 0, 2]);
      panel(scene, 8, 0.3, s(7, [0.55, 0.3, 1]), [0, 5, 3]);
      break;
    }
    case 'Ring': {
      // a ring light behind the camera: a halo in every polished face
      room(scene, 0.05);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(2.2, 0.22, 16, 96),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 9, 9) }),
      );
      ring.position.set(0, 0, 7);
      ring.lookAt(0, 0, 0);
      scene.add(ring);
      break;
    }
    case 'Sunset': {
      // deep blue overhead, an orange horizon, a low sun
      sky(scene, new THREE.Color(0.04, 0.07, 0.2), new THREE.Color(2.4, 1.0, 0.35), new THREE.Color(0.03, 0.025, 0.03), new THREE.Color(30, 16, 6));
      break;
    }
    case 'Supabase': {
      // the sunset in Supabase green: dark teal overhead, a green horizon, a pale mint sun
      sky(scene, new THREE.Color(0.01, 0.05, 0.06), new THREE.Color(...s(3, GREEN)), new THREE.Color(0.01, 0.025, 0.02), new THREE.Color(14, 30, 20));
      break;
    }
    case 'Aurora': {
      // a dark room under curtains of green and teal light
      room(scene, 0.01);
      panel(scene, 14, 1.4, s(5, GREEN), [0, 6, 4]);
      panel(scene, 12, 0.9, s(4, [0.43, 1, 0.75]), [-1, 5, 7]);
      panel(scene, 10, 0.7, s(3.5, [0.17, 0.7, 0.75]), [1, 4, 1]);
      panel(scene, 6, 4, s(1.2, GREEN), [0, 0, 7.5]);
      break;
    }
    case 'Green Neon': {
      // tubes in Supabase green, mint and lime
      room(scene, 0.01);
      panel(scene, 0.4, 10, s(10, GREEN), [-2.2, 0, 6.5]);
      panel(scene, 0.4, 10, s(9, [0.71, 1, 0.36]), [2.2, 0, 6.5]);
      panel(scene, 0.3, 10, s(7, [0.43, 1, 0.75]), [-5, 0, 2]);
      panel(scene, 0.3, 10, s(7, GREEN), [5, 0, 2]);
      panel(scene, 8, 0.3, s(6, [0.43, 1, 0.75]), [0, 5, 3]);
      break;
    }
  }
  return scene;
}

/**
 * Builds and keeps each setup's environment (made once, on first use), and
 * points the direct lights for it.
 */
export class Lighting {
  private envs = new Map<string, THREE.Texture>();
  readonly lights: THREE.DirectionalLight[] = [0, 1, 2].map(() => new THREE.DirectionalLight());
  current = '';

  constructor(private renderer: THREE.WebGLRenderer) {}

  /** set up `name`; returns its environment for scene.environment */
  use(name: string): THREE.Texture {
    const setup = LIGHTS[name] ? name : 'Studio';
    this.current = setup;
    let env = this.envs.get(setup);
    if (!env) {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const scene = environmentScene(setup);
      env = pmrem.fromScene(scene, 0.04).texture;
      pmrem.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        (m.material as THREE.Material | undefined)?.dispose?.();
      });
      this.envs.set(setup, env);
    }
    this.lights.forEach((light, i) => {
      const d = LIGHTS[setup][i];
      light.visible = !!d;
      if (!d) return;
      light.color.set(d.color);
      light.intensity = d.intensity;
      light.position.set(...d.position);
    });
    return env;
  }

  dispose() {
    for (const env of this.envs.values()) env.dispose();
    this.envs.clear();
  }
}
