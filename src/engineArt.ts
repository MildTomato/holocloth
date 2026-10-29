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

/** the slice of the engine's composition module used here */
type EngineModule = {
  createLayer(genId: string, params?: Record<string, unknown>): { seed: number };
  compositionSvg(comp: unknown, options: { transparent: boolean; frame: boolean; tick: number }): string;
};

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
): Promise<string> {
  const load = Object.values(ENGINE)[0];
  if (!load) throw new Error('the Visual Engine submodule is not checked out');
  const engine = (await load()) as EngineModule;
  const pick = ENGINE_SYSTEMS[system] ?? 'stacks';
  const layer = typeof pick === 'string' ? engine.createLayer(pick) : engine.createLayer(pick.gen, pick.params);
  layer.seed = seed;
  const cw = Math.round(box.w * DRAW_SCALE), ch = Math.round(box.h * DRAW_SCALE);
  const svg = engine.compositionSvg({
    version: 1,
    name: 'Card',
    canvas: { w: cw, h: ch, ratio: 'custom', bg: '#000000', transparent: true, resizeMode: 'recompose' },
    layers: [layer],
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
