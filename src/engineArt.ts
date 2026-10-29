/**
 * Artwork from the Visual Engine — the visual-engine-generator submodule:
 * one of its systems drawn into the page's margin and printed in ink, so it
 * etches like the rest of the artwork. The submodule is private, so it's
 * only found when it's checked out; a build without it (Vercel) still works
 * and simply doesn't offer it.
 */
const ENGINE = import.meta.glob('../visual-engine-generator/src/engine/composition.ts');

/** wireframes in white, so they print (the engine's own line colour is near-black) */
const WIRE = { render: 'wire', wireColor: '#FFFFFF', wireWidth: 1.2 };

/**
 * The engine's systems that draw a still image on their own, by name: a
 * generator, and the settings that differ from its defaults.
 */
export const ENGINE_SYSTEMS: Record<string, string | { gen: string; params: Record<string, unknown> }> = {
  'Twist Wireframe': { gen: 'stacks', params: { ...WIRE, mode: 'twist' } },
  'Circle Wireframe': { gen: 'stacks', params: { ...WIRE, mode: 'circle' } },
  'Stack Wireframe': { gen: 'stacks', params: { ...WIRE, mode: 'stack' } },
  'Pyramid Wireframe': { gen: 'stacks', params: { ...WIRE, mode: 'pyramid' } },
  'Stacks': 'stacks',
  'Radial Burst': 'radial',
  'Abstract Diagrams': 'diagrams',
  'Orbital Structures': 'orbital',
  'Galaxy Diagram': 'galaxy',
  'Abstract Cosmos': 'cosmos',
  'Scattered Patterns': 'scatter',
  'Shape Masks': 'masks',
  'Striation': 'striation',
  'Typographic Scatter': 'typo',
  'Block Grid': 'grid',
  'Grid Systems': 'gridsys',
  'Dotted Grid': 'dotgrid',
  '3D Space': 'space3d',
};

export const ENGINE_AVAILABLE = Object.keys(ENGINE).length > 0;

/** the slice of the engine used here */
type EngineLayer = {
  seed: number;
  opacity: number;
  tf: { x: number; y: number; scale: number; rot: number };
  clip: { mode: string; x: number; y: number; w: number; h: number; rot: number };
};
type EngineModule = {
  createLayer(genId: string, params?: Record<string, unknown>): EngineLayer;
  compositionSvg(comp: unknown, options: { transparent: boolean; frame: boolean; tick: number }): string;
};
type RandomizeModule = {
  randomizeLayer(layer: EngineLayer, mode: 'explore', seed: number): EngineLayer;
};
const RANDOMIZE = import.meta.glob('../visual-engine-generator/src/engine/randomize.ts');

/** systems that print as solid masses: pickable, but kept out of Random, which stays linework */
const HEAVY = new Set(['Stacks', 'Striation']);

/** Random: a few systems layered, each with its settings explored, from one seed */
export const ENGINE_RANDOM = 'Random';

/** seeded 0..1 */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const layerFor = (engine: EngineModule, name: string) => {
  const pick = ENGINE_SYSTEMS[name] ?? 'stacks';
  return typeof pick === 'string' ? engine.createLayer(pick) : engine.createLayer(pick.gen, pick.params);
};

/**
 * Random layers: the first fills the page; each one over it is moved,
 * scaled and turned, sometimes clipped to a shape, and a little lighter —
 * the engine's own layering, chosen by the seed.
 */
async function randomLayers(engine: EngineModule, seed: number, count: number) {
  const { randomizeLayer } = (await Object.values(RANDOMIZE)[0]()) as RandomizeModule;
  const r = rng(seed);
  const names = Object.keys(ENGINE_SYSTEMS).filter((n) => !HEAVY.has(n));
  const clips = ['circle', 'ellipse', 'rect', 'triangle'];
  const layers: EngineLayer[] = [];
  for (let i = 0; i < count; i++) {
    let layer = layerFor(engine, names[Math.floor(r() * names.length)]);
    // Explore: bigger jumps in geometry, density and distribution; colour kept
    layer = randomizeLayer(layer, 'explore', Math.floor(r() * 1e9));
    if (i > 0) {
      layer.tf = {
        x: Math.round((r() - 0.5) * 30) / 100,
        y: Math.round((r() - 0.5) * 40) / 100,
        scale: Math.round((0.45 + r() * 0.7) * 100) / 100,
        rot: r() < 0.5 ? 0 : Math.round((r() - 0.5) * 90),
      };
      layer.opacity = Math.round((0.55 + r() * 0.45) * 100) / 100;
      if (r() < 0.4) {
        layer.clip = {
          mode: clips[Math.floor(r() * clips.length)],
          x: 0.3 + r() * 0.4, y: 0.3 + r() * 0.4, w: 0.35 + r() * 0.45, h: 0.35 + r() * 0.45, rot: Math.round(r() * 90),
        };
      }
    }
    layers.push(layer);
  }
  return layers;
}

/**
 * The engine drew for a canvas around 1350px on its long edge; drawn at half
 * the page's size and scaled up, its hairlines keep their weight on the card.
 */
const DRAW_SCALE = 0.5;

/**
 * One engine system as page linework in a box. The engine draws light marks
 * on black; here brightness becomes ink, so its quiet dark guides fall away
 * and its bright marks print.
 */
export async function engineLinework(
  system: string,
  seed: number,
  box: { x: number; y: number; w: number; h: number },
  /** how many layers Random draws */
  count = 3,
): Promise<string> {
  const load = Object.values(ENGINE)[0];
  if (!load) throw new Error('the Visual Engine submodule is not checked out');
  const engine = (await load()) as EngineModule;
  let layers: EngineLayer[];
  if (system === ENGINE_RANDOM) {
    layers = await randomLayers(engine, seed, count);
  } else {
    const layer = layerFor(engine, system);
    layer.seed = seed;
    layers = [layer];
  }
  const cw = Math.round(box.w * DRAW_SCALE), ch = Math.round(box.h * DRAW_SCALE);
  const svg = engine.compositionSvg({
    version: 1,
    name: 'Card',
    canvas: { w: cw, h: ch, ratio: 'custom', bg: '#000000', transparent: true, resizeMode: 'recompose' },
    layers,
    active: null,
  }, { transparent: true, frame: false, tick: 0 });
  const inner = svg.slice(svg.indexOf('>') + 1, svg.lastIndexOf('</svg>'));
  return `<defs>
    <filter id="engine-ink" color-interpolation-filters="sRGB">
      <feColorMatrix type="matrix" values="0 0 0 0 0.102  0 0 0 0 0.102  0 0 0 0 0.102  0.42 0.82 0.16 0 0"/>
    </filter>
  </defs>
  <g filter="url(#engine-ink)" fill="#000" stroke="none" stroke-width="1">
    <svg x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" viewBox="0 0 ${cw} ${ch}">${inner}</svg>
  </g>`;
}
