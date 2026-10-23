/**
 * Die-cut sticker sheet. Each sticker is a little SVG drawing; the white
 * border is generated from the drawing's own silhouette (every shape forced
 * white and stroked wide), so the cut line always hugs the artwork.
 */

export interface StickerDef {
  id: string;
  /** SVG fragment in a 200x200 box, centred on 100,100 */
  art: string;
}

// riso inks + drawing-desk materials
const INK = '#111';
const PINK = '#ff48b0';
const BLUE = '#0078bf';
const YELLOW = '#ffe800';
const PAPER = '#f8f8f8';
const METAL = '#c9ced6';
const WOOD = '#f2c98b';

/** ruler ticks along the top edge, alternating long/short */
const ticks = (x0: number, x1: number, y: number, step: number) =>
  Array.from({ length: Math.floor((x1 - x0) / step) + 1 }, (_, i) =>
    `M${x0 + i * step} ${y} v${i % 2 ? 10 : 18}`).join(' ');

/** n-point starburst path */
const burst = (n: number, ro: number, ri: number) =>
  Array.from({ length: n * 2 }, (_, i) => {
    const r = i % 2 ? ri : ro;
    const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
    return `${i ? 'L' : 'M'}${(100 + r * Math.cos(a)).toFixed(1)} ${(100 + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ') + ' Z';

export const STICKERS: StickerDef[] = [
  {
    id: 'registration',
    // printer's registration mark
    art: `<circle cx="100" cy="100" r="50" fill="${PAPER}" stroke="${INK}" stroke-width="6"/>
      <path d="M100 26 V174 M26 100 H174" stroke="${INK}" stroke-width="6"/>
      <circle cx="100" cy="100" r="24" fill="${INK}"/>
      <path d="M100 76 V124 M76 100 H124" stroke="${PAPER}" stroke-width="6"/>`,
  },
  {
    id: 'pencil',
    art: `<g transform="rotate(-40 100 100)">
      <path d="M52 82 L22 100 L52 118 Z" fill="${WOOD}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
      <path d="M33 93.4 L22 100 L33 106.6 Z" fill="${INK}"/>
      <rect x="52" y="82" width="92" height="36" fill="${YELLOW}" stroke="${INK}" stroke-width="5"/>
      <path d="M52 94 H144 M52 106 H144" stroke="${INK}" stroke-width="2.5" stroke-opacity="0.35"/>
      <rect x="144" y="82" width="18" height="36" fill="${METAL}" stroke="${INK}" stroke-width="5"/>
      <path d="M150 82 V118 M156 82 V118" stroke="${INK}" stroke-width="2"/>
      <path d="M162 82 H170 Q180 82 180 92 V108 Q180 118 170 118 H162 Z" fill="${PINK}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
      <path d="M60 88 H136" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-opacity="0.8"/>
    </g>`,
  },
  {
    id: 'compass',
    art: `<path d="M100 52 L58 168 M100 52 L142 168" stroke="${INK}" stroke-width="13" stroke-linecap="round"/>
      <path d="M100 52 L58 168 M100 52 L142 168" stroke="${METAL}" stroke-width="5" stroke-linecap="round"/>
      <path d="M58 168 L54 182" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
      <path d="M142 168 L147 182" stroke="${PINK}" stroke-width="7" stroke-linecap="round"/>
      <path d="M74 124 Q100 116 126 124" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
      <rect x="90" y="16" width="20" height="30" rx="6" fill="${INK}"/>
      <circle cx="100" cy="54" r="13" fill="${BLUE}" stroke="${INK}" stroke-width="5"/>
      <circle cx="96" cy="50" r="3.5" fill="#fff"/>`,
  },
  {
    id: 'set-square',
    art: `<path d="M38 166 V34 L170 166 Z" fill="${BLUE}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
      <path d="M62 142 V94 L110 142 Z" fill="${PAPER}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
      <path d="M38 50 h14 M38 66 h9 M38 82 h14 M38 98 h9 M38 114 h14 M38 130 h9 M38 146 h14
        M54 166 v-14 M70 166 v-9 M86 166 v-14 M102 166 v-9 M118 166 v-14 M134 166 v-9 M150 166 v-14"
        stroke="#fff" stroke-width="3"/>
      <path d="M46 52 L46 70" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-opacity="0.7"/>`,
  },
  {
    id: 'overprint',
    // two riso inks overprinting, on the drawing's centre line
    art: `<circle cx="78" cy="100" r="52" fill="${PINK}"/>
      <circle cx="122" cy="100" r="52" fill="${BLUE}" style="mix-blend-mode: multiply"/>
      <path d="M18 100 H182" stroke="${INK}" stroke-width="2.5"/>
      <circle cx="78" cy="100" r="52" fill="none" stroke="${INK}" stroke-width="2.5"/>
      <circle cx="122" cy="100" r="52" fill="none" stroke="${INK}" stroke-width="2.5"/>`,
  },
  {
    id: 'eye',
    // the drawing's ellipse, looking back
    art: `<ellipse cx="100" cy="100" rx="44" ry="70" fill="${PAPER}" stroke="${INK}" stroke-width="5"/>
      <circle cx="100" cy="112" r="26" fill="${BLUE}" stroke="${INK}" stroke-width="4"/>
      <circle cx="100" cy="112" r="12" fill="${INK}"/>
      <circle cx="91" cy="102" r="6" fill="#fff"/>
      <path d="M100 30 V170" stroke="${INK}" stroke-width="2.5" stroke-opacity="0.5"/>`,
  },
  {
    id: 'ruler',
    art: `<g transform="rotate(-28 100 100)">
      <rect x="18" y="74" width="164" height="52" rx="5" fill="${YELLOW}" stroke="${INK}" stroke-width="5"/>
      <path d="${ticks(30, 170, 74, 10)}" stroke="${INK}" stroke-width="3"/>
      <circle cx="166" cy="110" r="5" fill="${PAPER}" stroke="${INK}" stroke-width="3"/>
      <path d="M28 118 H150" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-opacity="0.7"/>
    </g>`,
  },
  {
    id: 'burst',
    art: `<path d="${burst(14, 76, 58)}" fill="${YELLOW}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
      <circle cx="100" cy="100" r="36" fill="${PINK}" style="mix-blend-mode: multiply"/>
      <circle cx="100" cy="100" r="36" fill="none" stroke="${INK}" stroke-width="4"/>
      <circle cx="88" cy="88" r="7" fill="#fff" fill-opacity="0.8"/>`,
  },
  {
    id: 'eraser',
    art: `<g transform="rotate(-18 100 100)">
      <rect x="28" y="66" width="144" height="68" rx="12" fill="#ff8fc8" stroke="${INK}" stroke-width="5"/>
      <rect x="86" y="60" width="86" height="80" rx="6" fill="${BLUE}" stroke="${INK}" stroke-width="5"/>
      <path d="M104 60 V140 M122 60 V140" stroke="#fff" stroke-width="5"/>
      <path d="M40 76 H76" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-opacity="0.7"/>
    </g>`,
  },
];

const BORDER = 22;

/** Full sticker SVG: shadowed white die-cut silhouette, then the art on top. */
export function stickerSvg(def: StickerDef): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 200 200">
  <defs>
    <style>.cut * { fill: #fff !important; stroke: #fff !important; stroke-width: ${BORDER}px !important;
      stroke-opacity: 1 !important; fill-opacity: 1 !important;
      stroke-linejoin: round !important; stroke-linecap: round !important; }</style>
    <filter id="lift" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#000" flood-opacity="0.28"/>
    </filter>
  </defs>
  <g class="cut" filter="url(#lift)">${def.art}</g>
  ${def.art}
</svg>`;
}

/** The sheet as data URLs, built once. */
export const STICKER_SHEET = STICKERS.map((def) => ({
  id: def.id,
  url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(stickerSvg(def))}`,
}));
