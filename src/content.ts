/**
 * Section copy, split out so the scroll stage count and the section list can
 * never drift apart: `LAYERS.length` is what `scroll.cfg.stages` is set from.
 */
export interface LayerCopy {
  idx: string;
  title: string;
  body: string;
  anchor?: string;
  /**
   * Flip the page and the 3D backdrop to the light theme while this section
   * owns the viewport.
   *
   * Chosen from what the part actually is, not from a fixed rhythm: brass wants
   * a warm ground to glint against, and the near-black case reads as a
   * silhouette against light. The pale keycaps and blue switches do the
   * opposite — they need the dark to pop.
   */
  light?: boolean;
}

export interface Theme {
  bg: string;
  ink: string;
  dim: string;
}

export const THEMES: { dark: Theme; light: Theme } = {
  dark: { bg: '#0D0F14', ink: '#EDEAE3', dim: '#7C8290' },
  light: { bg: '#E4DFD6', ink: '#14161B', dim: '#6A6E77' },
};

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
    light: true,
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
    light: true,
  },
];
