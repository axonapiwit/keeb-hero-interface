/**
 * Section copy, split out so the scroll stage count and the section list can
 * never drift apart: `LAYERS.length` is what `scroll.cfg.stages` is set from.
 */
export interface LayerCopy {
  idx: string;
  title: string;
  body: string;
  anchor?: string;
}

export const LAYERS: LayerCopy[] = [
  {
    idx: 'LAYER 06',
    title: 'Keycaps',
    body: 'Six sculpted rows, each at its own angle. One orange key, and it is the one you reach for when something has gone wrong.',
    anchor: 'layers',
  },
  {
    idx: 'LAYER 05',
    title: 'Switches',
    body: 'Eighty-four clicky blues under a translucent housing — one mesh, instanced eighty-four times, so the GPU barely notices.',
  },
  {
    idx: 'LAYER 04',
    title: 'Plate',
    body: 'Brass. The part nobody sees and everybody hears. Watch it catch the light as the board turns.',
  },
  {
    idx: 'LAYER 03',
    title: 'PCB',
    body: 'Hot-swap everywhere. Pull a switch, drop in another, keep the board.',
  },
  {
    idx: 'LAYER 01 — 02',
    title: 'The case',
    body: '313 × 123 mm of dark aluminium, walls high enough that only the keycap tops show. Flip-out feet set a 6° typing angle.',
    anchor: 'specs',
  },
];
