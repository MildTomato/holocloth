/**
 * Variations on the construction drawing, built by its rules — never by
 * scattering. A row is the original's frame: squares side by side on one
 * centre line, guides at every unit, a midline between the end-circle
 * centres, circles tangent to each end. Rows can halve their unit (2, 4, 8
 * squares across the same frame width), so stacked rows meet edge to edge
 * as a power-of-two grid. Each square holds one figure from the original:
 * an inscribed circle, a half-width ellipse in its left or right half, or
 * nothing but its guides.
 */

export interface GridOptions {
  /** frames stacked edge to edge */
  rows: number;
  /** how many times a row may halve its unit (0 = all rows at full size) */
  depth: number;
  /** 0..1 share of squares that get a figure */
  fill: number;
  /** circles tangent to both ends of each row */
  endCircles: boolean;
  /** unit guides and the midline */
  guides: boolean;
  seed: number;
}

// same page, unit and line as public/artwork/construction.svg
const W = 2000;
const H = 3000;
const UNIT = 229;
/** the original's frame: two squares, 4 units by 2 */
const FRAME_W = 4 * UNIT;
const STROKE = '#1a1a1a';
const STROKE_W = 2;
/** the margin rule between the labels (see MARGIN_MARKS) */
const RULE_X = 100;
const RULE_BOTTOM = 2826;
/** Growth's outer square: full width, 7 x 256 so every halving stays on whole pixels */
const GROWTH_SIDE = 1792;

/** small, fast, seedable PRNG so a seed always gives the same drawing */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f = (n: number) => +n.toFixed(1);
const line = (x1: number, y1: number, x2: number, y2: number) =>
  `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}"/>`;
const circle = (cx: number, cy: number, r: number) =>
  `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}"/>`;
const ellipse = (cx: number, cy: number, rx: number, ry: number) =>
  `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(ry)}"/>`;

type Figure = 'circle' | 'ellipseL' | 'ellipseR' | 'none';

/** One square's figure, weighted toward the original's circles. */
function pickFigure(r: number, fill: number): Figure {
  if (r >= fill) return 'none';
  const t = r / fill;
  return t < 0.5 ? 'circle' : t < 0.75 ? 'ellipseL' : 'ellipseR';
}

/** Linework only, in page coordinates. */
export function gridLinework(o: GridOptions): string {
  const rand = mulberry32(o.seed);
  const rows = Math.max(1, Math.round(o.rows));
  const depth = Math.max(0, Math.round(o.depth));

  // the first row is always full size, like the original; each later row
  // keeps the unit or halves it once more, so the scale steps down as a
  // progression instead of jumping
  const scales: number[] = [0];
  for (let i = 1; i < rows; i++) {
    const prev = scales[i - 1];
    scales.push(prev < depth && rand() < 0.5 ? prev + 1 : prev);
  }
  const units = scales.map((k) => UNIT / 2 ** k);
  const totalH = units.reduce((t, s) => t + 2 * s, 0);

  const x0 = (W - FRAME_W) / 2;
  let y = (H - totalH) / 2;
  const out: string[] = [];

  for (const s of units) {
    const cy = y + s;
    const squares = Math.round(FRAME_W / (2 * s));
    const figures: Figure[] = Array.from({ length: squares }, () => pickFigure(rand(), o.fill));
    // never an empty frame: the original always has something to look at
    if (!figures.some((fig) => fig !== 'none')) {
      figures[Math.floor(rand() * squares)] = 'circle';
    }

    if (o.guides) {
      const reach = o.endCircles ? s : 0;
      out.push(line(x0 - reach, cy, x0 + FRAME_W + reach, cy));
      for (let u = 1; u < squares * 2; u++) out.push(line(x0 + u * s, y, x0 + u * s, y + 2 * s));
    }
    if (o.endCircles) {
      out.push(circle(x0 - s, cy, s));
      out.push(circle(x0 + FRAME_W + s, cy, s));
    }
    figures.forEach((fig, i) => {
      const sx = x0 + i * 2 * s;
      if (fig === 'circle') out.push(circle(sx + s, cy, s));
      else if (fig === 'ellipseL') out.push(ellipse(sx + s / 2, cy, s / 2, s));
      else if (fig === 'ellipseR') out.push(ellipse(sx + (3 * s) / 2, cy, s / 2, s));
    });
    out.push(`<rect x="${f(x0)}" y="${f(y)}" width="${f(FRAME_W)}" height="${f(2 * s)}"/>`);
    y += 2 * s;
  }
  return out.join('\n    ');
}

/** Corner labels and the margin rule between them — identical in construction.svg. */
const MARGIN_MARKS = `<g fill="#1a1a1a" stroke="none" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="44" font-weight="300" letter-spacing="0.5">
    <text x="100" y="132">Petabyte</text>
    <text x="100" y="2900">Prototype</text>
  </g>
  <line x1="100" y1="176" x2="100" y2="2826" stroke="#1a1a1a" stroke-width="2"/>`;

/** Full page: the colour field (as a data URL) under the generated linework. */
export function gridSvg(o: GridOptions, fieldDataUrl: string): string {
  return pageSvg(gridLinework(o), fieldDataUrl);
}

/**
 * Prototype to Petabyte, as a recursive L-tiling. A square splits into a
 * quarter-size square in its bottom-left corner plus an L of three squares
 * around it; the inner square splits the same way, and so on — a
 * power-of-two grid zooming into one corner. That corner sits on the foot of
 * the margin rule over "Prototype"; the outermost squares span the page.
 *
 * The original illustration lives in every L: the top two squares are its
 * 2:1 frame, with the half-width ellipse in square one's right half, the
 * circle in square two, the quarter line and the midline. The third square,
 * below, is that pair mirrored across the diagonal — the ellipse lies down
 * in its top half and the guides turn with it — so each L is symmetric about
 * the line from Prototype to the far corner without drawing it. The
 * innermost square holds a single circle: the seed.
 */
export function growthLinework(o: Pick<GridOptions, 'rows' | 'guides'>): string {
  const levels = Math.min(8, Math.max(2, Math.round(o.rows)));
  const x0 = RULE_X;
  const y1 = RULE_BOTTOM;
  const out: string[] = [];
  const square = (x: number, y: number, side: number) =>
    `<rect x="${f(x)}" y="${f(y)}" width="${f(side)}" height="${f(side)}"/>`;

  // S: side of this level's three L squares; the inner square is S too
  let S = GROWTH_SIDE / 2;
  for (let lv = 0; lv < levels; lv++) {
    const tl = { x: x0, y: y1 - 2 * S };
    const tr = { x: x0 + S, y: y1 - 2 * S };
    const br = { x: x0 + S, y: y1 - S };

    if (o.guides) {
      // the pair's midline and square one's quarter line (the ellipse's edge)
      out.push(line(tl.x, tl.y + S / 2, tr.x + S, tl.y + S / 2));
      out.push(line(tl.x + S / 2, tl.y, tl.x + S / 2, tl.y + S));
      // mirrored: the column's midline and the lower square's half line
      out.push(line(tr.x + S / 2, tr.y, tr.x + S / 2, br.y + S));
      out.push(line(br.x, br.y + S / 2, br.x + S, br.y + S / 2));
    }
    out.push(ellipse(tl.x + 0.75 * S, tl.y + S / 2, S / 4, S / 2));
    out.push(circle(tr.x + S / 2, tr.y + S / 2, S / 2));
    out.push(ellipse(br.x + S / 2, br.y + 0.25 * S, S / 2, S / 4));
    out.push(square(tl.x, tl.y, S), square(tr.x, tr.y, S), square(br.x, br.y, S));
    S /= 2;
  }
  // the seed, in the innermost square
  const seed = 2 * S;
  out.push(square(x0, y1 - seed, seed));
  out.push(circle(x0 + seed / 2, y1 - seed / 2, seed / 2));
  return out.join('\n    ');
}

export function growthSvg(o: Pick<GridOptions, 'rows' | 'guides'>, fieldDataUrl: string): string {
  return pageSvg(growthLinework(o), fieldDataUrl);
}

function pageSvg(linework: string, fieldDataUrl: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <filter id="soft" x="-200" y="-200" width="${W + 400}" height="${H + 400}" filterUnits="userSpaceOnUse">
      <feGaussianBlur stdDeviation="40"/>
      <feColorMatrix type="saturate" values="0.4"/>
    </filter>
  </defs>
  <image href="${fieldDataUrl}" x="-120" y="-180" width="${W + 240}" height="${H + 360}" preserveAspectRatio="none" filter="url(#soft)"/>
  <g fill="none" stroke="${STROKE}" stroke-width="${STROKE_W}" stroke-linecap="round">
    ${linework}
  </g>
  ${MARGIN_MARKS}
</svg>`;
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image failed to decode: ${src.slice(0, 48)}`));
    img.src = src;
  });
}

/** Fetch a same-origin asset as a data URL, so an SVG image can embed it. */
export async function fetchDataUrl(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
