// How the game looks in each Airlock theme. The colours come from the
// theme's own design tokens, read when the game opens and again when the
// theme changes; the style says how the art is drawn: clean pixels, four
// LCD greens, chunky teletext mosaics, glowing vector outlines, neon,
// bevelled 90s blocks, matrix glyphs, or a home computer's palette.

export type Style = 'pixel' | 'lcd' | 'mosaic' | 'outline' | 'neon' | 'bevel' | 'glyph' | 'chunky';

export type Skin = {
  theme: string;
  style: Style;
  /** Background, sky and far scenery. */
  bg: string;
  sky: string;
  far: string;
  near: string;
  /** Outlines and the darkest detail. */
  ink: string;
  text: string;
  dim: string;
  accent: string;
  accentLight: string;
  ok: string;
  warn: string;
  danger: string;
  dangerLight: string;
  /** Colours that tell zones and bugs apart. */
  hues: string[];
  ground: string;
  groundDark: string;
  light: string;
  /** The four shades an LCD has, darkest first (only for 'lcd'). */
  shades: string[];
};

const STYLE: Record<string, Style> = {
  current: 'pixel',
  matrix: 'glyph',
  boot: 'chunky',
  teletext: 'mosaic',
  handheld: 'lcd',
  gameboy: 'lcd',
  workstation: 'bevel',
  vector: 'outline',
  hacker: 'neon',
};

/** A CSS colour as [r, g, b]; anything unreadable is black. */
export function rgb(colour: string): [number, number, number] {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(colour.trim());
  if (hex) {
    const digits = hex[1] ?? '000';
    const full = digits.length === 3 ? [...digits].map((d) => d + d).join('') : digits;
    return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
  }
  const fn = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(colour);
  if (fn) return [Number(fn[1]), Number(fn[2]), Number(fn[3])];
  return [0, 0, 0];
}

export function hex([r, g, b]: [number, number, number]): string {
  const part = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

export function mix(a: string, b: string, amount: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return hex([x[0] + (y[0] - x[0]) * amount, x[1] + (y[1] - x[1]) * amount, x[2] + (y[2] - x[2]) * amount]);
}

export function luma(colour: string): number {
  const [r, g, b] = rgb(colour);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function readSkin(root: HTMLElement = document.documentElement): Skin {
  const css = getComputedStyle(root);
  const token = (name: string, fallback: string) => {
    const value = css.getPropertyValue(name).trim();
    // Some tokens are rgb() with alpha; keep their colour.
    return value ? hex(rgb(value)) : fallback;
  };
  const theme = root.dataset.theme ?? 'current';
  return skinFrom(theme, token);
}

/** Builds a skin from a theme and a way to look up its tokens (tests pass a table). */
export function skinFrom(theme: string, token: (name: string, fallback: string) => string): Skin {
  const style = STYLE[theme] ?? 'pixel';
  const bg = token('--c-bg', '#111317');
  const text = token('--c-text', '#e6e8ec');
  const light = luma(bg) > 128;
  const ink = light ? text : mix(bg, '#000000', 0.55);
  const accent = token('--c-accent', '#3b63e6');
  const hues = [
    token('--c-ok', '#3ecf8e'),
    token('--c-syn-attr', '#7ee787'),
    token('--c-syn-string', '#a5d6ff'),
    token('--c-syn-title', '#d2a8ff'),
    token('--c-accent-text', '#9db6ff'),
    token('--c-syn-number', '#79c0ff'),
    token('--c-syn-meta', '#ffa657'),
    token('--c-folder', '#e3b341'),
    token('--c-danger-text', '#ff8a80'),
    token('--c-syn-keyword', '#ff7b72'),
  ];
  const skin: Skin = {
    theme,
    style,
    bg,
    sky: token('--c-bg', bg),
    far: token('--c-surface', '#1a1d23'),
    near: token('--c-surface-2', '#23262d'),
    ink,
    text,
    dim: token('--c-text-muted', '#9aa1ad'),
    accent,
    accentLight: token('--c-accent-text', '#9db6ff'),
    ok: token('--c-ok', '#3ecf8e'),
    warn: token('--c-warn', '#f0b429'),
    danger: token('--c-danger', '#c62f2f'),
    dangerLight: token('--c-danger-text', '#ff8a80'),
    hues,
    ground: token('--c-surface-3', '#2f3440'),
    groundDark: token('--c-line', '#2a2e36'),
    light: light ? token('--c-surface', '#ffffff') : token('--c-text-soft', '#c9ced6'),
    shades: [],
  };
  if (style === 'lcd') {
    // Four greens from the theme: text, accent, surface, background.
    const shades = [text, token('--c-accent', '#306230'), token('--c-surface', '#8bac0f'), bg];
    skin.shades = shades;
    skin.sky = bg;
    skin.far = shades[2] ?? bg;
    skin.near = shades[2] ?? bg;
    skin.ground = shades[1] ?? text;
    skin.groundDark = text;
  }
  if (light) {
    // On a light screen the highlights need to be lighter than the colour.
    skin.accentLight = mix(accent, '#ffffff', 0.55);
  }
  if (theme === 'boot') {
    // A home computer's border around its screen.
    skin.far = token('--c-surface', '#4b3c9c');
    skin.near = token('--c-surface-2', '#5747ab');
  }
  if (theme === 'teletext') {
    skin.hues = ['#00ff00', '#00ffff', '#ffff00', '#ff00ff', '#ffffff', '#00ffff', '#ffff00', '#00ff00', '#ff4040', '#ff00ff'];
    skin.ground = '#0000ff';
    skin.groundDark = '#000000';
    skin.near = '#0000ff';
    skin.far = '#000080';
  }
  if (theme === 'workstation') {
    skin.sky = '#008080';
    skin.far = '#006a6a';
    skin.near = '#005454';
    skin.ground = '#aaaaaa';
    skin.groundDark = '#555555';
  }
  if (theme === 'current') {
    skin.sky = mix(bg, accent, 0.18);
  }
  return skin;
}

/** The nearest of an LCD's four shades to a colour (by brightness). */
export function toShade(skin: Skin, colour: string): string {
  if (skin.shades.length !== 4) return colour;
  const value = luma(colour);
  const levels = skin.shades.map(luma);
  let best = 0;
  for (let i = 1; i < 4; i += 1) if (Math.abs((levels[i] ?? 0) - value) < Math.abs((levels[best] ?? 0) - value)) best = i;
  return skin.shades[best] ?? colour;
}
