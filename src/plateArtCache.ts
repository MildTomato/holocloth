/**
 * Rendered stack artwork, kept in Supabase: a set of plates is drawn once,
 * in whichever browser first asks for it, and posted to the plate-art Edge
 * Function; after that everyone downloads the images instead of drawing.
 * Sets are keyed by the Visual Engine commit, so a changed engine draws afresh.
 */
declare const __ENGINE_REV__: string;

const URL_BASE = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const API_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

/** a set's key, or null when there's nowhere to keep it */
export function plateArtKey(engine: string, seed: number, layers: number) {
  if (!URL_BASE || !API_KEY || !__ENGINE_REV__) return null;
  return `${__ENGINE_REV__}/${engine.replace(/[^A-Za-z0-9_-]+/g, '_')}/${seed}-${layers}`;
}

/** The set's plates as decoded images, if all of them are stored; null if not (or offline). */
export async function loadPlateArt(key: string, count: number): Promise<ImageBitmap[] | null> {
  try {
    const res = await fetch(`${URL_BASE}/rest/v1/plate_art_sets?select=plates&key=eq.${encodeURIComponent(key)}`, {
      headers: { apikey: API_KEY! },
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as { plates: number }[];
    if (!rows.length || rows[0].plates < count) return null;
    return await Promise.all(
      Array.from({ length: count }, async (_, i) => {
        const img = await fetch(`${URL_BASE}/storage/v1/object/public/plate-art/${key}/${i}.webp`);
        if (!img.ok) throw new Error(`plate ${i}: ${img.status}`);
        return createImageBitmap(await img.blob());
      }),
    );
  } catch (err) {
    console.warn('[holocloth] cached plate art unavailable', err);
    return null;
  }
}

/** Keep a freshly drawn set for next time. Fire and forget: a failure only means drawing again. */
export function savePlateArt(key: string, plates: Blob[], width: number, height: number) {
  const form = new FormData();
  form.set('key', key);
  form.set('width', String(width));
  form.set('height', String(height));
  plates.forEach((p, i) => form.append('plate', p, `${i}.webp`));
  fetch(`${URL_BASE}/functions/v1/plate-art`, { method: 'POST', body: form, headers: { apikey: API_KEY! } })
    .then(async (res) => {
      if (!res.ok) console.warn('[holocloth] plate art not saved', res.status, await res.text());
    })
    .catch((err) => console.warn('[holocloth] plate art not saved', err));
}
