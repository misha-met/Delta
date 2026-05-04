// Design tokens — single source of truth for colors, typography, borders, motion.
// All components should reference THEME.* rather than inlining values. Tuning
// the whole app's look starts and ends here.

const THEME = {
  // Surfaces
  surface:   "linear-gradient(180deg, rgba(20,20,30,0.92) 0%, rgba(11,11,17,0.94) 100%)",
  surface2:  "linear-gradient(180deg, rgba(20,20,30,0.88), rgba(11,11,17,0.92))",
  surface3:  "linear-gradient(180deg, rgba(20,20,30,0.96), rgba(11,11,17,0.98))",
  surfaceFlat: "rgba(11,11,17,0.8)",

  // Borders
  border:     "1px solid rgba(255,255,255,0.06)",
  borderSoft: "1px solid rgba(255,255,255,0.04)",
  borderHot:  "1px solid rgba(255,30,0,0.25)",
  borderCool: "1px solid rgba(0,217,255,0.25)",
  borderRaw:  "rgba(255,255,255,0.06)",
  borderSoftRaw: "rgba(255,255,255,0.04)",

  // Text
  text:       "#E6E6EF",
  textStrong: "#F6F6FA",
  textMuted:  "rgba(180,180,200,0.6)",
  textDim:    "rgba(180,180,200,0.5)",
  textFaint:  "rgba(180,180,200,0.35)",

  // Accents
  accent:    "#FF1E00",
  accent2:   "#00D9FF",
  hot:       "#FF1E00",
  cool:      "#00D9FF",
  good:      "#1EFF6A",
  warn:      "#FFD93A",
  caution:   "#FFB800",
  purple:    "#C15AFF",

  // Typography scale (px)
  fs: {
    xs: 9,     // sub-labels
    sm: 10,    // body small
    md: 12,    // body
    lg: 14,    // emphasis
    xl: 24,    // display
  },

  // Letter-spacing scale
  ls: {
    tight: "0.02em",
    body:  "0.06em",
    label: "0.1em",
    caps:  "0.14em",
    wide:  "0.2em",
  },

  // Monospace stack
  mono: "JetBrains Mono, monospace",

  // Motion durations (ms)
  motion: {
    micro: 60,
    short: 120,
    medium: 200,
  },
};

window.THEME = THEME;
