/**
 * Panel settings <-> URL query. Every control that differs from its
 * default is written as `path=value` (e.g. `?mode=Poster&material.bump=0.8`),
 * so a link restores a look. On load, those values become the panel's
 * starting values — not changes applied afterwards — so presets keyed off a
 * control (Mode, material Preset, Finish) don't overwrite what the link set.
 */

type Primitive = string | number | boolean;
type Flat = Record<string, Primitive>;

/** per-device or per-session settings, never put in a link */
const NOT_SHARED = new Set(['performance', 'images.useImage', 'images.edit']);

/** Every control's default, flattened to dotted paths. Actions and folder flags are skipped. */
export function panelDefaults(config: Record<string, unknown>, prefix = ''): Flat {
  const out: Flat = {};
  for (const [key, v] of Object.entries(config)) {
    if (key.startsWith('_')) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (Array.isArray(v)) out[path] = v[0] as number;
    else if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') out[path] = v;
    else if (v && typeof v === 'object') {
      const o = v as { type?: string; default?: Primitive };
      if (o.type === 'action') continue;
      if (o.type === 'select' || o.type === 'color') {
        if (o.default !== undefined) out[path] = o.default;
      } else {
        Object.assign(out, panelDefaults(v as Record<string, unknown>, path));
      }
    }
  }
  return out;
}

/** The panel's current values, flattened the same way. */
export function flattenValues(values: Record<string, unknown>, prefix = ''): Flat {
  const out: Flat = {};
  for (const [key, v] of Object.entries(values)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') out[path] = v;
    else if (v && typeof v === 'object' && !('type' in v)) {
      Object.assign(out, flattenValues(v as Record<string, unknown>, path));
    }
  }
  return out;
}

/** Values the URL sets, coerced to each control's type; unknown or malformed keys are ignored. */
function readUrl(defaults: Flat): Flat {
  const params = new URLSearchParams(window.location.search);
  const out: Flat = {};
  for (const [path, def] of Object.entries(defaults)) {
    if (NOT_SHARED.has(path)) continue;
    const raw = params.get(path);
    if (raw === null) continue;
    if (typeof def === 'number') {
      const n = Number(raw);
      if (Number.isFinite(n)) out[path] = n;
    } else if (typeof def === 'boolean') {
      out[path] = raw === 'true' || raw === '1';
    } else {
      out[path] = raw;
    }
  }
  return out;
}

/**
 * A copy of the panel config with defaults replaced by whatever the URL
 * sets. `base(urlValues)` can layer in values implied by the URL (e.g. a
 * mode's preset) underneath the URL's own explicit values.
 */
export function withUrlDefaults<T extends Record<string, unknown>>(
  config: T,
  base: (urlValues: Flat) => Flat = () => ({}),
): T {
  const fromUrl = readUrl(panelDefaults(config));
  const overrides = { ...base(fromUrl), ...fromUrl };
  const apply = (node: Record<string, unknown>, prefix: string): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(node)) {
      const path = prefix ? `${prefix}.${key}` : key;
      const o = overrides[path];
      if (o === undefined) {
        out[key] = v && typeof v === 'object' && !Array.isArray(v) && !('type' in v)
          ? apply(v as Record<string, unknown>, path)
          : v;
      } else if (Array.isArray(v)) {
        out[key] = [o, ...v.slice(1)];
      } else if (v && typeof v === 'object') {
        out[key] = { ...v, default: o };
      } else {
        out[key] = o;
      }
    }
    return out;
  };
  return apply(config, '') as T;
}

const same = (a: Primitive, b: Primitive) =>
  typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-9 : a === b;

/** numbers trimmed to what the sliders can show */
const format = (v: Primitive) => (typeof v === 'number' ? String(+v.toFixed(4)) : String(v));

/**
 * Write every shared control that differs from its default into the query,
 * replacing the history entry (no reload, no back-button spam). Other
 * params, like `?clean`, are left alone.
 */
export function writeUrl(values: Flat, defaults: Flat) {
  const params = new URLSearchParams(window.location.search);
  for (const [path, def] of Object.entries(defaults)) {
    if (NOT_SHARED.has(path)) continue;
    params.delete(path);
    const v = values[path];
    if (v !== undefined && !same(v, def)) params.set(path, format(v));
  }
  const query = params.toString();
  const url = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
  if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
    window.history.replaceState(null, '', url);
  }
}
