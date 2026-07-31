/** Named color palettes for Pixel Paint (Aseprite-style game / hardware sets). */

export type PaintPaletteId =
  | 'aseprite'
  | 'pico8'
  | 'sweetie16'
  | 'endesga32'
  | 'db16'
  | 'db32'
  | 'gameboy'
  | 'gameboy-pocket'
  | 'nes'
  | 'snes-soft'
  | 'mastersystem'
  | 'genesis'
  | 'c64'
  | 'msx'
  | 'arcade'
  | 'picoCAD'
  | 'minecraft'
  | 'mono'
  | 'warm'
  | 'cool';

export type PaintPalette = {
  id: PaintPaletteId;
  name: string;
  group: 'Classic' | 'Handheld' | 'Console' | 'Computer' | 'Modern' | 'Studio';
  colors: string[];
};

/** Legacy export — same as Aseprite / PICO-8 hybrid starter. */
export const ASEPRITE_DEFAULT_PALETTE = [
  '#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8',
  '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa',
];

export const PAINT_PALETTES: PaintPalette[] = [
  {
    id: 'aseprite',
    name: 'Aseprite Default',
    group: 'Studio',
    colors: [
      ...ASEPRITE_DEFAULT_PALETTE,
      '#ffffff', '#94e2ff', '#ed7300', '#ed7300', '#e68619', '#ec5b62', '#2d9d78', '#6e6e6e',
      '#4d4d4d', '#8c8c8c', '#b3b3b3', '#e8e8e8', '#7b2cbf', '#f4a261', '#2a9d8f', '#e9c46a',
      '#264653', '#2a9d8f', '#e9c46a', '#f4a261', '#e76f51', '#d62828', '#023e8a', '#0077b6',
      '#90e0ef', '#caf0f8', '#ffb703', '#fb8500', '#8338ec', '#3a86ff', '#ff006e', '#06d6a0',
    ],
  },
  {
    id: 'pico8',
    name: 'PICO-8',
    group: 'Console',
    colors: [
      '#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8',
      '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa',
    ],
  },
  {
    id: 'picoCAD',
    name: 'PolyStage Studio',
    group: 'Studio',
    colors: [
      '#000000', '#2b2b2b', '#262626', '#4d4d4d', '#6e6e6e', '#8c8c8c', '#b3b3b3', '#e8e8e8',
      '#ffffff', '#ed7300', '#ed7300', '#ff9a3c', '#94e2ff', '#e68619', '#ff9a2e', '#ec5b62',
      '#2d9d78', '#00e436', '#ffec27', '#ffa300', '#ff004d', '#7b2cbf', '#ff77a8', '#ffccaa',
      '#1d2b53', '#008751', '#ab5236', '#5f574f', '#83769c', '#29adff', '#c2c3c7', '#fff1e8',
    ],
  },
  {
    id: 'sweetie16',
    name: 'Sweetie 16',
    group: 'Modern',
    colors: [
      '#1a1c2c', '#5d275d', '#b13e53', '#ef7d57', '#ffcd75', '#a7f070', '#38b764', '#257179',
      '#29366f', '#3b5dc9', '#41a6f6', '#73eff7', '#f4f4f4', '#94b0c2', '#566c86', '#333c57',
    ],
  },
  {
    id: 'endesga32',
    name: 'Endesga 32',
    group: 'Modern',
    colors: [
      '#be4a2f', '#d77643', '#ead4aa', '#e4a672', '#b86f50', '#733e39', '#3e2731', '#a22633',
      '#e43b44', '#f77622', '#feae34', '#fee761', '#63c74d', '#3e8948', '#265c42', '#193c3e',
      '#124e89', '#0099db', '#2ce8f5', '#ffffff', '#c0cbdc', '#8b9bb4', '#5a6988', '#3a4466',
      '#262b44', '#181425', '#ff0044', '#68386c', '#b55088', '#f6757a', '#e8b796', '#c28569',
    ],
  },
  {
    id: 'db16',
    name: 'DawnBringer 16',
    group: 'Modern',
    colors: [
      '#140c1c', '#442434', '#30346d', '#4e4a4e', '#854c30', '#346524', '#d04648', '#757161',
      '#597dce', '#d27d2c', '#8595a1', '#6daa2c', '#d2aa99', '#6dc2ca', '#dad45e', '#deeed6',
    ],
  },
  {
    id: 'db32',
    name: 'DawnBringer 32',
    group: 'Modern',
    colors: [
      '#000000', '#222034', '#45283c', '#663931', '#8f563b', '#df7126', '#d9a066', '#eec39a',
      '#fbf236', '#99e550', '#6abe30', '#37946e', '#4b692f', '#524b24', '#323c39', '#3f3f74',
      '#306082', '#5b6ee1', '#639bff', '#5fcde4', '#cbdbfc', '#ffffff', '#9badb7', '#847e87',
      '#696a6a', '#595652', '#76428a', '#ac3232', '#d95763', '#d77bba', '#8f974a', '#8a6f30',
    ],
  },
  {
    id: 'gameboy',
    name: 'Game Boy',
    group: 'Handheld',
    colors: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
  },
  {
    id: 'gameboy-pocket',
    name: 'Game Boy Pocket',
    group: 'Handheld',
    colors: ['#2a3325', '#595e3e', '#848b5c', '#a7b071'],
  },
  {
    id: 'nes',
    name: 'NES',
    group: 'Console',
    colors: [
      '#000000', '#fcfcfc', '#f8f8f8', '#bcbcbc', '#7c7c7c', '#a4e4fc', '#3cbcfc', '#0078f8',
      '#0000fc', '#b8b8f8', '#6888fc', '#0058f8', '#0000bc', '#d8b8f8', '#9878f8', '#6844fc',
      '#4428bc', '#f8b8f8', '#f878f8', '#d800cc', '#940084', '#f8a4c0', '#f85898', '#e40058',
      '#a80020', '#f0d0b0', '#f87858', '#f83800', '#a81000', '#fce0a8', '#fca044', '#e45c10',
      '#881400', '#f8d878', '#f8b800', '#ac7c00', '#503000', '#d8f878', '#b8f818', '#00b800',
      '#007800', '#b8f8b8', '#58d854', '#00a800', '#006800', '#b8f8d8', '#58f898', '#00a844',
      '#005800', '#00fcfc', '#00e8d8', '#008888', '#004058', '#f8d8f8', '#787878',
    ],
  },
  {
    id: 'snes-soft',
    name: 'SNES Soft',
    group: 'Console',
    colors: [
      '#1b1b2f', '#162447', '#1f4068', '#e43f5a', '#f08a5d', '#f9ed69', '#3ec1d3', '#f5f5f5',
      '#6a2c70', '#b83b5e', '#ff9a3c', '#ffd460', '#16c79a', '#0f4c75', '#3282b8', '#bbe1fa',
      '#2d132c', '#801336', '#c72c41', '#ee4540', '#c06c84', '#6c5b7b', '#355c7d', '#f8b195',
      '#f67280', '#c06c84', '#355c7d', '#2a363b', '#e84a5f', '#ff847c', '#feceab', '#99b898',
    ],
  },
  {
    id: 'mastersystem',
    name: 'Master System',
    group: 'Console',
    colors: [
      '#000000', '#550000', '#aa0000', '#ff0000', '#005500', '#555500', '#aa5500', '#ff5500',
      '#00aa00', '#55aa00', '#aaaa00', '#ffaa00', '#00ff00', '#55ff00', '#aaff00', '#ffff00',
      '#000055', '#550055', '#aa0055', '#ff0055', '#005555', '#555555', '#aa5555', '#ff5555',
      '#00aa55', '#55aa55', '#aaaa55', '#ffaa55', '#00ff55', '#55ff55', '#aaff55', '#ffff55',
      '#0000aa', '#5500aa', '#aa00aa', '#ff00aa', '#0055aa', '#5555aa', '#aa55aa', '#ff55aa',
      '#00aaaa', '#55aaaa', '#aaaaaa', '#ffaaaa', '#00ffaa', '#55ffaa', '#aaffaa', '#ffffaa',
      '#0000ff', '#5500ff', '#aa00ff', '#ff00ff', '#0055ff', '#5555ff', '#aa55ff', '#ff55ff',
      '#00aaff', '#55aaff', '#aaaaff', '#ffaaff', '#00ffff', '#55ffff', '#aaffff', '#ffffff',
    ],
  },
  {
    id: 'genesis',
    name: 'Mega Drive / Genesis',
    group: 'Console',
    colors: [
      '#000000', '#0000e8', '#0000fc', '#e80000', '#fc0000', '#e800e8', '#fc00fc', '#00e800',
      '#00fc00', '#00e8e8', '#00fcfc', '#e8e800', '#fcfc00', '#e8e8e8', '#fcfcfc', '#000084',
      '#0000b4', '#840000', '#b40000', '#840084', '#b400b4', '#008400', '#00b400', '#008484',
      '#00b4b4', '#848400', '#b4b400', '#848484', '#b4b4b4', '#00004e', '#4e0000', '#4e004e',
      '#004e00', '#004e4e', '#4e4e00', '#4e4e4e', '#000020', '#200000', '#200020', '#002000',
      '#002020', '#202000', '#2e2e2e', '#fcb4b4', '#b4b4fc', '#b4fcb4', '#fcfcb4', '#b4fcfc',
      '#fcb4fc', '#fc8400', '#00fc84', '#8400fc', '#fc0084', '#84fc00', '#0084fc',
    ],
  },
  {
    id: 'c64',
    name: 'Commodore 64',
    group: 'Computer',
    colors: [
      '#000000', '#ffffff', '#880000', '#aaffee', '#cc44cc', '#00cc55', '#0000aa', '#eeee77',
      '#dd8855', '#664400', '#ff7777', '#333333', '#777777', '#aaff66', '#0088ff', '#bbbbbb',
    ],
  },
  {
    id: 'msx',
    name: 'MSX',
    group: 'Computer',
    colors: [
      '#000000', '#010101', '#3eb849', '#74d07d', '#5955e0', '#8076f1', '#b95e51', '#65dbef',
      '#db6559', '#ff897d', '#ccc35e', '#ded087', '#3aa241', '#b766b5', '#cccccc', '#ffffff',
    ],
  },
  {
    id: 'arcade',
    name: 'Arcade Punch',
    group: 'Console',
    colors: [
      '#0d0d0d', '#1a1a2e', '#16213e', '#0f3460', '#e94560', '#ff2e63', '#08d9d6', '#f9ed69',
      '#f08a5d', '#b83b5e', '#6a2c70', '#3ec1d3', '#f5f5f5', '#ff9a3c', '#16c79a', '#0f4c75',
      '#3282b8', '#bbe1fa', '#ff006e', '#8338ec', '#3a86ff', '#fb5607', '#ffbe0b', '#06d6a0',
      '#118ab2', '#073b4c', '#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#073b4c', '#ffffff',
    ],
  },
  {
    id: 'minecraft',
    name: 'Block / Craft',
    group: 'Modern',
    colors: [
      '#000000', '#7c7c7c', '#c6c6c6', '#ffffff', '#8b8b8b', '#373737', '#5a5a5a', '#3a3a3a',
      '#8b4513', '#a0522d', '#cd853f', '#deb887', '#228b22', '#2e8b57', '#3cb371', '#90ee90',
      '#1e90ff', '#4169e1', '#0000cd', '#87ceeb', '#ff4500', '#ff6347', '#ffa500', '#ffd700',
      '#8b0000', '#dc143c', '#ff69b4', '#da70d6', '#4b0082', '#9400d3', '#00ced1', '#20b2aa',
    ],
  },
  {
    id: 'mono',
    name: 'Mono 16',
    group: 'Studio',
    colors: [
      '#000000', '#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777',
      '#888888', '#999999', '#aaaaaa', '#bbbbbb', '#cccccc', '#dddddd', '#eeeeee', '#ffffff',
    ],
  },
  {
    id: 'warm',
    name: 'Warm Earth',
    group: 'Studio',
    colors: [
      '#1a120b', '#3c2a21', '#5c4033', '#7b5e57', '#a67c52', '#c4a484', '#e8d5b7', '#fff8e7',
      '#4a0e0e', '#8b0000', '#c0392b', '#e74c3c', '#e67e22', '#f39c12', '#f1c40f', '#ffeaa7',
      '#6d4c41', '#8d6e63', '#a1887f', '#d7ccc8', '#bf360c', '#e65100', '#ff6d00', '#ff9100',
      '#3e2723', '#5d4037', '#795548', '#a1887f', '#ffab91', '#ffccbc', '#fbe9e7', '#ffffff',
    ],
  },
  {
    id: 'cool',
    name: 'Cool Ocean',
    group: 'Studio',
    colors: [
      '#03045e', '#023e8a', '#0077b6', '#0096c7', '#00b4d8', '#48cae4', '#90e0ef', '#caf0f8',
      '#001219', '#005f73', '#0a9396', '#94d2bd', '#e9d8a6', '#ee9b00', '#ca6702', '#bb3e03',
      '#1b263b', '#415a77', '#778da9', '#e0e1dd', '#0d1b2a', '#1b263b', '#415a77', '#778da9',
      '#14213d', '#1d3557', '#457b9d', '#a8dadc', '#f1faee', '#e63946', '#2a9d8f', '#ffffff',
    ],
  },
];

export function getPaintPalette(id: PaintPaletteId): PaintPalette {
  return PAINT_PALETTES.find((p) => p.id === id) || PAINT_PALETTES[0];
}
