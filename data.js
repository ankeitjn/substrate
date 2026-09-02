/* =====================================================================
   data.js — authoritative data tables for the keyboard configurator.
   Transcribed from the build spec §4 (layouts), §5 (keycaps),
   §6 (switches), §7 (cases/mounts), §11 (exploded-view layer stack).

   Nothing in this file is computed. app.js derives everything else.
   ===================================================================== */

/* ---------------------------------------------------------------------
   UNIT MATH (§4.1)
   --------------------------------------------------------------------- */

const U = 56;      // px per 1u at 100% zoom
const GAP = 4;     // px visual gap between caps (cap is U - GAP wide)
const ROW_GAP = 4;

/* ---------------------------------------------------------------------
   ROW SCULPTING (§4.3) — Cherry profile, keyed by row label
   --------------------------------------------------------------------- */

const SCULPT = {
  R0: { rotateX: -7,   translateZ: 4 },
  R1: { rotateX: -7,   translateZ: 4 },
  R2: { rotateX: -3.5, translateZ: 1 },
  R3: { rotateX: 0,    translateZ: 0 },
  R4: { rotateX: 4,    translateZ: 1 },
  R5: { rotateX: 7,    translateZ: 3 }
};

/* ---------------------------------------------------------------------
   LEGENDS (§4.1) — key id → { main, sub? }
   --------------------------------------------------------------------- */

const LEGENDS = {
  esc: { main: "Esc" },
  f1: { main: "F1" },   f2: { main: "F2" },   f3: { main: "F3" },
  f4: { main: "F4" },   f5: { main: "F5" },   f6: { main: "F6" },
  f7: { main: "F7" },   f8: { main: "F8" },   f9: { main: "F9" },
  f10: { main: "F10" }, f11: { main: "F11" }, f12: { main: "F12" },
  prtsc: { main: "PrtSc" }, scrlk: { main: "ScrLk" }, pause: { main: "Pause" },

  grave: { main: "~", sub: "`" },
  d1: { main: "!", sub: "1" }, d2: { main: "@", sub: "2" },
  d3: { main: "#", sub: "3" }, d4: { main: "$", sub: "4" },
  d5: { main: "%", sub: "5" }, d6: { main: "^", sub: "6" },
  d7: { main: "&", sub: "7" }, d8: { main: "*", sub: "8" },
  d9: { main: "(", sub: "9" }, d0: { main: ")", sub: "0" },
  minus: { main: "_", sub: "-" }, equal: { main: "+", sub: "=" },
  bspc: { main: "⌫" },

  tab: { main: "Tab" },
  q: { main: "Q" }, w: { main: "W" }, e: { main: "E" }, r: { main: "R" },
  t: { main: "T" }, y: { main: "Y" }, u: { main: "U" }, i: { main: "I" },
  o: { main: "O" }, p: { main: "P" },
  lbrkt: { main: "{", sub: "[" }, rbrkt: { main: "}", sub: "]" },
  bslash: { main: "|", sub: "\\" },

  caps: { main: "Caps Lock" },
  a: { main: "A" }, s: { main: "S" }, d: { main: "D" }, f: { main: "F" },
  g: { main: "G" }, h: { main: "H" }, j: { main: "J" }, k: { main: "K" },
  l: { main: "L" },
  semi: { main: ":", sub: ";" }, quote: { main: '"', sub: "'" },
  enter: { main: "⏎" },

  lshift: { main: "Shift" },
  z: { main: "Z" }, x: { main: "X" }, c: { main: "C" }, v: { main: "V" },
  b: { main: "B" }, n: { main: "N" }, m: { main: "M" },
  comma: { main: "<", sub: "," }, dot: { main: ">", sub: "." },
  slash: { main: "?", sub: "/" },
  rshift: { main: "Shift" },

  lctrl: { main: "Ctrl" }, rctrl: { main: "Ctrl" },
  lalt: { main: "Alt" },  ralt: { main: "Alt" },
  lwin: { main: "❖" },    rwin: { main: "❖" },
  menu: { main: "☰" },    fn: { main: "Fn" },
  space: { main: "" },

  ins: { main: "Ins" },  del: { main: "Del" },
  home: { main: "Home" }, end: { main: "End" },
  pgup: { main: "PgUp" }, pgdn: { main: "PgDn" },

  up: { main: "↑" }, down: { main: "↓" }, left: { main: "←" }, right: { main: "→" },

  numlk: { main: "Num" },
  kpslash: { main: "/" }, kpast: { main: "*" },
  kpmin: { main: "−" },   kpplus: { main: "+" },
  kp7: { main: "7" }, kp8: { main: "8" }, kp9: { main: "9" },
  kp4: { main: "4" }, kp5: { main: "5" }, kp6: { main: "6" },
  kp1: { main: "1" }, kp2: { main: "2" }, kp3: { main: "3" },
  kp0: { main: "0" }, kpdot: { main: "." }, kpent: { main: "⏎" }
};

/* ---------------------------------------------------------------------
   KEY GROUPS (§4.1) — derived from id, used for keycap colour assignment
   --------------------------------------------------------------------- */

const MOD_IDS = new Set([
  "tab", "caps", "lshift", "rshift", "lctrl", "rctrl",
  "lalt", "ralt", "lwin", "rwin", "menu", "fn", "bspc"
]);

const NAV_IDS = new Set([
  "ins", "del", "home", "end", "pgup", "pgdn", "prtsc", "scrlk", "pause"
]);

const ARROW_IDS = new Set(["up", "down", "left", "right"]);

const HOMING_IDS = new Set(["f", "j", "kp5"]);

function groupForKey(id) {
  if (id === "esc") return "esc";
  if (id === "enter") return "enter";
  if (id === "space") return "space";
  if (/^f([1-9]|1[0-2])$/.test(id)) return "fn";
  if (ARROW_IDS.has(id)) return "arrow";
  if (NAV_IDS.has(id)) return "nav";
  if (id === "numlk" || id.startsWith("kp")) return "numpad";
  if (MOD_IDS.has(id)) return "mod";
  return "alpha";
}

/* ---------------------------------------------------------------------
   LAYOUTS (§4.2)

   Token grammar:  "id"  |  "id:w"  |  "id:w:h"  |  "gap:w"

   SPEC DEVIATION — one value, flagged deliberately:
   Full-size R3 is written in the spec as `enter:2.25 gap:3.25 kp4 …`.
   That places kp4 at x=18.25 while kp7/kp1 sit at x=18.5, misaligning the
   numpad column by 0.25u and making the row sum to 22.25u instead of the
   declared 22.5u. `gap:3.5` is used instead — it satisfies the spec's own
   acceptance test (row width == declared width) and aligns the column.
   --------------------------------------------------------------------- */

const FULL_ROWS = [
  { r: "R0", t: "esc gap:1 f1 f2 f3 f4 gap:0.5 f5 f6 f7 f8 gap:0.5 f9 f10 f11 f12 gap:0.25 prtsc scrlk pause" },
  { r: "R1", t: "grave d1 d2 d3 d4 d5 d6 d7 d8 d9 d0 minus equal bspc:2 gap:0.25 ins home pgup gap:0.25 numlk kpslash kpast kpmin" },
  { r: "R2", t: "tab:1.5 q w e r t y u i o p lbrkt rbrkt bslash:1.5 gap:0.25 del end pgdn gap:0.25 kp7 kp8 kp9 kpplus:1:2" },
  { r: "R3", t: "caps:1.75 a s d f g h j k l semi quote enter:2.25 gap:3.5 kp4 kp5 kp6" },
  { r: "R4", t: "lshift:2.25 z x c v b n m comma dot slash rshift:2.75 gap:1.25 up gap:1.25 kp1 kp2 kp3 kpent:1:2" },
  { r: "R5", t: "lctrl:1.25 lwin:1.25 lalt:1.25 space:6.25 ralt:1.25 rwin:1.25 menu:1.25 rctrl:1.25 gap:0.25 left down right gap:0.25 kp0:2 kpdot" }
];

// TKL 87 — "identical to full-size with all numlk/kp* tokens and the
// gap:0.25 before them removed." Derived, not retyped, so the two stay in sync.
const TKL_ROWS = FULL_ROWS.map(({ r, t }) => {
  const kept = [];
  const tokens = t.split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    const id = tokens[i].split(":")[0];
    if (id === "numlk" || id.startsWith("kp")) {
      // drop this token, and the spacer immediately preceding the cluster
      if (kept.length && kept[kept.length - 1].startsWith("gap:")) kept.pop();
      continue;
    }
    kept.push(tokens[i]);
  }
  // trim any trailing spacer left behind
  while (kept.length && kept[kept.length - 1].startsWith("gap:")) kept.pop();
  return { r, t: kept.join(" ") };
});

const LAYOUTS = [
  {
    id: "full",
    name: "Full-size ANSI",
    short: "104",
    widthU: 22.5,
    keyCount: 104,
    rows: FULL_ROWS
  },
  {
    id: "tkl",
    name: "TKL",
    short: "87",
    widthU: 18.25,
    keyCount: 87,
    rows: TKL_ROWS
  },
  {
    id: "75",
    name: "75%",
    short: "84",
    widthU: 16,
    keyCount: 84,
    rows: [
      { r: "R0", t: "esc f1 f2 f3 f4 f5 f6 f7 f8 f9 f10 f11 f12 prtsc scrlk del" },
      { r: "R1", t: "grave d1 d2 d3 d4 d5 d6 d7 d8 d9 d0 minus equal bspc:2 home" },
      { r: "R2", t: "tab:1.5 q w e r t y u i o p lbrkt rbrkt bslash:1.5 pgup" },
      { r: "R3", t: "caps:1.75 a s d f g h j k l semi quote enter:2.25 pgdn" },
      { r: "R4", t: "lshift:2.25 z x c v b n m comma dot slash rshift:1.75 up end" },
      { r: "R5", t: "lctrl:1.25 lwin:1.25 lalt:1.25 space:6.25 ralt fn rctrl left down right" }
    ]
  },
  {
    id: "65",
    name: "65%",
    short: "68",
    widthU: 16,
    keyCount: 68,
    rows: [
      { r: "R1", t: "grave d1 d2 d3 d4 d5 d6 d7 d8 d9 d0 minus equal bspc:2 del" },
      { r: "R2", t: "tab:1.5 q w e r t y u i o p lbrkt rbrkt bslash:1.5 home" },
      { r: "R3", t: "caps:1.75 a s d f g h j k l semi quote enter:2.25 pgup" },
      { r: "R4", t: "lshift:2.25 z x c v b n m comma dot slash rshift:1.75 up pgdn" },
      { r: "R5", t: "lctrl:1.25 lwin:1.25 lalt:1.25 space:6.25 ralt fn rctrl left down right" }
    ]
  },
  {
    id: "60",
    name: "60%",
    short: "61",
    widthU: 15,
    keyCount: 61,
    rows: [
      { r: "R1", t: "grave d1 d2 d3 d4 d5 d6 d7 d8 d9 d0 minus equal bspc:2" },
      { r: "R2", t: "tab:1.5 q w e r t y u i o p lbrkt rbrkt bslash:1.5" },
      { r: "R3", t: "caps:1.75 a s d f g h j k l semi quote enter:2.25" },
      { r: "R4", t: "lshift:2.25 z x c v b n m comma dot slash rshift:2.75" },
      { r: "R5", t: "lctrl:1.25 lwin:1.25 lalt:1.25 space:6.25 ralt:1.25 rwin:1.25 fn:1.25 rctrl:1.25" }
    ]
  },
  {
    id: "40",
    name: "40%",
    short: "40",
    widthU: 12,
    keyCount: 40,
    rows: [
      { r: "R1", t: "q w e r t y u i o p bspc:2" },
      { r: "R2", t: "esc:1.25 a s d f g h j k l enter:1.75" },
      { r: "R3", t: "lshift:1.75 z x c v b n m comma dot rshift:1.25" },
      { r: "R4", t: "lctrl:1.25 lwin:1.25 lalt:1.25 space:4.5 fn:1.25 ralt:1.25 rctrl:1.25" }
    ]
  }
];

/* ---------------------------------------------------------------------
   KEYCAP SETS (§5)

   Hex values are the spec's screen-calibrated approximations of the real
   GMK colorways. They are verbatim from the spec table — swap them here
   and nowhere else if real GMK chips are dialled in later.
   --------------------------------------------------------------------- */

// Resolution order for a key's role: overrides[id] → groupRoles[group] → "alpha"
const DEFAULT_GROUP_ROLES = {
  alpha: "alpha",
  mod: "mod",
  fn: "mod",
  nav: "mod",
  arrow: "mod",
  numpad: "mod",
  space: "mod",
  esc: "accent",
  enter: "accent"
};

const KEYCAP_SETS = [
  {
    id: "gmk-olivia",
    name: "GMK Olivia",
    designer: "Olivia",
    year: 2018,
    profile: "Cherry",
    material: "Doubleshot ABS",
    priceUSD: 319,
    chips: ["#E9CFC7", "#373335", "#B08D74"],
    roles: {
      alpha:  { cap: "#E9CFC7", legend: "#2E2A2B" },
      mod:    { cap: "#373335", legend: "#E9CFC7" },
      accent: { cap: "#B08D74", legend: "#241F20" }
    },
    groupRoles: { ...DEFAULT_GROUP_ROLES },
    overrides: { esc: "accent", enter: "accent", space: "mod" },
    blurb: "Dusty rose alphas, charcoal mods, rose-gold accents on Esc and Enter. The set that defined the aesthetic."
  },
  {
    id: "gmk-9009",
    name: "GMK 9009",
    designer: "Janglad (rev. of Cherry G80-9009)",
    year: 2019,
    profile: "Cherry",
    material: "Doubleshot ABS",
    priceUSD: 185,
    chips: ["#D7CEBF", "#A8A196", "#B2413C", "#4E7B6E"],
    roles: {
      alpha:   { cap: "#D7CEBF", legend: "#4A4744" },
      mod:     { cap: "#A8A196", legend: "#3A3835" },
      accent:  { cap: "#B2413C", legend: "#F0EAE0" },
      accent2: { cap: "#4E7B6E", legend: "#F0EAE0" }
    },
    groupRoles: { ...DEFAULT_GROUP_ROLES },
    overrides: { esc: "accent", enter: "accent2", space: "mod" },
    blurb: "Beige-on-beige with red and muted green accents. Reuters-terminal nostalgia."
  },
  {
    id: "gmk-laser",
    name: "GMK Laser",
    designer: "MiTo",
    year: 2018,
    profile: "Cherry",
    material: "Doubleshot ABS",
    priceUSD: 245,
    chips: ["#2B2140", "#3C2B58", "#F0407F", "#6B3FD4"],
    roles: {
      alpha:   { cap: "#2B2140", legend: "#37E2E2" },
      mod:     { cap: "#3C2B58", legend: "#F0407F" },
      accent:  { cap: "#F0407F", legend: "#1B1430" },
      // CONTRAST FIX: spec accent2 cap #8B5CF6 gave 2.34:1 against the
      // #22D3EE legend, below the §15 floor of 3:1. Violet deepened to
      // #6B3FD4 (3.54:1); the signature neon cyan legend is untouched.
      accent2: { cap: "#6B3FD4", legend: "#22D3EE" }
    },
    groupRoles: { ...DEFAULT_GROUP_ROLES, fn: "accent2" },
    overrides: { esc: "accent", enter: "accent", space: "mod" },
    blurb: "Synthwave. Deep violet base, cyan legends, hot-pink accents."
  },
  {
    id: "gmk-botanical",
    name: "GMK Botanical",
    designer: "Minterly",
    year: 2019,
    profile: "Cherry",
    material: "Doubleshot ABS",
    priceUSD: 175,
    chips: ["#EDE7DA", "#6B886A", "#2F5D46"],
    roles: {
      alpha:  { cap: "#EDE7DA", legend: "#27402F" },
      // CONTRAST FIX: spec mod cap #7F9C7E gave 2.62:1 against the cream
      // #F2EFE6 legend, below the §15 floor of 3:1. Sage deepened to
      // #6B886A (3.41:1); cream-on-green legends are kept as designed.
      mod:    { cap: "#6B886A", legend: "#F2EFE6" },
      accent: { cap: "#2F5D46", legend: "#EDE7DA" }
    },
    groupRoles: { ...DEFAULT_GROUP_ROLES },
    overrides: { esc: "accent", enter: "accent", space: "mod" },
    blurb: "Cream and two greens. The calmest set on the list."
  },
  {
    id: "gmk-bento",
    name: "GMK Bento R2",
    designer: "Biip",
    year: 2020,
    profile: "Cherry",
    material: "Doubleshot ABS",
    priceUSD: 189,
    chips: ["#EDEAE3", "#6E8194", "#E4948E", "#A9C6D6"],
    roles: {
      alpha:   { cap: "#EDEAE3", legend: "#2A3145" },
      mod:     { cap: "#6E8194", legend: "#F2F1EC" },
      accent:  { cap: "#E4948E", legend: "#2A3145" },
      accent2: { cap: "#A9C6D6", legend: "#2A3145" }
    },
    groupRoles: { ...DEFAULT_GROUP_ROLES, arrow: "accent2", nav: "accent2" },
    overrides: { esc: "accent", enter: "accent", space: "mod" },
    blurb: "Muted almost-pastels; salmon and pale blue over slate."
  },
  {
    id: "gmk-red-samurai",
    name: "GMK Red Samurai",
    designer: "Redsuns",
    year: 2019,
    profile: "Cherry",
    material: "Doubleshot ABS",
    priceUSD: 229,
    chips: ["#232527", "#A02128", "#C9A227"],
    roles: {
      alpha:  { cap: "#232527", legend: "#D9D6D0" },
      mod:    { cap: "#A02128", legend: "#C9A227" },
      accent: { cap: "#C9A227", legend: "#1A1B1D" }
    },
    groupRoles: { ...DEFAULT_GROUP_ROLES },
    overrides: { esc: "accent", enter: "accent", space: "mod" },
    blurb: "Near-black, crimson, gold. Aggressive and legible."
  },
  {
    id: "gmk-dracula",
    name: "GMK Dracula",
    designer: "Dracula Theme",
    year: 2020,
    profile: "Cherry",
    material: "Doubleshot ABS",
    priceUSD: 169,
    chips: ["#22212C", "#343746", "#BD93F9", "#50FA7B"],
    roles: {
      alpha:   { cap: "#22212C", legend: "#F8F8F2" },
      mod:     { cap: "#343746", legend: "#F8F8F2" },
      accent:  { cap: "#BD93F9", legend: "#22212C" },
      accent2: { cap: "#50FA7B", legend: "#22212C" }
    },
    groupRoles: { ...DEFAULT_GROUP_ROLES },
    overrides: { esc: "accent", enter: "accent2", space: "mod" },
    blurb: "The editor theme, in plastic. Purple, green and pink accents."
  },
  {
    id: "gmk-modern-dolch",
    name: "GMK Modern Dolch",
    designer: "MiTo",
    year: 2018,
    profile: "Cherry",
    material: "Doubleshot ABS",
    priceUSD: 239,
    chips: ["#C9C6C1", "#39393B", "#E07A5F", "#3D8A8A"],
    roles: {
      alpha:   { cap: "#C9C6C1", legend: "#2C2C2E" },
      mod:     { cap: "#39393B", legend: "#C9C6C1" },
      accent:  { cap: "#E07A5F", legend: "#26262A" },
      accent2: { cap: "#3D8A8A", legend: "#F0EDE8" }
    },
    groupRoles: { ...DEFAULT_GROUP_ROLES },
    overrides: { esc: "accent", enter: "accent2", space: "mod" },
    blurb: "Grey-on-grey with coral and teal. The universal pairing set."
  },
  {
    id: "gmk-metropolis",
    name: "GMK Metropolis R2",
    designer: "Zambumon",
    year: 2021,
    profile: "Cherry",
    material: "Doubleshot ABS",
    priceUSD: 179,
    chips: ["#2E3338", "#22262A", "#C7A252", "#7FD1C1"],
    roles: {
      alpha:   { cap: "#2E3338", legend: "#D8D3C6" },
      mod:     { cap: "#22262A", legend: "#C7A252" },
      accent:  { cap: "#C7A252", legend: "#1E2225" },
      accent2: { cap: "#7FD1C1", legend: "#22262A" }
    },
    groupRoles: { ...DEFAULT_GROUP_ROLES },
    overrides: { esc: "accent", enter: "accent2", space: "mod" },
    blurb: "Art-deco: dark slate with brass and a mint highlight."
  },
  {
    id: "gmk-oblivion",
    name: "GMK Oblivion V3",
    designer: "Oblotzky",
    year: 2020,
    profile: "Cherry",
    material: "Doubleshot ABS",
    priceUSD: 195,
    chips: ["#3A3F41", "#232729", "#4FB3A5"],
    roles: {
      alpha:  { cap: "#3A3F41", legend: "#D5D8D6" },
      mod:    { cap: "#232729", legend: "#4FB3A5" },
      accent: { cap: "#4FB3A5", legend: "#1A1D1F" }
    },
    groupRoles: { ...DEFAULT_GROUP_ROLES },
    overrides: { esc: "accent", enter: "accent", space: "mod" },
    blurb: "Industrial greys with a single cyan-teal accent."
  },
  {
    id: "gmk-nautilus",
    name: "GMK Nautilus",
    designer: "Nedlinin",
    year: 2019,
    profile: "Cherry",
    material: "Doubleshot ABS",
    priceUSD: 179,
    chips: ["#1E3348", "#152535", "#B98B4E", "#8FBFAE"],
    roles: {
      alpha:   { cap: "#1E3348", legend: "#E8E1D0" },
      mod:     { cap: "#152535", legend: "#B98B4E" },
      accent:  { cap: "#B98B4E", legend: "#132030" },
      accent2: { cap: "#8FBFAE", legend: "#152535" }
    },
    groupRoles: { ...DEFAULT_GROUP_ROLES },
    overrides: { esc: "accent", enter: "accent2", space: "mod" },
    blurb: "Deep navy, brass, sea-foam."
  },
  {
    id: "gmk-camping",
    name: "GMK Camping R3",
    designer: "Kaz",
    year: 2021,
    profile: "Cherry",
    material: "Doubleshot ABS",
    priceUSD: 169,
    chips: ["#E4D9C3", "#3C5A45", "#C96F35"],
    roles: {
      alpha:  { cap: "#E4D9C3", legend: "#4A3626" },
      mod:    { cap: "#3C5A45", legend: "#E9E1CE" },
      accent: { cap: "#C96F35", legend: "#2E2318" }
    },
    groupRoles: { ...DEFAULT_GROUP_ROLES },
    overrides: { esc: "accent", enter: "accent", space: "mod" },
    blurb: "Cream, forest green, burnt orange."
  },
  {
    id: "gmk-serika",
    name: "GMK Serika R2",
    designer: "Biip",
    year: 2020,
    profile: "Cherry",
    material: "Doubleshot ABS",
    priceUSD: 159,
    chips: ["#EDE9E0", "#3A3A3C", "#E3B23C"],
    roles: {
      alpha:  { cap: "#EDE9E0", legend: "#3A3A3C" },
      mod:    { cap: "#3A3A3C", legend: "#EDE9E0" },
      accent: { cap: "#E3B23C", legend: "#2C2C2E" }
    },
    groupRoles: { ...DEFAULT_GROUP_ROLES, fn: "accent" },
    overrides: { esc: "accent", enter: "accent", space: "mod" },
    blurb: "Off-white and dark grey with a mustard accent row."
  },
  {
    id: "gmk-wob",
    name: "GMK WoB",
    designer: "GMK stock",
    year: 2015,
    profile: "Cherry",
    material: "Doubleshot ABS",
    priceUSD: 125,
    chips: ["#1B1B1B", "#F0F0F0"],
    roles: {
      alpha:  { cap: "#1B1B1B", legend: "#F5F5F5" },
      mod:    { cap: "#1B1B1B", legend: "#F5F5F5" },
      accent: { cap: "#F0F0F0", legend: "#141414" }
    },
    groupRoles: { ...DEFAULT_GROUP_ROLES },
    overrides: { esc: "accent", enter: "accent", space: "mod" },
    blurb: "White on black. The default answer — pairs with everything."
  },
  {
    id: "gmk-taro",
    name: "GMK Taro R2",
    designer: "Fujitora",
    year: 2020,
    profile: "Cherry",
    material: "Doubleshot ABS",
    priceUSD: 175,
    chips: ["#EAE3EE", "#6E5A82", "#B79FD1"],
    roles: {
      alpha:  { cap: "#EAE3EE", legend: "#4A3C58" },
      mod:    { cap: "#6E5A82", legend: "#F2EEF5" },
      accent: { cap: "#B79FD1", legend: "#2E2438" }
    },
    groupRoles: { ...DEFAULT_GROUP_ROLES },
    overrides: { esc: "accent", enter: "accent", space: "mod" },
    blurb: "Lilac and cream, taro-milk-tea palette."
  },
  {
    // 16th option (§5): no legends, single colour taken from the case swatch list.
    id: "blanks",
    name: "Blanks",
    designer: "—",
    year: null,
    profile: "Cherry",
    material: "PBT, undyed",
    priceUSD: 95,
    blank: true,
    chips: ["#D9D7D2", "#B8BCBF", "#4A4E52"],
    roles: {
      alpha:  { cap: "#D9D7D2", legend: "transparent" },
      mod:    { cap: "#D9D7D2", legend: "transparent" },
      accent: { cap: "#D9D7D2", legend: "transparent" }
    },
    groupRoles: { ...DEFAULT_GROUP_ROLES, esc: "alpha", enter: "alpha" },
    overrides: {},
    blurb: "No legends, one colour, picked from the case swatch list. Reads cleanest in the exploded view."
  }
];

/* ---------------------------------------------------------------------
   SWITCHES (§6) — 32 options
   --------------------------------------------------------------------- */

const SWITCHES = [
  /* ---------- Linear — 13 ---------- */
  {
    id: "cherry-mx-red", name: "MX Red", brand: "Cherry", type: "linear",
    actuationG: 45, bottomOutG: 60, preTravelMm: 2.0, totalTravelMm: 4.0,
    stemMaterial: "POM", topHousingMaterial: "Nylon", bottomHousingMaterial: "Nylon",
    factoryLubed: false, colors: { top: "#1A1A1A", bottom: "#1A1A1A", stem: "#C8232B" },
    translucentTop: false, sound: "light, slightly hollow", pricePer10USD: 5.5,
    blurb: "The switch every prebuilt ships with. Unremarkable, and that is the point."
  },
  {
    id: "cherry-mx-black", name: "MX Black", brand: "Cherry", type: "linear",
    actuationG: 60, bottomOutG: 80, preTravelMm: 2.0, totalTravelMm: 4.0,
    stemMaterial: "POM", topHousingMaterial: "Nylon", bottomHousingMaterial: "Nylon",
    factoryLubed: false, colors: { top: "#1A1A1A", bottom: "#1A1A1A", stem: "#151515" },
    translucentTop: false, sound: "firm, muted", pricePer10USD: 5.5,
    blurb: "Heavy, unfashionable, and still the best typing spring weight Cherry ever shipped."
  },
  {
    id: "cherry-mx-speed-silver", name: "MX Speed Silver", brand: "Cherry", type: "linear",
    actuationG: 45, bottomOutG: 60, preTravelMm: 1.2, totalTravelMm: 3.4,
    stemMaterial: "POM", topHousingMaterial: "Nylon", bottomHousingMaterial: "Nylon",
    factoryLubed: false, colors: { top: "#1A1A1A", bottom: "#1A1A1A", stem: "#B9BEC3" },
    translucentTop: false, sound: "short and sharp", pricePer10USD: 6.5,
    blurb: "1.2mm actuation. Fast to the point of typos."
  },
  {
    id: "gateron-yellow", name: "Yellow (KS-9)", brand: "Gateron", type: "linear",
    actuationG: 50, bottomOutG: 67, preTravelMm: 2.0, totalTravelMm: 4.0,
    stemMaterial: "POM", topHousingMaterial: "PC", bottomHousingMaterial: "Nylon",
    factoryLubed: true, colors: { top: "#141414", bottom: "#141414", stem: "#F2C230" },
    translucentTop: false, sound: "full, forgiving", pricePer10USD: 2.2,
    blurb: "The budget benchmark. Nothing under twenty cents comes close."
  },
  {
    id: "gateron-milky-yellow-pro", name: "Milky Yellow Pro", brand: "Gateron", type: "linear",
    actuationG: 50, bottomOutG: 63, preTravelMm: 2.0, totalTravelMm: 4.0,
    stemMaterial: "POM", topHousingMaterial: "Milky Nylon", bottomHousingMaterial: "Milky Nylon",
    factoryLubed: true, colors: { top: "#EFEBE0", bottom: "#EFEBE0", stem: "#F5C63C" },
    translucentTop: false, sound: "deeper and rounder than standard Yellow", pricePer10USD: 3.0,
    blurb: "Milky housings swallow the high end. Same spring, different room."
  },
  {
    id: "gateron-red", name: "Red", brand: "Gateron", type: "linear",
    actuationG: 45, bottomOutG: 55, preTravelMm: 2.0, totalTravelMm: 4.0,
    stemMaterial: "POM", topHousingMaterial: "PC", bottomHousingMaterial: "Nylon",
    factoryLubed: false, colors: { top: "#D9DEE0", bottom: "#171717", stem: "#D8383F" },
    translucentTop: true, sound: "light and quiet", pricePer10USD: 2.4,
    blurb: "MX Red's smoother, cheaper replacement."
  },
  {
    id: "gateron-ink-black-v2", name: "Ink Black V2", brand: "Gateron", type: "linear",
    actuationG: 60, bottomOutG: 70, preTravelMm: 2.0, totalTravelMm: 4.0,
    stemMaterial: "POM", topHousingMaterial: "Ink (proprietary blend)", bottomHousingMaterial: "Ink (proprietary blend)",
    factoryLubed: true, colors: { top: "#2B2B33", bottom: "#2B2B33", stem: "#1B1B20" },
    translucentTop: true, sound: "dense, glassy, smoky housing", pricePer10USD: 7.0,
    blurb: "Smoked housings and a bottom-out that lands like a full stop."
  },
  {
    id: "gateron-oil-king", name: "Oil King", brand: "Gateron", type: "linear",
    actuationG: 55, bottomOutG: 65, preTravelMm: 2.0, totalTravelMm: 4.0,
    stemMaterial: "POM", topHousingMaterial: "Nylon (Ink base)", bottomHousingMaterial: "Nylon (Ink base)",
    factoryLubed: true, colors: { top: "#131313", bottom: "#0E0E0E", stem: "#171717" },
    translucentTop: false, sound: "deep patch, heavy factory lube", pricePer10USD: 6.5,
    blurb: "All-black nylon over the Ink base with a POM stem. The current default recommendation."
  },
  {
    id: "novelkeys-cream", name: "Cream", brand: "NovelKeys", type: "linear",
    actuationG: 55, bottomOutG: 70, preTravelMm: 2.0, totalTravelMm: 4.0,
    stemMaterial: "POM", topHousingMaterial: "POM", bottomHousingMaterial: "POM",
    factoryLubed: false, colors: { top: "#EFE6D2", bottom: "#EFE6D2", stem: "#EFE6D2" },
    translucentTop: false, sound: "bright POM-on-POM clack", pricePer10USD: 6.0,
    blurb: "Scratchy out of the box, transcendent after break-in. Divides rooms."
  },
  {
    id: "alpaca-v2", name: "Alpaca Linear V2", brand: "JWK / Prime", type: "linear",
    actuationG: 62, bottomOutG: 62, preTravelMm: 2.0, totalTravelMm: 4.0,
    stemMaterial: "POM", topHousingMaterial: "PC", bottomHousingMaterial: "Nylon",
    factoryLubed: true, colors: { top: "#C9D2D6", bottom: "#F1EEE8", stem: "#F5F2EC" },
    translucentTop: true, sound: "clean, poppy, marbly", pricePer10USD: 5.5,
    blurb: "The switch that made JWK moulds the industry standard."
  },
  {
    id: "tangerine-v2", name: "Tangerine V2 (65g)", brand: "C³Equalz", type: "linear",
    actuationG: 62, bottomOutG: 67, preTravelMm: 2.0, totalTravelMm: 4.0,
    stemMaterial: "UHMWPE", topHousingMaterial: "UHMWPE", bottomHousingMaterial: "UHMWPE",
    factoryLubed: true, colors: { top: "#F2F0E9", bottom: "#F2F0E9", stem: "#F58023" },
    translucentTop: false, sound: "very smooth, high-pitched", pricePer10USD: 6.0,
    blurb: "UHMWPE end to end. Frictionless and a little shrill."
  },
  {
    id: "tealios-v2", name: "Tealios V2", brand: "Zeal PC", type: "linear",
    actuationG: 67, bottomOutG: 67, preTravelMm: 2.0, totalTravelMm: 4.0,
    stemMaterial: "POM", topHousingMaterial: "PC", bottomHousingMaterial: "PC",
    factoryLubed: true, colors: { top: "#DCE9EA", bottom: "#DCE9EA", stem: "#0F9E9E" },
    translucentTop: true, sound: "the smoothness reference point", pricePer10USD: 11.0,
    blurb: "Expensive, and still the switch everything else gets measured against."
  },
  {
    id: "aqua-king-v3", name: "Aqua King V3", brand: "Everglide", type: "linear",
    actuationG: 62, bottomOutG: 62, preTravelMm: 2.0, totalTravelMm: 4.0,
    stemMaterial: "POM", topHousingMaterial: "PC", bottomHousingMaterial: "PC",
    factoryLubed: true, colors: { top: "#86CFD6", bottom: "#86CFD6", stem: "#DFF1F3" },
    translucentTop: true, sound: "muted and full", pricePer10USD: 5.0,
    blurb: "Translucent aqua housings. Looks like a boiled sweet, sounds like a brick."
  },

  /* ---------- Tactile — 9 ---------- */
  {
    id: "cherry-mx-brown", name: "MX Brown", brand: "Cherry", type: "tactile",
    actuationG: 45, bottomOutG: 55, preTravelMm: 2.0, totalTravelMm: 4.0,
    stemMaterial: "POM", topHousingMaterial: "Nylon", bottomHousingMaterial: "Nylon",
    factoryLubed: false, colors: { top: "#1A1A1A", bottom: "#1A1A1A", stem: "#6E4B32" },
    translucentTop: false, sound: "faint bump, office-safe", pricePer10USD: 5.5,
    blurb: "A linear that has heard of tactility."
  },
  {
    id: "cherry-mx-clear", name: "MX Clear", brand: "Cherry", type: "tactile",
    actuationG: 65, bottomOutG: 95, preTravelMm: 2.0, totalTravelMm: 4.0,
    stemMaterial: "POM", topHousingMaterial: "Nylon", bottomHousingMaterial: "Nylon",
    factoryLubed: false, colors: { top: "#1A1A1A", bottom: "#1A1A1A", stem: "#E4E2DC" },
    translucentTop: false, sound: "heavy, crisp", pricePer10USD: 7.0,
    blurb: "Heavy, crisp, and the origin of half the tactile switches on this list."
  },
  {
    id: "gateron-brown", name: "Brown", brand: "Gateron", type: "tactile",
    actuationG: 45, bottomOutG: 55, preTravelMm: 2.0, totalTravelMm: 4.0,
    stemMaterial: "POM", topHousingMaterial: "PC", bottomHousingMaterial: "Nylon",
    factoryLubed: false, colors: { top: "#141414", bottom: "#141414", stem: "#6B4A31" },
    translucentTop: false, sound: "smoother than MX Brown, same bump", pricePer10USD: 2.4,
    blurb: "Same faint bump, considerably less scratch."
  },
  {
    id: "boba-u4t", name: "Boba U4T", brand: "Gazzew", type: "tactile",
    actuationG: 62, bottomOutG: 68, preTravelMm: 2.0, totalTravelMm: 3.6,
    stemMaterial: "POM (long pole)", topHousingMaterial: "Boba plastic", bottomHousingMaterial: "Boba plastic",
    factoryLubed: true, colors: { top: "#141414", bottom: "#141414", stem: "#C9A227" },
    translucentTop: false, sound: "the thock reference", pricePer10USD: 7.5,
    blurb: "Black boba-plastic housing, gold long-pole stem, D-shaped bump. The thock reference."
  },
  {
    id: "glorious-panda", name: "Panda", brand: "Glorious", type: "tactile",
    actuationG: 67, bottomOutG: 67, preTravelMm: 2.0, totalTravelMm: 4.0,
    stemMaterial: "POM", topHousingMaterial: "PC", bottomHousingMaterial: "Nylon",
    factoryLubed: false, colors: { top: "#F2F2F0", bottom: "#171717", stem: "#8A5A3B" },
    translucentTop: false, sound: "loud, sharp, unmistakable", pricePer10USD: 6.5,
    blurb: "Loud enough that your housemates will develop an opinion."
  },
  {
    id: "holy-panda", name: "Holy Panda", brand: "Drop", type: "tactile",
    actuationG: 67, bottomOutG: 67, preTravelMm: 2.0, totalTravelMm: 4.0,
    stemMaterial: "POM", topHousingMaterial: "PC", bottomHousingMaterial: "Nylon",
    factoryLubed: false, colors: { top: "#EDEDEB", bottom: "#1A1A1A", stem: "#7E5136" },
    translucentTop: false, sound: "P-shaped bump, huge bottom-out", pricePer10USD: 9.0,
    blurb: "A P-shaped bump that falls off a cliff into the bottom-out."
  },
  {
    id: "zealios-v2-67", name: "Zealios V2 (67g)", brand: "Zeal PC", type: "tactile",
    actuationG: 67, bottomOutG: 67, preTravelMm: 2.0, totalTravelMm: 4.0,
    stemMaterial: "POM", topHousingMaterial: "PC", bottomHousingMaterial: "PC",
    factoryLubed: true, colors: { top: "#DCE9EA", bottom: "#DCE9EA", stem: "#7B4FA8" },
    translucentTop: true, sound: "rounded, refined tactility", pricePer10USD: 11.0,
    blurb: "Rounded rather than sharp. Refined, and priced accordingly."
  },
  {
    id: "akko-cream-blue-pro", name: "V3 Cream Blue Pro", brand: "Akko", type: "tactile",
    actuationG: 45, bottomOutG: 55, preTravelMm: 1.9, totalTravelMm: 3.5,
    stemMaterial: "POM", topHousingMaterial: "PC", bottomHousingMaterial: "Nylon",
    factoryLubed: true, colors: { top: "#F0EBDC", bottom: "#F0EBDC", stem: "#3A6FB0" },
    translucentTop: false, sound: "light bump, cream housing warmth", pricePer10USD: 3.0,
    blurb: "Cheap, light, and warmer than anything else at the price."
  },
  {
    id: "kailh-box-brown", name: "Box Brown", brand: "Kailh", type: "tactile",
    actuationG: 45, bottomOutG: 60, preTravelMm: 1.8, totalTravelMm: 3.6,
    stemMaterial: "POM (boxed)", topHousingMaterial: "PC", bottomHousingMaterial: "Nylon",
    factoryLubed: false, colors: { top: "#EFEDE6", bottom: "#EFEDE6", stem: "#7A5138" },
    translucentTop: false, sound: "boxed stem, minimal wobble", pricePer10USD: 4.0,
    blurb: "The boxed stem kills wobble. Dust and water bounce off it too."
  },

  /* ---------- Clicky — 5 ---------- */
  {
    id: "cherry-mx-blue", name: "MX Blue", brand: "Cherry", type: "clicky",
    actuationG: 50, bottomOutG: 60, preTravelMm: 2.2, totalTravelMm: 4.0,
    stemMaterial: "POM (two-piece)", topHousingMaterial: "Nylon", bottomHousingMaterial: "Nylon",
    factoryLubed: false, colors: { top: "#1A1A1A", bottom: "#1A1A1A", stem: "#2C6FBB" },
    translucentTop: false, sound: "the original click-leaf", pricePer10USD: 5.5,
    blurb: "The sound everyone means when they say mechanical keyboard."
  },
  {
    id: "gateron-blue", name: "Blue", brand: "Gateron", type: "clicky",
    actuationG: 50, bottomOutG: 60, preTravelMm: 2.3, totalTravelMm: 4.0,
    stemMaterial: "POM (two-piece)", topHousingMaterial: "PC", bottomHousingMaterial: "Nylon",
    factoryLubed: false, colors: { top: "#D9DEE0", bottom: "#171717", stem: "#2E6FB8" },
    translucentTop: true, sound: "softer click than MX", pricePer10USD: 2.4,
    blurb: "A gentler click jacket. Still audible from the next room."
  },
  {
    id: "kailh-box-jade", name: "Box Jade", brand: "Kailh", type: "clicky",
    actuationG: 50, bottomOutG: 62, preTravelMm: 1.8, totalTravelMm: 3.6,
    stemMaterial: "POM (boxed)", topHousingMaterial: "PC", bottomHousingMaterial: "Nylon",
    factoryLubed: false, colors: { top: "#EFEDE6", bottom: "#EFEDE6", stem: "#3FA05F" },
    translucentTop: false, sound: "click bar — thick, loud, satisfying", pricePer10USD: 4.5,
    blurb: "A click bar instead of a jacket. Thicker and far more satisfying."
  },
  {
    id: "kailh-box-navy", name: "Box Navy", brand: "Kailh", type: "clicky",
    actuationG: 70, bottomOutG: 95, preTravelMm: 1.8, totalTravelMm: 3.6,
    stemMaterial: "POM (boxed)", topHousingMaterial: "PC", bottomHousingMaterial: "Nylon",
    factoryLubed: false, colors: { top: "#F2F0E8", bottom: "#F2F0E8", stem: "#1E3E7A" },
    translucentTop: false, sound: "extremely heavy", pricePer10USD: 4.5,
    blurb: "95g bottom-out. A novelty for most hands, not a daily driver."
  },
  {
    id: "kailh-box-white", name: "Box White", brand: "Kailh", type: "clicky",
    actuationG: 45, bottomOutG: 55, preTravelMm: 1.8, totalTravelMm: 3.6,
    stemMaterial: "POM (boxed)", topHousingMaterial: "PC", bottomHousingMaterial: "Nylon",
    factoryLubed: false, colors: { top: "#E2E8EA", bottom: "#E2E8EA", stem: "#F4F4F0" },
    translucentTop: true, sound: "light, high-pitched click bar", pricePer10USD: 4.0,
    blurb: "The click bar at half the weight. Chatty rather than aggressive."
  },

  /* ---------- Silent — 5 ---------- */
  {
    id: "cherry-mx-silent-red", name: "MX Silent Red", brand: "Cherry", type: "silent-linear",
    actuationG: 45, bottomOutG: 60, preTravelMm: 1.9, totalTravelMm: 3.7,
    stemMaterial: "POM + rubber dampeners", topHousingMaterial: "Nylon", bottomHousingMaterial: "Nylon",
    factoryLubed: false, colors: { top: "#1A1A1A", bottom: "#1A1A1A", stem: "#C4636B" },
    translucentTop: false, sound: "dampened, slightly mushy", pricePer10USD: 8.0,
    blurb: "Quiet, at the cost of a crisp bottom-out."
  },
  {
    id: "boba-u4", name: "Boba U4", brand: "Gazzew", type: "silent-tactile",
    actuationG: 62, bottomOutG: 68, preTravelMm: 2.0, totalTravelMm: 3.5,
    stemMaterial: "POM + silicone dampeners", topHousingMaterial: "Boba plastic", bottomHousingMaterial: "Boba plastic",
    factoryLubed: true, colors: { top: "#141414", bottom: "#141414", stem: "#E9E6DE" },
    translucentTop: false, sound: "the silent tactile benchmark", pricePer10USD: 8.0,
    blurb: "Black housing, white stem, and no meaningful competition in silent tactile."
  },
  {
    id: "healios-v2", name: "Healios V2", brand: "Zeal PC", type: "silent-linear",
    actuationG: 67, bottomOutG: 67, preTravelMm: 1.9, totalTravelMm: 3.6,
    stemMaterial: "POM + silicone dampeners", topHousingMaterial: "PC", bottomHousingMaterial: "PC",
    factoryLubed: true, colors: { top: "#DCE9EA", bottom: "#DCE9EA", stem: "#1E1E20" },
    translucentTop: true, sound: "near-inaudible", pricePer10USD: 12.0,
    blurb: "As close to silent as a mechanical switch gets."
  },
  {
    id: "sakurios", name: "Sakurios", brand: "Zeal PC", type: "silent-linear",
    actuationG: 62, bottomOutG: 62, preTravelMm: 1.9, totalTravelMm: 3.6,
    stemMaterial: "POM + silicone dampeners", topHousingMaterial: "PC", bottomHousingMaterial: "PC",
    factoryLubed: true, colors: { top: "#DCE9EA", bottom: "#DCE9EA", stem: "#F0B7C4" },
    translucentTop: true, sound: "silent linear, lighter than Healios", pricePer10USD: 12.0,
    blurb: "Healios with five grams taken off the top."
  },
  {
    id: "gateron-silent-red", name: "Silent Red", brand: "Gateron", type: "silent-linear",
    actuationG: 45, bottomOutG: 55, preTravelMm: 1.9, totalTravelMm: 3.7,
    stemMaterial: "POM + rubber dampeners", topHousingMaterial: "Milky Nylon", bottomHousingMaterial: "Milky Nylon",
    factoryLubed: false, colors: { top: "#EFEBE0", bottom: "#EFEBE0", stem: "#D26A72" },
    translucentTop: false, sound: "budget silence", pricePer10USD: 3.5,
    blurb: "A third of the price of the Zeal silents and most of the quiet."
  }
];

// Filter chips across the top of §03 (§3). "Silent" folds both silent types.
const SWITCH_FILTERS = [
  { id: "all",     label: "All",     match: () => true },
  { id: "linear",  label: "Linear",  match: (s) => s.type === "linear" },
  { id: "tactile", label: "Tactile", match: (s) => s.type === "tactile" },
  { id: "clicky",  label: "Clicky",  match: (s) => s.type === "clicky" },
  { id: "silent",  label: "Silent",  match: (s) => s.type.startsWith("silent") }
];

const SWITCH_SORTS = [
  { id: "weight", label: "Weight" },
  { id: "price",  label: "Price" },
  { id: "brand",  label: "Brand" }
];

const SWITCH_TYPE_LABELS = {
  "linear": "Linear",
  "tactile": "Tactile",
  "clicky": "Clicky",
  "silent-linear": "Silent linear",
  "silent-tactile": "Silent tactile"
};

/* ---------------------------------------------------------------------
   CASES (§7) — casePrice fixed per case, 149–329 (§13)
   --------------------------------------------------------------------- */

const CASES = [
  { id: "silver",     name: "Silver",         finish: "anodized aluminium",  body: "#B8BCBF", accent: "#8C9093", priceUSD: 219, weightG: 1650, notes: "Neutral, brightest." },
  { id: "space-grey", name: "Space Grey",     finish: "anodized aluminium",  body: "#4A4E52", accent: "#33373A", priceUSD: 219, weightG: 1650, notes: "The default." },
  { id: "black",      name: "Black",          finish: "anodized aluminium",  body: "#1C1E20", accent: "#121416", priceUSD: 219, weightG: 1650, notes: "" },
  { id: "e-white",    name: "E-White",        finish: "electrophoretic",     body: "#E8E7E2", accent: "#CFCEC8", priceUSD: 239, weightG: 1650, notes: "Warm off-white." },
  { id: "navy",       name: "Navy",           finish: "anodized aluminium",  body: "#243247", accent: "#18222F", priceUSD: 249, weightG: 1650, notes: "" },
  { id: "burgundy",   name: "Burgundy",       finish: "anodized aluminium",  body: "#4A2028", accent: "#33161C", priceUSD: 249, weightG: 1650, notes: "" },
  { id: "polycarb",   name: "Polycarbonate",  finish: "frosted translucent", body: "#DCDCD6", accent: "#B9B9B2", priceUSD: 149, weightG: 780,  bodyAlpha: 0.7, frosted: true, notes: "Frosted translucent — rendered with backdrop blur and an edge glow." },
  { id: "brass",      name: "Brass (full)",   finish: "raw brass",           body: "#B08D4E", accent: "#8A6C36", priceUSD: 329, weightG: 3400, heavy: true, notes: "Heaviest by a wide margin." }
];

const MOUNTS = [
  { id: "gasket", name: "Gasket",  blurb: "Plate suspended on Poron socks. Softest typing feel, most isolation." },
  { id: "top",    name: "Top",     blurb: "Plate sandwiched into the top case. Firm and uniform." },
  { id: "tray",   name: "Tray",    blurb: "PCB screwed to bottom-case standoffs. Cheapest, most uneven." },
  { id: "o-ring", name: "O-ring",  blurb: "Plate held between silicone rings. Bouncy, slightly hollow." }
];

/* ---------------------------------------------------------------------
   EXPLODED-VIEW LAYER STACK (§11)
   thickness in px; spread = max separation in px at explode 100
   --------------------------------------------------------------------- */

const LAYERS = [
  { id: "keycaps",    label: "Keycaps — {set}",                thickness: 9,   spread: 300 },
  { id: "switches",   label: "Switches — {switch} ×{n}",       thickness: 12,  spread: 250 },
  { id: "plate",      label: "Switch plate — {plateMaterial}", thickness: 1.5, spread: 200, color: "#8E9296" },
  { id: "gaskets",    label: "Poron gasket socks ×12",         thickness: 2,   spread: 175, color: "#3A3B3E", mounts: ["gasket"] },
  { id: "mount-hw",   label: "{mountHardware}",                thickness: 2,   spread: 175, color: "#3A3B3E", mounts: ["top", "tray", "o-ring"] },
  { id: "plate-foam", label: "Plate foam — Poron 3mm",         thickness: 3,   spread: 160, color: "#2A2B2D" },
  { id: "pcb",        label: "PCB — hotswap, {n} keys",        thickness: 1.6, spread: 120, color: "#12312A", trace: "#C9A94E" },
  { id: "pe-foam",    label: "PE foam — 0.4mm",                thickness: 1,   spread: 85,  color: "rgba(240,240,235,.55)" },
  { id: "case-foam",  label: "Case foam — Poron 4mm",          thickness: 4,   spread: 50,  color: "#26272A" },
  { id: "case",       label: "Bottom case — {case}",           thickness: 26,  spread: 0 }
];

const MOUNT_HARDWARE_LABEL = {
  "top":    "Standoffs + hardware",
  "tray":   "Standoffs + hardware",
  "o-ring": "O-ring — silicone"
};

/* ---------------------------------------------------------------------
   DEFAULT STATE (§10)
   --------------------------------------------------------------------- */

const DEFAULT_STATE = {
  layout: "tkl",
  caseId: "space-grey",
  mount: "gasket",
  keycapSetId: "gmk-olivia",
  blankColor: "#E8E7E2",   // only used by the Blanks set (§5)
  switchId: "gateron-oil-king",
  sound: true,            // switch audio on/off (§ added: sound checks)
  explode: 0,
  isolatedLayer: null,
  autoRotate: false
};

const STORAGE_KEY_LAST = "kbcfg:last";
const STORAGE_KEY_SAVED = "kbcfg:saved";
const MAX_SAVED_BUILDS = 8;
