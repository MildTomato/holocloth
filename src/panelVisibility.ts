import { useEffect } from 'react';
import { DialStore, type ControlMeta } from 'dialkit';

/** the panel values the rules read; loose, so it takes the resolved dial values as they are */
type Values = {
  mode: string;
  cards: string;
  cinematic: boolean;
  card: { ink: string };
  grid: { pattern: string; engine: string };
  physics: { hang: string };
  render: { dof: boolean; occlusion: boolean };
};

/** Each Grid pattern's own controls; the others' are hidden. */
const GRID_CONTROLS: Record<string, string[]> = {
  Generated: ['rows', 'depth', 'fill', 'endCircles', 'guides', 'seed', 'shuffle'],
  Growth: ['steps', 'guides'],
  Flower: ['flower', 'style', 'type', 'uploadFlower'],
  Engine: ['engine', 'layers', 'seed', 'shuffle'],
};
const GRID_ALL = ['engine', 'layers', 'flower', 'style', 'type', 'steps', 'rows', 'depth', 'fill', 'endCircles', 'guides', 'seed', 'shuffle', 'uploadFlower'];

/** Paths of the controls that do nothing with the panel as it's set. */
export function irrelevantControls(v: Values): string[] {
  const card = v.mode === 'Card';
  const hide: string[] = [];
  if (card) {
    // the card is rigid: no cloth to hang, hold, reset or poke
    hide.push('physics', 'hands', 'resetCloth', 'poke');
  } else {
    hide.push('drag', 'cards', 'stack', 'card.ink', 'card.etchDepth', 'card.etchBevel', 'card.corner', 'card.back', 'exportOutlines');
    if (v.mode !== 'Poster') hide.push('hands');
  }
  if (card && v.cards !== 'Stack') hide.push('stack');
  if (card && v.card.ink === 'Printed') hide.push('card.etchDepth', 'card.etchBevel');
  if (!v.cinematic) hide.push('card.shotLength', 'card.drama');
  // the Card folder holds nothing else, so off a card with no cinematic it goes
  if (!card && !v.cinematic) hide.push('card');

  const own = GRID_CONTROLS[v.grid.pattern] ?? [];
  for (const key of GRID_ALL) if (!own.includes(key)) hide.push(`grid.${key}`);
  if (v.grid.pattern === 'Engine' && v.grid.engine !== 'Random') hide.push('grid.layers');

  if (v.physics.hang !== 'Two pins' && v.physics.hang !== 'Flag') hide.push('physics.pinSpread');
  if (v.physics.hang !== 'Face') hide.push('physics.faceDepth');

  if (!v.render.dof) hide.push('render.dofAperture', 'render.dofBlur', 'render.dofRange', 'render.pickFocus', 'render.autoFocus');
  if (!v.render.occlusion) hide.push('render.occlusionStrength');
  return hide;
}

/**
 * Hides panel controls that don't apply. DialKit has no conditional
 * controls, and leaving them out of the config would drop their values (and
 * saved versions with them), so this hides their rows in DialKit's own DOM:
 * each folder lists one element per control, in config order. A
 * MutationObserver re-applies it as folders open and close, since a closed
 * folder unmounts its rows. An effect, because this syncs with DOM that
 * DialKit owns; it re-runs whenever the hidden set changes.
 */
export function useHiddenControls(panelId: string, hidden: string[]) {
  const key = hidden.join('|');
  useEffect(() => {
    const set = new Set(key ? key.split('|') : []);
    const walk = (controls: ControlMeta[], inner: Element) => {
      controls.forEach((control, i) => {
        const row = inner.children[i] as HTMLElement | undefined;
        if (!row) return;
        const display = set.has(control.path) ? 'none' : '';
        if (row.style.display !== display) row.style.display = display;
        if (control.type === 'folder' && control.children) {
          const sub = row.querySelector(':scope > .dialkit-folder-content > .dialkit-folder-inner');
          if (sub) walk(control.children, sub);
        }
      });
    };
    const apply = () => {
      const panel = DialStore.getPanel(panelId);
      const root = document.querySelector('.dialkit-folder .dialkit-folder-inner');
      if (panel && root) walk(panel.controls, root);
    };
    apply();
    // rows mounting (folders opening, the panel appearing) is a childList change; style edits aren't, so this can't loop
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [panelId, key]);
}
