/* =====================================================================
   app.js — Phases 1–6 (complete).

   Phase 1: shell wiring, data validation.
   Phase 2: token parser, unit→pixel math, row sculpting, keycap and case
            rendering, the live stage, rail controls wired.
   Phase 3: role resolution, set application, the §02 gallery, Blanks
            colour picking, dynamic --accent tinting.
   Phase 4: switch rendering, the §03 gallery with filter + sort, and
            synthesised switch audio (sound checks).

   Phase 5: the §04 exploded assembly — layer stack, slider, play, isolate,
            auto-rotate, leader-line annotation, per-mount layer variation.

   Phase 6: URL hash + localStorage, saved builds, shortcuts, the §05 spec
            sheet and exports, and the §15 acceptance checklist.
   ===================================================================== */

"use strict";

/* =====================================================================
   LAYOUT ENGINE — token parser and unit math (§4.1)

   No hardcoded pixel positions anywhere. Everything below is in units;
   px conversion happens in one place (`px`), derived from U / GAP.
   ===================================================================== */

/**
 * Parse one token.
 *   "id" | "id:w" | "id:w:h" | "gap:w"
 * @returns {{id:string, w:number, h:number, spacer:boolean}}
 */
function parseToken(token) {
  const parts = token.split(":");
  const id = parts[0];
  const w = parts.length > 1 ? parseFloat(parts[1]) : 1;
  const h = parts.length > 2 ? parseFloat(parts[2]) : 1;

  if (!id) throw new Error(`Empty key id in token "${token}"`);
  if (!Number.isFinite(w) || w <= 0) throw new Error(`Bad width in token "${token}"`);
  if (!Number.isFinite(h) || h <= 0) throw new Error(`Bad height in token "${token}"`);

  return { id, w, h, spacer: id === "gap" };
}

/** Unit → pixel conversions. Cap is (units * U) - GAP wide. */
const px = {
  capW: (u) => u * U - GAP,
  capH: (u) => u * U - ROW_GAP,
  x:    (u) => u * U,
  y:    (u) => u * U
};

/**
 * Expand a layout definition into positioned keys.
 * @returns {{keys:Array, rows:Array, widthU:number, heightU:number, keyCount:number}}
 */
function buildGeometry(layout) {
  const keys = [];
  const rows = [];
  let maxRight = 0;
  let maxBottom = 0;

  layout.rows.forEach((row, rowIndex) => {
    let x = 0;
    let col = 0;
    const tokens = row.t.trim().split(/\s+/);

    for (const token of tokens) {
      const { id, w, h, spacer } = parseToken(token);
      if (spacer) { x += w; continue; }

      keys.push({
        id,
        group: groupForKey(id),
        legend: LEGENDS[id] || { main: id },
        homing: HOMING_IDS.has(id),
        u: w,
        hu: h,
        x,                    // units from the left edge of the board
        y: rowIndex,          // units from the top edge
        row: rowIndex,
        rowLabel: row.r,
        col: col++,
        sculpt: SCULPT[row.r] || SCULPT.R3
      });

      x += w;
      maxRight = Math.max(maxRight, x);
      maxBottom = Math.max(maxBottom, rowIndex + h);
    }

    rows.push({
      label: row.r,
      index: rowIndex,
      widthU: round2(x),
      keyCount: tokens.filter(t => !t.startsWith("gap:")).length
    });
  });

  return {
    keys,
    rows,
    widthU: round2(maxRight),
    heightU: round2(maxBottom),
    keyCount: keys.length
  };
}

function round2(n) { return Math.round(n * 100) / 100; }

/** Geometry for every layout, built once at load. */
const GEOMETRY = Object.fromEntries(LAYOUTS.map(l => [l.id, buildGeometry(l)]));

function getLayout(id)    { return LAYOUTS.find(l => l.id === id); }
function getKeycapSet(id) { return KEYCAP_SETS.find(s => s.id === id); }
function getSwitch(id)    { return SWITCHES.find(s => s.id === id); }
function getCase(id)      { return CASES.find(c => c.id === id); }
function getMount(id)     { return MOUNTS.find(m => m.id === id); }

/**
 * Resolve a key's keycap role (§5): overrides[id] → groupRoles[group] → "alpha".
 * Falls back to the alpha role if a set omits the resolved role.
 */
function resolveRole(set, key) {
  const roleName = set.overrides[key.id] || set.groupRoles[key.group] || "alpha";
  return { name: roleName, ...(set.roles[roleName] || set.roles.alpha) };
}

/**
 * Blanks is the one set whose colour is not fixed in the data (§5): it has
 * no legends and a single cap colour the user picks from the case swatch
 * list. Resolve that here so every consumer — board, gallery, spec sheet —
 * sees a normal-looking set.
 */
function effectiveSet(set, st) {
  if (!set.blank) return set;
  const cap = st.blankColor || set.roles.alpha.cap;
  const roles = {};
  for (const name of Object.keys(set.roles)) roles[name] = { cap, legend: "transparent" };
  return { ...set, roles };
}

/** Wide keys centre their legend instead of sitting top-left (§8). */
const CENTERED_IDS = new Set(["lshift", "rshift", "enter", "space"]);
function isCentered(key) { return key.u >= 2 || CENTERED_IDS.has(key.id); }

/* =====================================================================
   CONTRAST — WCAG relative luminance, for the ≥ 3:1 legend gate (§15)
   ===================================================================== */

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
}

function relativeLuminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return round2((hi + 0.05) / (lo + 0.05));
}

/* =====================================================================
   BOARD RENDERER (§4.3 sculpting, §8 keycap + case rendering)

   One renderer drives one mount. Caps are created once and thereafter
   only their CSS custom properties are mutated (§11 performance note);
   a layout change reconciles by key id, so caps that exist in both
   layouts animate to their new slot rather than being torn down.
   ===================================================================== */

function el(tag, cls) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
}

const BEZEL = 18;       // px, sides + bottom — matches --bezel
const BEZEL_TOP = 22;   // px — matches --bezel-top
const LIP = 12;         // px front lip

class BoardRenderer {
  constructor(mount, opts) {
    opts = opts || {};
    this.mount = mount;
    this.interactive = opts.interactive !== false;
    // "bare" drops the case shell and self-scaling: the exploded view needs
    // just the cap grid, sized in board px, inside its own layer (§11 says
    // one code path renders both the preview and the exploded stack).
    this.bare = !!opts.bare;
    if (this.bare) this.interactive = false;
    this.caps = new Map();          // key id → element
    this.currentLayout = null;
    this.state = null;
    this.staggerTimer = null;
    this._build();

    if (!this.bare && "ResizeObserver" in window) {
      this._ro = new ResizeObserver(() => this.fit());
      this._ro.observe(this.mount);
    }

    // An off-screen board (the decorative hero one, most of the time) does
    // not need to repaint on every state change — mark it dirty and flush
    // when it scrolls back into view.
    this.visible = true;
    this._dirty = false;
    if ("IntersectionObserver" in window) {
      this._io = new IntersectionObserver(([entry]) => {
        this.visible = entry.isIntersecting;
        if (this.visible && this._dirty) {
          this._dirty = false;
          this._render(this._pending);
        }
      }, { rootMargin: "200px" });
      this._io.observe(this.mount);
    }
  }

  render(state) {
    this._pending = state;
    if (!this.visible) { this._dirty = true; return; }
    this._render(state);
  }

  _build() {
    this.mount.textContent = "";

    if (this.bare) {
      this.keys = el("div", "board__keys");
      this.mount.append(this.keys);
      return;
    }

    this.fitBox = el("div", "board-fit");
    this.spin  = el("div", "board-spin");
    this.board = el("div", "board" + (this.interactive ? " board--interactive" : ""));
    this.shell = el("div", "case-shell");
    this.lip   = el("div", "case-lip");
    this.badge = el("div", "case-badge");
    this.ground = el("div", "case-ground");
    this.keys  = el("div", "board__keys");

    this.shell.append(this.lip, this.badge);
    this.board.append(this.ground, this.shell, this.keys);
    this.spin.append(this.board);
    this.fitBox.append(this.spin);
    this.mount.append(this.fitBox);

    if (this.interactive) {
      this.tooltip = el("div", "cap-tooltip");
      this.mount.append(this.tooltip);
      this.keys.addEventListener("pointerover", (e) => this._onHover(e));
      this.keys.addEventListener("pointerout",  (e) => this._onLeave(e));
      // A key press is the most direct way to hear the selected switch.
      this.keys.addEventListener("pointerdown", (e) => {
        const cap = e.target.closest(".cap");
        if (cap && this.state) SwitchAudio.play(getSwitch(this.state.switchId));
      });
    }
  }

  /* --- one cap element, built once per key id --- */
  _createCap(key) {
    const cap = el("div", "cap is-entering");
    cap.dataset.key = key.id;

    const legend = el("div", "cap__legend");
    if (key.id !== "space") {
      // main above sub — LEGENDS stores the shifted glyph as `main`
      const main = el("span", "cap__main");
      main.textContent = key.legend.main;
      legend.append(main);
      if (key.legend.sub) {
        const sub = el("span", "cap__sub");
        sub.textContent = key.legend.sub;
        legend.append(sub);
      }
    }
    cap.append(legend);
    if (key.homing) cap.classList.add("cap--homing");

    return cap;
  }

  /* --- write the CSS custom properties for one cap --- */
  /**
   * Write only what changed. A colour swap touches 2 properties per cap;
   * a layout swap touches all of them. Splitting these is what keeps a set
   * change inside one frame on a 104-key board (§14 Phase 3 gate).
   */
  _applyCap(cap, key, set, stagger, geometry, colour) {
    if (geometry) {
      cap.style.setProperty("--x",  px.x(key.x) + "px");
      cap.style.setProperty("--y",  px.y(key.y) + "px");
      cap.style.setProperty("--z",  key.sculpt.translateZ + "px");
      cap.style.setProperty("--rx", key.sculpt.rotateX + "deg");
      cap.style.setProperty("--w",  px.capW(key.u) + "px");
      cap.style.setProperty("--h",  px.capH(key.hu) + "px");
      cap.classList.toggle("cap--center", isCentered(key));
      cap.style.setProperty("--stagger", stagger);
      cap._ripple = (key.row * 20 + key.col * 8) + "ms";
    }
    if (colour) {
      const role = resolveRole(set, key);
      cap.style.setProperty("--cap", role.cap);
      cap.style.setProperty("--legend", role.legend);
      cap.dataset.role = role.name;
    }
  }

  _render(state) {
    this.state = state;
    const layout = getLayout(state.layout);
    const geo = GEOMETRY[state.layout];
    const set = effectiveSet(getKeycapSet(state.keycapSetId), state);
    const kase = getCase(state.caseId);

    const last = this._last || {};
    const layoutChanged = last.layout !== state.layout;
    const colourChanged = last.setId !== state.keycapSetId || last.blankColor !== state.blankColor;
    const caseChanged   = last.caseId !== state.caseId;

    /* case shell */
    if (!this.bare && (caseChanged || layoutChanged)) {
      this.board.style.setProperty("--case-body", caseBodyColor(kase));
      this.board.style.setProperty("--case-accent", kase.accent);
      this.shell.classList.toggle("case-shell--frosted", !!kase.frosted);
    }

    /* board box, in units → px */
    if (!this.bare && layoutChanged) {
      this.badge.textContent = layout.name;
      this.board.style.setProperty("--board-w", px.x(geo.widthU) + "px");
      this.board.style.setProperty("--board-h", px.y(geo.heightU) + "px");
    }

    /* reconcile caps by key id */
    const seen = new Set();
    for (const key of geo.keys) {
      seen.add(key.id);
      let cap = this.caps.get(key.id);
      const isNew = !cap;
      if (isNew) {
        cap = this._createCap(key);
        this.caps.set(key.id, cap);
        this.keys.append(cap);
      }
      // per-key stagger on a layout swap so the change ripples across (§9)
      const stagger = layoutChanged ? `${key.row * 20 + key.col * 8}ms` : "0ms";
      this._applyCap(cap, key, set, stagger, isNew || layoutChanged, isNew || colourChanged);
      if (isNew) requestAnimationFrame(() => cap.classList.remove("is-entering"));
    }

    if (layoutChanged) {
      /* retire caps this layout does not have */
      for (const [id, cap] of [...this.caps]) {
        if (seen.has(id)) continue;
        this.caps.delete(id);
        cap.classList.add("is-leaving");
        setTimeout(() => cap.remove(), 460);
      }
      /* clear stagger once the ripple has played, so later swaps are instant */
      clearTimeout(this.staggerTimer);
      this.staggerTimer = setTimeout(() => {
        this.caps.forEach(c => c.style.setProperty("--stagger", "0ms"));
      }, 900);
    }

    this._last = {
      layout: state.layout, setId: state.keycapSetId,
      blankColor: state.blankColor, caseId: state.caseId
    };
    this.currentLayout = state.layout;
    if (layoutChanged && !this.bare) this.fit();   // geometry only changes with the layout
  }

  /**
   * Replay the per-key stagger without a layout change, so Randomize
   * ripples across the board even when the layout happens to repeat (§10).
   */
  ripple() {
    if (this.bare || prefersReducedMotion()) return;
    this.caps.forEach(cap => cap.style.setProperty("--stagger", cap._ripple || "0ms"));
    clearTimeout(this.staggerTimer);
    this.staggerTimer = setTimeout(() => {
      this.caps.forEach(cap => cap.style.setProperty("--stagger", "0ms"));
    }, 900);
  }

  /** Scale the board so it always fits its stage without cropping. */
  fit() {
    if (!this.state || this.bare) return;
    const geo = GEOMETRY[this.state.layout];
    const cs = getComputedStyle(this.mount);
    const availW = this.mount.clientWidth  - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const availH = this.mount.clientHeight - parseFloat(cs.paddingTop)  - parseFloat(cs.paddingBottom);
    if (availW <= 0 || availH <= 0) return;

    // --tilt is fixed per mount by CSS; read it once.
    if (this._tilt == null) {
      this._tilt = parseFloat(getComputedStyle(this.board).getPropertyValue("--tilt")) || 16;
    }
    const boardW = px.x(geo.widthU) + BEZEL * 2;
    const boardH = px.y(geo.heightU) + BEZEL_TOP + BEZEL;
    const projH = boardH * Math.cos(this._tilt * Math.PI / 180) + LIP + 46;  // + ground shadow

    const scale = Math.min(1, availW / boardW, availH / projH);
    this.board.style.setProperty("--scale", scale.toFixed(4));

    // Reserve the scaled footprint so the stage can centre the board.
    this.fitBox.style.setProperty("--fit-w", `${boardW * scale}px`);
    this.fitBox.style.setProperty("--fit-h", `${projH * scale}px`);
  }

  /* --- hover tooltip: key id, resolved role, switch + actuation (§8) --- */
  _onHover(e) {
    const cap = e.target.closest(".cap");
    if (!cap || !this.state) return;
    const sw = getSwitch(this.state.switchId);
    const geo = GEOMETRY[this.state.layout];
    const key = geo.keys.find(k => k.id === cap.dataset.key);
    if (!key) return;

    this.tooltip.innerHTML =
      `<div><span class="k">key</span> ${key.id}</div>` +
      `<div><span class="k">role</span> ${cap.dataset.role} · ${key.group}</div>` +
      `<div><span class="k">sw</span> ${sw.brand} ${sw.name} · ${sw.actuationG}g</div>`;

    const r = cap.getBoundingClientRect();
    const m = this.mount.getBoundingClientRect();
    this.tooltip.style.left = `${r.left - m.left + r.width / 2}px`;
    this.tooltip.style.top  = `${r.top - m.top}px`;
    this.tooltip.classList.add("is-on");
  }

  _onLeave(e) {
    if (e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest(".cap")) return;
    this.tooltip.classList.remove("is-on");
  }
}

/** Polycarbonate renders translucent (§7), everything else is opaque. */
function caseBodyColor(kase) {
  if (kase.bodyAlpha == null) return kase.body;
  const [r, g, b] = hexToRgb(kase.body);
  return `rgba(${r},${g},${b},${kase.bodyAlpha})`;
}

/* =====================================================================
   VALIDATION — the Phase 1 acceptance gate
   ===================================================================== */

function validate() {
  const problems = [];

  /* --- Layouts: key counts and declared widths --- */
  const layoutReport = LAYOUTS.map(l => {
    const g = GEOMETRY[l.id];
    const countOK = g.keyCount === l.keyCount;
    const widthOK = g.widthU === l.widthU;
    if (!countOK) problems.push(`${l.id}: key count ${g.keyCount}, expected ${l.keyCount}`);
    if (!widthOK) problems.push(`${l.id}: width ${g.widthU}u, declared ${l.widthU}u`);

    const over = g.rows.filter(r => r.widthU > l.widthU);
    if (over.length) problems.push(`${l.id}: rows exceed declared width — ${over.map(r => r.label).join(", ")}`);

    // Overlap check: no two keys may occupy the same cell (§14 Phase 2 gate)
    const occupied = new Set();
    for (const k of g.keys) {
      for (let dy = 0; dy < k.hu; dy++) {
        // sample every quarter-unit across the key's width
        for (let s = 0; s < k.u * 4; s++) {
          const cell = `${k.y + dy}:${round2(k.x + s / 4)}`;
          if (occupied.has(cell)) problems.push(`${l.id}: overlap at row ${k.y + dy} near ${k.id}`);
          occupied.add(cell);
        }
      }
    }

    // Duplicate ids would break cap reconciliation
    const ids = g.keys.map(k => k.id);
    if (new Set(ids).size !== ids.length) problems.push(`${l.id}: duplicate key ids`);

    return {
      layout: l.name, id: l.id,
      keys: g.keyCount, expected: l.keyCount,
      "width u": g.widthU, "declared u": l.widthU,
      rows: l.rows.length,
      ok: countOK && widthOK && !over.length ? "✓" : "✗"
    };
  });

  /* --- Every key id must have a legend --- */
  const missingLegends = new Set();
  for (const l of LAYOUTS) {
    for (const k of GEOMETRY[l.id].keys) if (!LEGENDS[k.id]) missingLegends.add(k.id);
  }
  if (missingLegends.size) problems.push(`Missing legends: ${[...missingLegends].join(", ")}`);

  /* --- Keycap sets: count, role integrity, legend contrast ≥ 3:1 --- */
  if (KEYCAP_SETS.length !== 16) {
    problems.push(`Expected 15 sets + Blanks = 16, found ${KEYCAP_SETS.length}`);
  }

  const contrastReport = [];
  for (const set of KEYCAP_SETS) {
    if (set.blank) continue;
    for (const [roleName, role] of Object.entries(set.roles)) {
      const ratio = contrastRatio(role.cap, role.legend);
      contrastReport.push({ set: set.name, role: roleName, cap: role.cap, legend: role.legend, ratio, ok: ratio >= 3 ? "✓" : "✗" });
      if (ratio < 3) problems.push(`Contrast ${ratio}:1 — ${set.name} / ${roleName}`);
    }
    const referenced = new Set([...Object.values(set.groupRoles), ...Object.values(set.overrides)]);
    for (const r of referenced) {
      if (!set.roles[r]) problems.push(`${set.name}: role "${r}" referenced but not defined`);
    }
  }

  /* --- Switches, cases, mounts --- */
  if (SWITCHES.length !== 32) problems.push(`Expected 32 switches, found ${SWITCHES.length}`);
  if (new Set(SWITCHES.map(s => s.id)).size !== SWITCHES.length) problems.push("Duplicate switch ids");
  if (CASES.length !== 8) problems.push(`Expected 8 cases, found ${CASES.length}`);
  if (MOUNTS.length !== 4) problems.push(`Expected 4 mounts, found ${MOUNTS.length}`);

  /* --- Phase 4 gate: no two switches may render identically --- */
  const seenLook = new Map();
  for (const sw of SWITCHES) {
    const look = [sw.colors.top, sw.colors.bottom, sw.colors.stem,
                  sw.translucentTop ? "T" : "O"].join("|");
    if (seenLook.has(look)) {
      problems.push("Switches render identically: " + seenLook.get(look) + " / " + sw.name);
    } else {
      seenLook.set(look, sw.name);
    }
  }

  /* --- Phase 4 gate: every switch must get an audibly distinct voice --- */
  const seenVoice = new Map();
  for (const sw of SWITCHES) {
    const p = synthParams(sw);
    const voice = [
      Math.round(p.body), p.brightness, round2(p.level), round2(p.bottomDelay),
      p.bumpAt === null ? "-" : round2(p.bumpAt), p.bumpStrength,
      p.clickAt === null ? "-" : round2(p.clickAt), p.clickBar,
      p.silent, p.lubed, p.longPole, round2(p.releaseAt)
    ].join("|");
    if (seenVoice.has(voice)) {
      problems.push("Switches sound identical: " + seenVoice.get(voice) + " / " + sw.brand + " " + sw.name);
    } else {
      seenVoice.set(voice, sw.brand + " " + sw.name);
    }
  }

  const byType = SWITCHES.reduce((acc, s) => { acc[s.type] = (acc[s.type] || 0) + 1; return acc; }, {});

  /* --- Phase 3 gate: every override lands on the right key --- */
  for (const raw of KEYCAP_SETS) {
    const set = effectiveSet(raw, state);
    for (const [keyId, roleName] of Object.entries(set.overrides)) {
      const key = GEOMETRY.full.keys.find(k => k.id === keyId);
      if (!key) { problems.push(`${set.name}: override for unknown key "${keyId}"`); continue; }
      const got = resolveRole(set, key);
      if (got.name !== roleName) problems.push(`${set.name}: ${keyId} resolved to ${got.name}, expected ${roleName}`);
    }
    // group defaults must resolve for every group present on the biggest board
    for (const key of GEOMETRY.full.keys) {
      if (!resolveRole(set, key).cap) problems.push(`${set.name}: ${key.id} (${key.group}) resolved to no colour`);
    }
  }

  console.groupCollapsed("%cSubstrate — data check", "font-weight:600");
  console.table(layoutReport);
  console.table([{ "keycap sets": KEYCAP_SETS.length, switches: SWITCHES.length, cases: CASES.length, mounts: MOUNTS.length, layers: LAYERS.length }]);
  console.table(byType);
  const failing = contrastReport.filter(r => r.ok === "✗");
  console.log(`Legend contrast: ${contrastReport.length - failing.length}/${contrastReport.length} role pairs at ≥ 3:1`);
  if (failing.length) console.table(failing);
  if (problems.length) console.warn("Problems:\n" + problems.map(p => " • " + p).join("\n"));
  else console.log("%cAll acceptance checks pass.", "color:#7FD1C1");
  console.groupEnd();

  return problems;
}

/* =====================================================================
   STATE (§10)
   Hash sync, localStorage, saved builds and shortcuts land in Phase 6.
   ===================================================================== */

const state = { ...DEFAULT_STATE };
const boards = [];
let exploded = null;   // the §04 assembly, created at boot

function setState(patch) {
  Object.assign(state, patch);
  applyAccent();
  syncControls();
  updateBreadcrumb();
  renderLayerList();
  boards.forEach(b => b.render(state));
  if (exploded) {
    exploded.render(state);
    exploded.setIsolated(state.isolatedLayer);
  }
  renderSpecSheet();
  writeHash();
  persistLast();
}

/* =====================================================================
   CONTROLS
   ===================================================================== */

function option(value, label) {
  const o = document.createElement("option");
  o.value = value;
  o.textContent = label;
  return o;
}

function populateControls() {
  const selLayout = document.getElementById("sel-layout");
  LAYOUTS.forEach(l => selLayout.append(option(l.id, `${l.name} — ${l.short} keys`)));
  selLayout.addEventListener("change", () => setState({ layout: selLayout.value }));

  const selMount = document.getElementById("sel-mount");
  MOUNTS.forEach(m => selMount.append(option(m.id, m.name)));
  selMount.addEventListener("change", () => setState({ mount: selMount.value }));

  const selCaps = document.getElementById("sel-caps");
  KEYCAP_SETS.forEach(s => selCaps.append(option(s.id, s.name)));
  selCaps.addEventListener("change", () => setState({ keycapSetId: selCaps.value }));

  const selSwitch = document.getElementById("sel-switch");
  SWITCHES.forEach(s => selSwitch.append(option(s.id, `${s.brand} ${s.name} — ${s.actuationG}g`)));
  selSwitch.addEventListener("change", () => setState({ switchId: selSwitch.value }));

  const selSort = document.getElementById("sel-switch-sort");
  SWITCH_SORTS.forEach(s => selSort.append(option(s.id, s.label)));

  const swatches = document.getElementById("case-swatches");
  CASES.forEach(c => {
    const b = el("button", "swatch-btn");
    b.type = "button";
    b.dataset.caseId = c.id;
    b.style.background = c.body;
    b.setAttribute("aria-label", `${c.name} — ${c.finish}`);
    b.title = `${c.name} — ${c.finish}`;
    b.addEventListener("click", () => setState({ caseId: c.id }));
    swatches.append(b);
  });

  // Blanks colour — drawn from the case swatch list (§5)
  const blankSwatches = document.getElementById("blank-swatches");
  CASES.forEach(c => {
    const b = el("button", "swatch-btn");
    b.type = "button";
    b.dataset.color = c.body;
    b.style.background = c.body;
    b.setAttribute("aria-label", `Blank keycaps in ${c.name}`);
    b.title = c.name;
    b.addEventListener("click", () => setState({ blankColor: c.body }));
    blankSwatches.append(b);
  });

  const filters = document.getElementById("switch-filters");
  SWITCH_FILTERS.forEach((f, i) => {
    const b = el("button", "chip");
    b.type = "button";
    b.dataset.filter = f.id;
    b.textContent = f.label;
    b.setAttribute("aria-pressed", String(i === 0));
    filters.append(b);
  });
  document.getElementById("switch-filters").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    switchFilter = chip.dataset.filter;
    applySwitchFilterSort(true);
  });

  selSort.value = switchSort;
  selSort.addEventListener("change", () => {
    switchSort = selSort.value;
    applySwitchFilterSort(true);
  });

  /* --- §04 exploded view controls --- */
  const slider = document.getElementById("explode-slider");
  const readout = document.querySelector('[data-out="explode"]');
  // Dragging is the primary interaction, so it writes --explode directly
  // and only syncs state on release — no transitions, no re-render churn.
  slider.addEventListener("input", () => {
    const v = Number(slider.value);
    state.explode = v;
    if (readout) readout.textContent = v;
    if (exploded) exploded.setExplode(v, { animate: false });
  });
  slider.addEventListener("change", () => setState({ explode: Number(slider.value) }));

  document.getElementById("btn-play").addEventListener("click", () => {
    if (exploded) exploded.play();
  });

  document.getElementById("btn-autorotate").addEventListener("click", (e) => {
    const on = !state.autoRotate;
    setState({ autoRotate: on });
    e.currentTarget.setAttribute("aria-pressed", String(on));
  });

  /* --- sound checks --- */
  document.getElementById("btn-sound-check").addEventListener("click", (e) => {
    soundCheck(getSwitch(state.switchId), e.currentTarget);
  });
  document.getElementById("btn-sound-exploded").addEventListener("click", (e) => {
    soundCheck(getSwitch(state.switchId), e.currentTarget);
  });
  document.getElementById("btn-sound-toggle").addEventListener("click", () => {
    setState({ sound: !state.sound });
    if (state.sound) soundCheck(getSwitch(state.switchId), null);
  });


  document.getElementById("btn-reset").addEventListener("click", () => setState({ ...DEFAULT_STATE }));
  document.getElementById("btn-randomize").addEventListener("click", randomizeBuild);

  document.getElementById("btn-save").addEventListener("click", (e) => handleSave(e.currentTarget));
  document.getElementById("btn-copy-md").addEventListener("click", (e) => copyText(buildMarkdown(), e.currentTarget));
  document.getElementById("btn-download-json").addEventListener("click", downloadJSON);
  document.getElementById("btn-copy-link").addEventListener("click", (e) => copyText(shareLink(), e.currentTarget));
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

/** Push state back into the controls (needed after Randomize / Reset). */
/**
 * Push state back into the controls. Every write here is guarded: setting
 * aria-pressed on a card invalidates style for its whole subtree, and the
 * gallery is 16 cards deep, so rewriting unchanged attributes on every
 * state change was costing more than the board render itself.
 */
const _ui = {};   // cached node lists, populated on first call

function setPressed(node, on) {
  const want = on ? "true" : "false";
  if (node.getAttribute("aria-pressed") !== want) node.setAttribute("aria-pressed", want);
}

function syncControls() {
  if (!_ui.ready) {
    _ui.selLayout = document.getElementById("sel-layout");
    _ui.selMount  = document.getElementById("sel-mount");
    _ui.selCaps   = document.getElementById("sel-caps");
    _ui.selSwitch = document.getElementById("sel-switch");
    _ui.blankRow  = document.getElementById("blank-row");
    _ui.caseSwatches  = [...document.querySelectorAll("#case-swatches .swatch-btn")];
    _ui.blankSwatches = [...document.querySelectorAll("#blank-swatches .swatch-btn")];
    _ui.setCards      = [...document.querySelectorAll("#keycap-gallery .set-card")];
    _ui.ready = true;
  }

  if (_ui.selLayout.value !== state.layout)      _ui.selLayout.value = state.layout;
  if (_ui.selMount.value !== state.mount)        _ui.selMount.value = state.mount;
  if (_ui.selCaps.value !== state.keycapSetId)   _ui.selCaps.value = state.keycapSetId;
  if (_ui.selSwitch.value !== state.switchId)    _ui.selSwitch.value = state.switchId;

  _ui.caseSwatches.forEach(b => setPressed(b, b.dataset.caseId === state.caseId));

  // gallery selection (§9: accent left border + dot, never a fill)
  _ui.setCards.forEach(b => setPressed(b, b.dataset.setId === state.keycapSetId));

  // switch gallery selection
  switchCards.forEach((card, id) => {
    const on = id === state.switchId;
    card.classList.toggle("is-selected", on);
    setPressed(card.querySelector(".switch-card__main"), on);
  });

  // the slider must follow programmatic changes too (Play, shortcuts)
  const slider = document.getElementById("explode-slider");
  if (slider && Number(slider.value) !== state.explode) slider.value = String(state.explode);

  // audio follows state.sound
  SwitchAudio.enabled = state.sound;
  const toggle = document.getElementById("btn-sound-toggle");
  if (toggle) {
    toggle.textContent = state.sound ? "On" : "Off";
    setPressed(toggle, state.sound);
  }

  // Blanks colour row only appears while Blanks is the selected set
  const showBlank = state.keycapSetId === "blanks";
  if (_ui.blankRow.hidden === showBlank) _ui.blankRow.hidden = !showBlank;
  if (_lastBlankColor !== state.blankColor) {
    _ui.blankSwatches.forEach(b => setPressed(b, b.dataset.color === state.blankColor));
    refreshBlanksCard();
    _lastBlankColor = state.blankColor;
  }
}
let _lastBlankColor = null;

/** The layer stack for the current mount (§11). */
function activeLayers() {
  return LAYERS.filter(l => !l.mounts || l.mounts.includes(state.mount));
}

function layerLabel(layer) {
  return layer.label
    .replace("{set}", getKeycapSet(state.keycapSetId).name)
    .replace("{switch}", getSwitch(state.switchId).name)
    .replace("{case}", getCase(state.caseId).name)
    .replace("{n}", getLayout(state.layout).keyCount)
    .replace("{plateMaterial}", "aluminium")
    .replace("{mountHardware}", MOUNT_HARDWARE_LABEL[state.mount] || "Hardware");
}

/**
 * The layer rows (§11). Rebuilt only when the mount changes the stack;
 * otherwise the labels are refreshed in place.
 *
 * Hovering a row raises that layer 12px and drops the rest to 35%.
 * Clicking isolates it; clicking again releases. The switches row also
 * carries a sound check for the switch currently fitted.
 */
let _layerListMount = null;

function renderLayerList() {
  const list = document.getElementById("layer-list");
  const layers = activeLayers();

  if (_layerListMount !== state.mount) {
    list.textContent = "";
    layers.forEach((layer, i) => {
      const li = el("li");
      const row = el("button", "layer-row");
      row.type = "button";
      row.dataset.layer = layer.id;

      const idx = el("span", "layer-row__idx");
      idx.textContent = String(i + 1).padStart(2, "0");
      const label = el("span", "layer-row__label");
      const thick = el("span", "layer-row__thick");
      thick.textContent = layer.thickness + "px";

      row.append(idx, label, thick);
      row.addEventListener("pointerenter", () => exploded && exploded.setHovered(layer.id));
      row.addEventListener("pointerleave", () => exploded && exploded.setHovered(null));
      row.addEventListener("focus", () => exploded && exploded.setHovered(layer.id));
      row.addEventListener("blur", () => exploded && exploded.setHovered(null));
      row.addEventListener("click", () => {
        const next = state.isolatedLayer === layer.id ? null : layer.id;
        setState({ isolatedLayer: next });
      });

      li.append(row);

      // per-layer sound check on the switches layer
      if (layer.id === "switches") {
        const play = el("button", "layer-row__sound");
        play.type = "button";
        play.innerHTML = PLAY_ICON;
        play.setAttribute("aria-label", "Sound check the fitted switch");
        play.addEventListener("click", (e) => {
          e.stopPropagation();
          soundCheck(getSwitch(state.switchId), play);
        });
        row.append(play);
      }

      list.append(li);
    });
    _layerListMount = state.mount;
  }

  const rows = list.querySelectorAll(".layer-row");
  rows.forEach((row, i) => {
    row.querySelector(".layer-row__label").textContent = layerLabel(layers[i]);
    const on = state.isolatedLayer === layers[i].id;
    row.classList.toggle("is-isolated", on);
    row.setAttribute("aria-pressed", String(on));
  });
}

let _accentCap = null;
/** Tint the whole UI to the selected set's accent (§9). */
function applyAccent() {
  const set = effectiveSet(getKeycapSet(state.keycapSetId), state);
  const role = set.roles.accent || set.roles.alpha;
  // Blanks has no legend colour to borrow, so derive readable ink from the cap.
  const ink = role.legend === "transparent"
    ? (relativeLuminance(role.cap) > 0.4 ? "#141414" : "#F2F2F0")
    : role.legend;
  // Writing to :root invalidates style for the whole document, so only do
  // it when the value actually moved.
  if (role.cap === _accentCap) return;
  _accentCap = role.cap;
  document.documentElement.style.setProperty("--accent", role.cap);
  document.documentElement.style.setProperty("--accent-ink", ink);
}

/* =====================================================================
   §02 KEYCAP GALLERY

   Eight keys chosen to exercise the whole role table in one strip:
   accent (esc), alpha (q/w/e), fn, mod (tab), enter, arrow. Sets that
   route fn or arrow to accent2 therefore show it without a special case.
   ===================================================================== */

const MINI_STRIP_KEYS = ["esc", "q", "w", "e", "f1", "tab", "enter", "up"];

function buildMiniStrip(set) {
  const strip = el("div", "mini-strip");
  for (const id of MINI_STRIP_KEYS) {
    const role = resolveRole(set, { id, group: groupForKey(id) });
    const cap = el("div", "mini-cap");
    cap.style.setProperty("--cap", role.cap);
    cap.style.setProperty("--legend", role.legend);
    const glyph = el("span");
    glyph.textContent = set.blank ? "" : (LEGENDS[id] ? LEGENDS[id].main : id);
    cap.append(glyph);
    strip.append(cap);
  }
  return strip;
}

function renderKeycapGallery() {
  const grid = document.getElementById("keycap-gallery");
  grid.textContent = "";

  KEYCAP_SETS.forEach(set => {
    const card = el("button", "card set-card reveal");
    card.type = "button";
    card.dataset.setId = set.id;
    card.setAttribute("aria-pressed", "false");

    card.append(buildMiniStrip(effectiveSet(set, state)));

    const title = el("div", "card__title");
    title.append(el("span", "dot"), document.createTextNode(set.name));

    const meta = el("div", "card__meta");
    meta.textContent = [set.designer, set.year, set.profile, set.material, `$${set.priceUSD}`]
      .filter(Boolean).join(" · ");

    const colorway = el("div", "colorway");
    set.chips.forEach(hex => {
      const chip = el("i");
      chip.style.background = hex;
      chip.title = hex;
      colorway.append(chip);
    });

    const blurb = el("div", "card__blurb");
    blurb.textContent = set.blurb;

    card.append(title, meta, colorway, blurb);
    card.addEventListener("click", () => setState({ keycapSetId: set.id }));
    grid.append(card);
  });
}

/** The Blanks card is the only one whose colour is live. */
function refreshBlanksCard() {
  const card = document.querySelector('#keycap-gallery [data-set-id="blanks"]');
  if (!card) return;
  const cap = effectiveSet(getKeycapSet("blanks"), state).roles.alpha.cap;
  card.querySelectorAll(".mini-cap").forEach(c => c.style.setProperty("--cap", cap));
}

function updateBreadcrumb() {
  const sw = getSwitch(state.switchId);
  const map = {
    layout: getLayout(state.layout).name,
    caps: getKeycapSet(state.keycapSetId).name,
    switch: `${sw.brand} ${sw.name}`
  };
  document.querySelectorAll("[data-bc]").forEach(e => { e.textContent = map[e.dataset.bc]; });
  document.querySelectorAll("[data-out]").forEach(e => {
    const k = e.dataset.out;
    if (k === "case") e.textContent = getCase(state.caseId).name;
    else if (k === "mount") e.textContent = getMount(state.mount).name;
    else if (k === "explode") e.textContent = state.explode;
    else if (k === "sound") e.textContent = state.sound ? "On" : "Off";
    else if (k === "switch-short") e.textContent = getSwitch(state.switchId).name;
    else if (k === "blank") {
      const match = CASES.find(c => c.body === state.blankColor);
      e.textContent = match ? match.name : state.blankColor;
    }
    else if (map[k]) e.textContent = map[k];
  });
}

/* =====================================================================
   SWITCH AUDIO — "sound checks"

   Every sound is synthesised at runtime with the Web Audio API. There are
   no audio files: §2 requires zero external assets and the page has to run
   from file://, so sampling real switches was not an option. Instead the
   synth parameters are derived from the switch data we already have —
   housing material, stem material, weight, travel, factory lube, type and
   the one-line sound descriptor — so all 32 switches sound different for
   the same reasons they sound different in real life.

   A keystroke is modelled as up to six events:
     1. cap/finger contact       (always)
     2. spring + housing scratch (unlubed only)
     3. tactile bump             (tactile types)
     4. click bar / click jacket (clicky types)
     5. bottom-out               (always; the main "thock")
     6. upstroke release         (always; quieter, brighter)

   Nothing plays until the user clicks something — no autoplay.
   ===================================================================== */

const SwitchAudio = {
  ctx: null,
  master: null,
  noise: null,
  enabled: true,
  _failed: false,

  /** Lazily build the graph. Must be called from a user gesture. */
  ensure() {
    if (this._failed) return null;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { this._failed = true; return null; }
      try {
        this.ctx = new AC();
      } catch (err) { this._failed = true; return null; }

      this.master = this.ctx.createGain();
      this.master.gain.value = 0.85;

      // keeps fast typing from clipping
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 14;
      comp.ratio.value = 6;
      comp.attack.value = 0.002;
      comp.release.value = 0.12;

      this.master.connect(comp);
      comp.connect(this.ctx.destination);
      this.noise = this._noiseBuffer(0.5);
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  },

  _noiseBuffer(seconds) {
    const n = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  },

  /** Filtered noise burst — the percussive part of every event. */
  _burst(t, opts) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = opts.type || "bandpass";
    filter.frequency.value = Math.min(opts.freq, this.ctx.sampleRate / 2 - 1000);
    filter.Q.value = opts.q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(opts.gain, t + 0.0015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.decay);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(t, Math.random() * 0.3);      // random offset: no two presses identical
    src.stop(t + opts.decay + 0.02);
  },

  /** Pitched body resonance — what makes a housing sound deep or bright. */
  _tone(t, opts) {
    const osc = this.ctx.createOscillator();
    osc.type = opts.type || "triangle";
    osc.frequency.setValueAtTime(opts.freq, t);
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(40, opts.freq * (opts.bend || 0.72)), t + opts.decay);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(opts.gain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.decay);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + opts.decay + 0.02);
  },

  /** Play one keystroke of a switch. "when" is an offset in seconds. */
  play(sw, when) {
    if (!this.enabled) return false;
    const ctx = this.ensure();
    if (!ctx) return false;

    const p = synthParams(sw);
    const t = ctx.currentTime + (when || 0) + 0.001;
    const v = 0.9 + Math.random() * 0.2;    // per-press variation

    // 1. cap/finger contact
    this._burst(t, { freq: 1750 * p.brightness, q: 0.8, gain: 0.05 * v, decay: 0.022 });

    // 2. spring + housing scratch, only if not factory lubed
    if (!p.lubed && !p.silent) {
      this._burst(t + 0.004, { freq: 4400, q: 0.7, gain: 0.014 * v, decay: 0.035 });
    }

    // 3. tactile bump
    if (p.bumpAt !== null) {
      this._burst(t + p.bumpAt, {
        freq: 900 * p.brightness, q: 3.4,
        gain: 0.12 * p.level * v * p.bumpStrength, decay: 0.024
      });
    }

    // 4. click bar (Kailh Box) or click jacket (Cherry/Gateron)
    if (p.clickAt !== null) {
      this._burst(t + p.clickAt, {
        freq: (p.clickBar ? 2300 : 3700) * p.brightness, q: 2.2,
        gain: 0.3 * v, decay: p.clickBar ? 0.038 : 0.022
      });
      this._tone(t + p.clickAt, {
        freq: p.clickBar ? 1100 : 1800, gain: 0.1 * v,
        decay: 0.03, type: "square"
      });
    }

    // 5. bottom-out — the signature
    const bt = t + p.bottomDelay;
    const bo = 0.34 * p.level * v * (p.longPole ? 1.28 : 1);
    this._burst(bt, {
      freq: p.body * 3.2, q: 1.1,
      gain: bo * (p.silent ? 0.35 : 0.72), decay: p.silent ? 0.03 : 0.055
    });
    this._tone(bt, { freq: p.body, gain: bo, decay: p.silent ? 0.05 : 0.09 });
    this._tone(bt + 0.002, { freq: p.body * 1.98, gain: bo * 0.32, decay: 0.05, type: "sine" });

    // 6. upstroke
    const rt = t + p.releaseAt;
    this._burst(rt, {
      freq: p.body * 4.4 * p.brightness, q: 1.4,
      gain: 0.13 * p.level * v, decay: p.silent ? 0.018 : 0.04
    });
    this._tone(rt, { freq: p.body * 1.35, gain: 0.085 * p.level * v, decay: 0.038 });
    return true;
  }
};

/**
 * Map a switch's spec-sheet data onto synth parameters. Everything here
 * reads from §6 fields — there is no per-switch tuning table, so adding a
 * switch to SWITCHES gives it a plausible voice for free.
 */
function synthParams(sw) {
  const s = (sw.sound || "").toLowerCase();
  const stem = (sw.stemMaterial || "").toLowerCase();
  const mat = ((sw.bottomHousingMaterial || "") + " " + (sw.topHousingMaterial || "")).toLowerCase();

  const silent = sw.type.indexOf("silent") === 0;
  const clicky = sw.type === "clicky";
  const tactile = sw.type === "tactile" || sw.type === "silent-tactile";

  // Housing material sets the body resonance — the single biggest factor.
  let body = 210;                                 // nylon, the default
  if (mat.indexOf("boba") >= 0) body = 165;       // Gazzew blend, deepest
  else if (mat.indexOf("ink") >= 0) body = 178;
  else if (mat.indexOf("milky") >= 0) body = 188;
  else if (mat.indexOf("uhmwpe") >= 0) body = 375;
  else if (mat.indexOf("pom") >= 0) body = 345;   // POM-on-POM clack
  else if (mat.indexOf("pc") >= 0) body = 285;    // polycarbonate, glassy

  // The descriptor nudges it, so "deep patch" and "high-pitched" diverge
  // even when two switches share a housing material.
  if (/deep|thock|dense|round|muted|dampened|firm|full/.test(s)) body *= 0.86;
  if (/bright|sharp|high-pitched|poppy|crisp|glassy|clack/.test(s)) body *= 1.2;
  if (/hollow/.test(s)) body *= 1.06;

  const heft = sw.bottomOutG / 60;
  const travel = sw.totalTravelMm;

  return {
    body: body,
    brightness: /bright|sharp|high|crisp|poppy|glassy/.test(s) ? 1.3
              : /deep|muted|dampened|dense|hollow/.test(s) ? 0.78 : 1,
    level: silent ? 0.3 : Math.min(1.15, 0.55 + heft * 0.35),
    // longer travel takes longer to reach the bottom
    bottomDelay: 0.012 + (travel / 4) * 0.022,
    bumpAt: tactile ? (sw.preTravelMm / travel) * 0.03 : null,
    bumpStrength: /huge|heavy|crisp|loud|thock reference|p-shaped|d-shaped/.test(s) ? 1.35
                : /faint|light|minimal|smoother/.test(s) ? 0.55 : 1,
    clickAt: clicky ? (sw.preTravelMm / travel) * 0.028 : null,
    clickBar: /click bar/.test(s),
    silent: silent,
    lubed: !!sw.factoryLubed,
    longPole: /long pole/.test(stem),
    releaseAt: 0.07 + travel * 0.013
  };
}

/* =====================================================================
   §03 SWITCH GALLERY (§6 rendering, filter chips, sort)
   ===================================================================== */

/** Inverse of a hex, at 5% — the embossed nameplate colour (§6). */
function embossColor(hex) {
  const rgb = hexToRgb(hex);
  return "rgba(" + (255 - rgb[0]) + "," + (255 - rgb[1]) + "," + (255 - rgb[2]) + ",.05)";
}

/**
 * Draw one switch from ~6 divs. In the exploded view the nameplate is
 * dropped (too small to read at board scale) and the gold pins appear.
 */
function buildSwitch(sw, opts) {
  const exploded = !!(opts && opts.exploded);
  const root = el("div", "sw" + (exploded ? " sw--exploded" : ""));
  if (sw.translucentTop) root.classList.add("sw--translucent");
  root.style.setProperty("--sw-top", sw.colors.top);
  root.style.setProperty("--sw-bottom", sw.colors.bottom);
  root.style.setProperty("--sw-stem", sw.colors.stem);
  root.style.setProperty("--sw-emboss", embossColor(sw.colors.top));

  const pins = el("div", "sw__pins");
  pins.append(el("i"), el("i"));

  const bottom = el("div", "sw__bottom");
  const top = el("div", "sw__top");
  const well = el("div", "sw__well");
  const stem = el("div", "sw__stem");

  well.append(stem);
  top.append(well);

  if (!exploded) {
    const plate = el("div", "sw__nameplate");
    plate.textContent = sw.brand;
    top.append(plate);
  }

  root.append(pins, bottom, top);
  return root;
}

const PLAY_ICON = '<svg viewBox="0 0 10 11" aria-hidden="true"><path d="M0 0l10 5.5L0 11z"/></svg>';

let switchFilter = "all";
let switchSort = "weight";
const switchCards = new Map();   // switch id -> card element

function sortedSwitches() {
  const filter = SWITCH_FILTERS.find(f => f.id === switchFilter) || SWITCH_FILTERS[0];
  const list = SWITCHES.filter(filter.match);
  const by = {
    weight: (a, b) => a.actuationG - b.actuationG || a.bottomOutG - b.bottomOutG,
    price:  (a, b) => a.pricePer10USD - b.pricePer10USD,
    brand:  (a, b) => a.brand.localeCompare(b.brand) || a.name.localeCompare(b.name)
  }[switchSort];
  return list.sort(by);
}

function renderSwitchGallery() {
  const grid = document.getElementById("switch-gallery");
  grid.textContent = "";
  switchCards.clear();

  SWITCHES.forEach(sw => {
    const card = el("div", "card switch-card reveal");
    card.dataset.switchId = sw.id;

    const main = el("button", "switch-card__main");
    main.type = "button";
    main.setAttribute("aria-pressed", "false");
    main.setAttribute("aria-label", "Select " + sw.brand + " " + sw.name);

    const stage = el("div", "sw-stage");
    stage.append(buildSwitch(sw));

    const title = el("div", "card__title");
    title.append(el("span", "dot"), document.createTextNode(sw.name));

    const meta = el("div", "card__meta");
    meta.textContent = sw.brand;

    const badges = el("div", "sw-stats");
    const type = el("span", "badge");
    type.textContent = SWITCH_TYPE_LABELS[sw.type] || sw.type;
    badges.append(type);
    if (sw.factoryLubed) {
      const lubed = el("span", "badge badge--lubed");
      lubed.textContent = "Factory lubed";
      badges.append(lubed);
    }

    const mk = (label, strong) => {
      const n = el("span");
      if (strong) { const b = el("b"); b.textContent = strong; n.append(b); }
      n.append(document.createTextNode(label));
      return n;
    };
    const stats = el("div", "sw-stats");
    stats.append(
      mk(" / " + sw.bottomOutG + " g", String(sw.actuationG)),
      mk(" / " + sw.totalTravelMm.toFixed(1) + " mm", sw.preTravelMm.toFixed(1)),
      mk("$" + sw.pricePer10USD.toFixed(2) + " / 10")
    );

    const sound = el("div", "card__blurb");
    sound.textContent = sw.sound.charAt(0).toUpperCase() + sw.sound.slice(1) + ".";

    main.append(stage, title, meta, badges, stats, sound);
    main.addEventListener("click", () => setState({ switchId: sw.id }));

    // Sound check — a sibling of the select button, never nested inside it.
    const play = el("button", "switch-card__sound");
    play.type = "button";
    play.innerHTML = PLAY_ICON;
    play.setAttribute("aria-label", "Sound check — " + sw.brand + " " + sw.name);
    play.title = "Sound check — " + sw.sound;
    play.addEventListener("click", (e) => {
      e.stopPropagation();
      soundCheck(sw, play);
    });

    card.append(main, play);
    grid.append(card);
    switchCards.set(sw.id, card);
  });

  applySwitchFilterSort();
}

/**
 * Filter and sort by toggling hidden and CSS order rather than rebuilding —
 * that keeps all 32 switch drawings alive across every change.
 */
/**
 * Apply the current filter + sort by toggling hidden and CSS order rather
 * than rebuilding — that keeps all 32 switch drawings alive.
 *
 * `userInitiated` matters: a card that was display:none while the viewport
 * scrolled past it never fires its IntersectionObserver, so re-showing it
 * would leave it stuck at opacity 0. On a user filter change we therefore
 * reveal whatever is now visible outright. The initial build passes false
 * so the normal scroll-reveal stagger still plays on first load.
 */
function applySwitchFilterSort(userInitiated) {
  const visible = sortedSwitches();
  const order = new Map(visible.map((sw, i) => [sw.id, i]));
  switchCards.forEach((card, id) => {
    const rank = order.get(id);
    card.hidden = rank === undefined;
    if (rank !== undefined) {
      card.style.order = String(rank);
      if (userInitiated) card.classList.add("is-in");
    }
  });
  document.querySelectorAll("#switch-filters .chip").forEach(chip => {
    chip.setAttribute("aria-pressed", String(chip.dataset.filter === switchFilter));
  });
}

/** Play a switch and pulse whatever button triggered it. */
function soundCheck(sw, button) {
  const played = SwitchAudio.play(sw);
  if (!played || !button) return;
  button.classList.add("is-playing");
  clearTimeout(button._pulse);
  button._pulse = setTimeout(() => button.classList.remove("is-playing"), 260);
}

/* =====================================================================
   EXPLODED VIEW (§11)

   One .assembly with a single --explode custom property (0 to 1) drives
   the whole stack; each layer resolves its own translateZ from
   --base + --explode * --spread, so a slider drag is one property write
   and the compositor only ever sees transform changes.

   At --explode 0 the layers sit on top of each other offset by their own
   thicknesses, which is what makes it read as a correctly assembled board
   rather than a pile of coincident planes.
   ===================================================================== */

const SVGNS = "http://www.w3.org/2000/svg";
const LABEL_GUTTER = 168;   // px reserved on the right of the stage
const LABEL_MIN_GAP = 24;   // px minimum vertical spacing between labels
const ANNOTATE_FROM = 40;   // §11: annotations appear above explode 40

function svgEl(tag, cls) {
  const node = document.createElementNS(SVGNS, tag);
  if (cls) node.setAttribute("class", cls);
  return node;
}

/**
 * Stacking offsets so explode 0 is an assembled board. Walks the full
 * stack bottom-up accumulating thickness. Computed per mount because the
 * gasket / hardware layer changes the total.
 */
function layerBaseOffsets(layers) {
  const bases = new Map();
  let z = 0;
  for (let i = layers.length - 1; i >= 0; i--) {
    bases.set(layers[i].id, z);
    z += layers[i].thickness;
  }
  return bases;
}

class ExplodedView {
  constructor(stage) {
    this.stage = stage;
    this.layers = new Map();      // layer id -> { el, def, content }
    this.switchEls = [];
    this.cutoutEls = { plate: [], "plate-foam": [] };
    this.viaEls = [];
    this.isolated = null;
    this.gutter = LABEL_GUTTER;
    this.hovered = null;
    this._annotateQueued = false;
    this._last = {};
    this._build();
  }

  _build() {
    this.stage.textContent = "";

    this.fitBox = el("div", "assembly-fit");
    this.spin = el("div", "assembly-spin");
    this.asm = el("div", "assembly");
    this.ground = el("div", "assembly-ground");

    this.spin.append(this.asm);
    this.fitBox.append(this.spin, this.ground);
    this.stage.append(this.fitBox);

    this.svg = svgEl("svg", "annotations");
    this.stage.append(this.svg);

    // Every layer in LAYERS gets an element up front, including both mount
    // variants; the inactive one is simply detached from the flow.
    for (const def of LAYERS) {
      const node = el("div", "layer layer--" + def.id);
      node.dataset.layer = def.id;
      node.style.setProperty("--spread", String(def.spread));
      node.style.setProperty("--thickness", String(def.thickness));
      const rec = { el: node, def: def };
      this._buildLayerContent(rec);
      this.layers.set(def.id, rec);
      this.asm.append(node);
    }

    // The keycaps layer is a bare BoardRenderer — the same cap code path
    // that draws the live preview (§11).
    this.capBoard = new BoardRenderer(this.layers.get("keycaps").el, { bare: true });

    if ("ResizeObserver" in window) {
      this._ro = new ResizeObserver(() => this.fit());
      this._ro.observe(this.stage);
    }
  }

  _buildLayerContent(rec) {
    const id = rec.def.id;
    const node = rec.el;

    if (id === "keycaps") return;                 // BoardRenderer fills this

    if (id === "switches") {
      rec.holder = el("div", "layer__holder");
      rec.holder.style.position = "absolute";
      rec.holder.style.inset = "0";
      node.append(rec.holder);
      return;
    }

    // everything else is a slab with an extruded edge
    const slab = el("div", "layer__slab");
    const edge = el("div", "layer__edge");
    node.append(slab, edge);
    rec.slab = slab;
    rec.edge = edge;

    if (id === "plate") {
      slab.style.setProperty("--slab", "#8E9296");
      node.style.setProperty("--edge", "#5E6265");
    } else if (id === "plate-foam") {
      slab.style.setProperty("--slab", "#2A2B2D");
      node.style.setProperty("--edge", "#161718");
    } else if (id === "pcb") {
      slab.style.setProperty("--slab", "#12312A");
      node.style.setProperty("--edge", "#0A1C18");
      rec.traces = el("div", "layer__holder");
      rec.traces.style.position = "absolute";
      rec.traces.style.inset = "0";
      rec.traces.style.overflow = "hidden";
      rec.traces.style.borderRadius = "6px";
      slab.append(rec.traces);
      const silk = el("div", "pcb-silk");
      silk.style.right = "14px";
      silk.style.bottom = "10px";
      silk.textContent = "SUBSTRATE REV C";
      rec.silk = silk;
      slab.append(silk);
    } else if (id === "pe-foam") {
      slab.style.setProperty("--slab", "rgba(240,240,235,.55)");
      node.style.setProperty("--edge", "rgba(200,200,195,.5)");
    } else if (id === "case-foam") {
      slab.style.setProperty("--slab", "#26272A");
      node.style.setProperty("--edge", "#141516");
    } else if (id === "case") {
      node.classList.add("layer--case");
      rec.inner = el("div", "case-inner");
      rec.weight = el("div", "case-weight");
      slab.append(rec.inner, rec.weight);
    } else if (id === "gaskets" || id === "mount-hw") {
      slab.style.setProperty("--slab", "transparent");
      slab.style.boxShadow = "none";
      node.style.setProperty("--edge", "transparent");
      edge.style.display = "none";
      rec.holder = el("div", "layer__holder");
      rec.holder.style.position = "absolute";
      rec.holder.style.inset = "0";
      node.append(rec.holder);
    }
  }

  /* ---------------- key-dependent contents ---------------- */

  _syncKeyContents(geo, sw) {
    const centre = (k) => ({
      x: px.x(k.x + k.u / 2),
      y: px.y(k.y + k.hu / 2)
    });

    // switches: one body per key, at each key centre
    const holder = this.layers.get("switches").holder;
    if (this._last.layoutForKeys !== geo || this._last.switchForKeys !== sw) {
      holder.textContent = "";
      this.switchEls = geo.keys.map(k => {
        const c = centre(k);
        const node = buildSwitch(sw, { exploded: true });
        node.style.position = "absolute";
        node.style.left = c.x + "px";
        node.style.top = c.y + "px";
        node.style.marginLeft = "-20px";
        node.style.marginTop = "-20px";
        return node;
      });
      holder.append(...this.switchEls);
    }

    if (this._last.layoutForKeys === geo) return;

    // plate + plate-foam cutouts, 14x14 per key
    for (const id of ["plate", "plate-foam"]) {
      const rec = this.layers.get(id);
      const old = rec.slab.querySelectorAll(".cutout");
      old.forEach(n => n.remove());
      const frag = document.createDocumentFragment();
      for (const k of geo.keys) {
        const c = centre(k);
        const cut = el("div", "cutout");
        cut.style.left = c.x + "px";
        cut.style.top = c.y + "px";
        frag.append(cut);
      }
      rec.slab.append(frag);
    }

    // PCB traces + vias
    const pcb = this.layers.get("pcb");
    pcb.traces.textContent = "";
    const frag = document.createDocumentFragment();
    const rows = new Set(geo.keys.map(k => k.row));
    rows.forEach(r => {
      const line = el("div", "pcb-trace");
      line.style.left = "12px";
      line.style.right = "12px";
      line.style.top = px.y(r + 0.5) + "px";
      frag.append(line);
    });
    for (let c = 0; c <= Math.ceil(geo.widthU); c += 2) {
      const line = el("div", "pcb-trace pcb-trace--v");
      line.style.top = "10px";
      line.style.bottom = "10px";
      line.style.left = px.x(c) + "px";
      frag.append(line);
    }
    for (const k of geo.keys) {
      const c = centre(k);
      const via = el("div", "pcb-via");
      via.style.left = (c.x - 9) + "px";
      via.style.top = (c.y + 8) + "px";
      frag.append(via);
      const via2 = el("div", "pcb-via");
      via2.style.left = (c.x + 9) + "px";
      via2.style.top = (c.y + 8) + "px";
      frag.append(via2);
    }
    pcb.traces.append(frag);
  }

  _syncMountHardware(geo, mount) {
    const w = px.x(geo.widthU);
    const h = px.y(geo.heightU);

    const gask = this.layers.get("gaskets");
    if (gask.holder.childElementCount === 0 || this._last.mountGeom !== w + "x" + h) {
      gask.holder.textContent = "";
      // 12 socks: 4 along the top, 4 along the bottom, 2 per side
      const pts = [];
      for (let i = 0; i < 4; i++) pts.push([w * (i + 0.5) / 4, 6]);
      for (let i = 0; i < 4; i++) pts.push([w * (i + 0.5) / 4, h - 6]);
      for (let i = 0; i < 2; i++) pts.push([8, h * (i + 0.5) / 2], [w - 8, h * (i + 0.5) / 2]);
      for (const [x, y] of pts) {
        const tab = el("div", "gasket-tab");
        tab.style.left = x + "px";
        tab.style.top = y + "px";
        gask.holder.append(tab);
      }
    }

    const hw = this.layers.get("mount-hw");
    hw.holder.textContent = "";
    if (mount === "o-ring") {
      hw.holder.append(el("div", "oring"));
    } else if (mount === "top" || mount === "tray") {
      const pts = [[16, 16], [w - 16, 16], [16, h - 16], [w - 16, h - 16],
                   [w / 2, 14], [w / 2, h - 14]];
      for (const [x, y] of pts) {
        const pin = el("div", "standoff");
        pin.style.left = x + "px";
        pin.style.top = y + "px";
        hw.holder.append(pin);
      }
    }
    this._last.mountGeom = w + "x" + h;
  }

  /* ---------------- render ---------------- */

  render(state) {
    this.state = state;
    const geo = GEOMETRY[state.layout];
    const sw = getSwitch(state.switchId);
    const kase = getCase(state.caseId);
    const active = activeLayers();
    const activeIds = new Set(active.map(l => l.id));

    this.asm.style.setProperty("--asm-w", px.x(geo.widthU) + "px");
    this.asm.style.setProperty("--asm-h", px.y(geo.heightU) + "px");

    // show only the layers this mount uses, and give each its stack offset
    const bases = layerBaseOffsets(active);
    this.layers.forEach((rec, id) => {
      const on = activeIds.has(id);
      rec.el.style.display = on ? "" : "none";
      if (on) rec.el.style.setProperty("--base", String(bases.get(id) || 0));
    });

    // case colours
    const caseRec = this.layers.get("case");
    caseRec.slab.style.setProperty("--slab", caseBodyColor(kase));
    caseRec.el.style.setProperty("--edge", kase.accent);
    caseRec.weight.style.display = kase.heavy ? "" : "none";

    this._syncKeyContents(geo, sw);
    this._syncMountHardware(geo, state.mount);
    this._last.layoutForKeys = geo;
    this._last.switchForKeys = sw;

    // the caps layer rides the shared cap renderer
    this.capBoard.render(state);

    this.setExplode(state.explode, { animate: false });
    this.spin.classList.toggle("is-rotating", !!state.autoRotate && !prefersReducedMotion());
    this.fit();
  }

  /**
   * Write --explode. It is a registered non-inherited property, so it has
   * to be set on each element that reads it — ten layers plus the ground
   * shadow. Ten targeted writes beat one write that dirties 1600 nodes.
   */
  setExplode(value, opts) {
    const animate = !!(opts && opts.animate);
    const t = Math.max(0, Math.min(100, value)) / 100;
    // render() calls this with animate:false on every state change; while
    // Play is running that must not strip the transition class.
    if (this._playing) this.asm.classList.add("is-animating");
    else this.asm.classList.toggle("is-animating", animate);
    if (!this._explodeTargets) {
      this._explodeTargets = [...this.layers.values()].map(r => r.el).concat(this.ground);
    }
    const v = String(t);
    for (const node of this._explodeTargets) node.style.setProperty("--explode", v);
    this.queueAnnotate();
  }

  /** Play: 0 to 100 over 1.6s, top layer first, 45ms per layer (§11). */
  play() {
    if (prefersReducedMotion()) { setState({ explode: state.explode >= 50 ? 0 : 100 }); return; }
    const active = activeLayers();
    active.forEach((def, i) => {
      const rec = this.layers.get(def.id);
      if (rec) rec.el.style.setProperty("--play-delay", (i * 45) + "ms");
    });
    const target = state.explode >= 50 ? 0 : 100;
    this._playing = true;
    this.asm.classList.add("is-animating");
    // Flush style so the transition class is live before the transform
    // changes. A rAF would do it too, but rAF never fires in a background
    // tab and the keyboard shortcut has to work regardless.
    void this.asm.offsetHeight;
    setState({ explode: target });
    clearTimeout(this._playTimer);
    // keep re-laying out the labels while the CSS transition runs
    const until = performance.now() + 1600 + active.length * 45;
    const tick = () => {
      this.queueAnnotate();
      if (performance.now() < until) this._playRaf = requestAnimationFrame(tick);
      else {
        this._playing = false;
        this.asm.classList.remove("is-animating");
        active.forEach(def => {
          const rec = this.layers.get(def.id);
          if (rec) rec.el.style.setProperty("--play-delay", "0ms");
        });
      }
    };
    cancelAnimationFrame(this._playRaf);
    this._playRaf = requestAnimationFrame(tick);
    // belt and braces: settle even if rAF is throttled
    this._playTimer = setTimeout(() => {
      this._playing = false;
      this.asm.classList.remove("is-animating");
      active.forEach(def => {
        const rec = this.layers.get(def.id);
        if (rec) rec.el.style.setProperty("--play-delay", "0ms");
      });
      this._annotate();
    }, 1600 + active.length * 45 + 120);
  }

  /* ---------------- hover / isolate ---------------- */

  setHovered(id) {
    this.hovered = id;
    if (this.isolated) return;
    this.asm.classList.toggle("is-dimming", !!id);
    this.layers.forEach((rec, lid) => {
      const hot = lid === id;
      rec.el.classList.toggle("is-hot", hot);
      rec.el.style.setProperty("--extra", hot ? "12px" : "0px");
    });
    this.queueAnnotate();
  }

  setIsolated(id) {
    this.isolated = id;
    this.asm.classList.remove("is-dimming");
    this.layers.forEach((rec, lid) => {
      rec.el.classList.remove("is-hot");
      rec.el.style.setProperty("--extra", "0px");
      rec.el.classList.toggle("is-hidden", !!id && lid !== id);
      rec.el.classList.toggle("is-isolated", !!id && lid === id);
    });
    this.queueAnnotate();
  }

  /**
   * Size the label gutter to the widest label actually rendered, rather
   * than guessing — "PCB — hotswap, 104 keys" is a lot wider than
   * "PE foam — 0.4mm", and the set and case names change the longest one.
   * Measured once per render, never inside the annotate loop, so there is
   * no fit -> annotate -> fit feedback.
   */
  _measureGutter() {
    const stageW = this.stage.clientWidth;
    if (stageW < 560) { this.gutter = 0; return; }   // too narrow to annotate

    if (!this._ruler) {
      this._ruler = svgEl("text");
      this._ruler.setAttribute("x", "-9999");
      this._ruler.setAttribute("y", "-9999");
      this.svg.append(this._ruler);
    }
    let widest = 0;
    for (const def of activeLayers()) {
      this._ruler.textContent = layerLabel(def);
      const w = this._ruler.getComputedTextLength();
      if (w > widest) widest = w;
    }
    this.gutter = Math.min(320, Math.max(150, Math.ceil(widest) + 34));
  }

  /* ---------------- fit ---------------- */

  fit() {
    if (!this.state) return;
    const geo = GEOMETRY[this.state.layout];
    this._measureGutter();          // depends on stage width, so re-run on resize
    const availW = this.stage.clientWidth - this.gutter;
    const availH = this.stage.clientHeight;
    if (availW <= 0 || availH <= 0) return;

    const w = px.x(geo.widthU);
    const h = px.y(geo.heightU);
    const rx = 54 * Math.PI / 180;
    const rz = 36 * Math.PI / 180;

    // projected bounding box of the tilted, rotated plane
    const projW = Math.abs(w * Math.cos(rz)) + Math.abs(h * Math.sin(rz));
    const planeH = Math.abs(w * Math.sin(rz)) + Math.abs(h * Math.cos(rz));
    const maxSpread = Math.max(...activeLayers().map(l => l.spread));
    const projH = planeH * Math.cos(rx) + maxSpread * Math.sin(rx) + 40;

    const scale = Math.min(1, availW / projW, availH / projH);
    this.asm.style.setProperty("--scale", scale.toFixed(4));
    this.fitBox.style.setProperty("--fit-w", (projW * scale) + "px");
    this.fitBox.style.setProperty("--fit-h", (projH * scale) + "px");
    this.fitBox.style.marginRight = this.gutter + "px";
    this.queueAnnotate();
  }

  /* ---------------- annotation (§11) ---------------- */

  queueAnnotate() {
    if (this._annotateQueued) return;
    this._annotateQueued = true;
    requestAnimationFrame(() => {
      this._annotateQueued = false;
      this._annotate();
    });
  }

  _annotate() {
    if (!this.state) return;
    const show = this.state.explode > ANNOTATE_FROM && !this.isolated && this.gutter > 0;
    const stageRect = this.stage.getBoundingClientRect();

    if (!show) {
      this.svg.querySelectorAll(".is-on").forEach(n => n.classList.remove("is-on"));
      return;
    }

    const gutterX = stageRect.width - this.gutter + 18;
    const active = activeLayers();

    // measure each layer's projected right edge and vertical centre
    const items = [];
    active.forEach((def, i) => {
      const rec = this.layers.get(def.id);
      if (!rec || rec.el.style.display === "none") return;
      const r = rec.el.getBoundingClientRect();
      items.push({
        def: def,
        index: i,
        x: Math.min(r.right - stageRect.left, gutterX - 40),
        y: r.top + r.height / 2 - stageRect.top
      });
    });

    // Labels must never overlap: walk top to bottom and push each one down
    // to clear the previous. A nudged label gets a jogged leader.
    items.sort((a, b) => a.y - b.y);
    for (let i = 0; i < items.length; i++) {
      items[i].labelY = items[i].y;
      if (i > 0 && items[i].labelY < items[i - 1].labelY + LABEL_MIN_GAP) {
        items[i].labelY = items[i - 1].labelY + LABEL_MIN_GAP;
      }
      items[i].jogged = Math.abs(items[i].labelY - items[i].y) > 0.5;
    }

    this._paintAnnotations(items, gutterX);
  }

  _paintAnnotations(items, gutterX) {
    // reuse nodes; only rebuild when the layer set changes
    if (!this._annNodes || this._annNodes.length !== items.length) {
      this.svg.textContent = "";
      this._annNodes = items.map(() => {
        const path = svgEl("path");
        const text = svgEl("text");
        this.svg.append(path, text);
        return { path: path, text: text };
      });
    }

    items.forEach((it, i) => {
      const n = this._annNodes[i];
      // each leader gets its own vertical lane so jogs never collide
      const elbow = gutterX - 6 - i * 5;
      const d = it.jogged
        ? "M " + it.x + " " + it.y + " H " + elbow + " V " + it.labelY + " H " + gutterX
        : "M " + it.x + " " + it.y + " H " + gutterX;
      n.path.setAttribute("d", d);
      n.text.setAttribute("x", String(gutterX + 8));
      n.text.setAttribute("y", String(it.labelY));
      n.text.textContent = layerLabel(it.def);
      const delay = (it.index * 45) + "ms";
      n.path.style.transitionDelay = delay;
      n.text.style.transitionDelay = delay;
      n.path.classList.add("is-on");
      n.text.classList.add("is-on");
    });
  }
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/* =====================================================================
   PERSISTENCE (§10) — URL hash and localStorage

   Storage is wrapped because the page has to run from file://, where some
   browsers throw on localStorage rather than just returning null.
   ===================================================================== */

const SHARE_KEYS = [
  ["layout", "layout"],
  ["case", "caseId"],
  ["caps", "keycapSetId"],
  ["sw", "switchId"],
  ["mount", "mount"],
  ["blank", "blankColor"]
];

function storageGet(key) {
  try { return window.localStorage.getItem(key); } catch (err) { return null; }
}
function storageSet(key, value) {
  try { window.localStorage.setItem(key, value); return true; } catch (err) { return false; }
}

/** Serialise the shareable part of state into a hash string. */
function stateToHash(st) {
  const parts = [];
  for (const [param, field] of SHARE_KEYS) {
    if (param === "blank" && st.keycapSetId !== "blanks") continue;
    const v = st[field];
    if (v == null) continue;
    parts.push(param + "=" + encodeURIComponent(v));
  }
  return "#" + parts.join("&");
}

/** Parse a hash into a validated partial state. Unknown ids are dropped. */
function hashToState(hash) {
  const out = {};
  const raw = (hash || "").replace(/^#/, "");
  if (!raw) return out;

  const params = new URLSearchParams(raw);
  const valid = {
    layout: (v) => LAYOUTS.some(l => l.id === v),
    caseId: (v) => CASES.some(c => c.id === v),
    keycapSetId: (v) => KEYCAP_SETS.some(s => s.id === v),
    switchId: (v) => SWITCHES.some(s => s.id === v),
    mount: (v) => MOUNTS.some(m => m.id === v),
    blankColor: (v) => /^#[0-9a-f]{6}$/i.test(v)
  };

  for (const [param, field] of SHARE_KEYS) {
    const v = params.get(param);
    if (v != null && valid[field](v)) out[field] = v;
  }
  return out;
}

/** Never push — the back button should not walk through every tweak (§10). */
function writeHash() {
  const hash = stateToHash(state);
  if (location.hash === hash) return;
  try {
    history.replaceState(null, "", location.pathname + location.search + hash);
  } catch (err) {
    location.hash = hash;              // file:// in some browsers
  }
}

function persistLast() {
  const snap = {};
  for (const [, field] of SHARE_KEYS) snap[field] = state[field];
  snap.sound = state.sound;
  storageSet(STORAGE_KEY_LAST, JSON.stringify(snap));
}

/** hash → localStorage → defaults (§10). */
function hydrateState() {
  const fromHash = hashToState(location.hash);
  if (Object.keys(fromHash).length) return Object.assign(state, fromHash);

  const raw = storageGet(STORAGE_KEY_LAST);
  if (raw) {
    try {
      const saved = JSON.parse(raw);
      const clean = hashToState(stateToHash(Object.assign({}, DEFAULT_STATE, saved)));
      Object.assign(state, clean);
      if (typeof saved.sound === "boolean") state.sound = saved.sound;
    } catch (err) { /* corrupt entry — fall through to defaults */ }
  }
  return state;
}

/* =====================================================================
   SAVED BUILDS (§10) — up to 8, click to load, shift-click to delete
   ===================================================================== */

function readSaved() {
  const raw = storageGet(STORAGE_KEY_SAVED);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.slice(0, MAX_SAVED_BUILDS) : [];
  } catch (err) { return []; }
}

function writeSaved(list) {
  storageSet(STORAGE_KEY_SAVED, JSON.stringify(list.slice(0, MAX_SAVED_BUILDS)));
  renderSavedBuilds();
}

function saveCurrentBuild() {
  const snap = {};
  for (const [, field] of SHARE_KEYS) snap[field] = state[field];
  const list = readSaved();
  const same = (a, b) => SHARE_KEYS.every(([, f]) => a[f] === b[f]);
  if (list.some(b => same(b, snap))) return false;      // already saved
  list.unshift(snap);
  writeSaved(list);
  return true;
}

/** Four caps in the set's own colours — enough to recognise a build. */
function savedChipPreview(build) {
  const set = effectiveSet(getKeycapSet(build.keycapSetId) || getKeycapSet(DEFAULT_STATE.keycapSetId),
                           { blankColor: build.blankColor });
  const roles = ["accent", "alpha", "alpha", "mod"];
  const wrap = el("span", "saved-chip__caps");
  roles.forEach(name => {
    const dot = el("i");
    dot.style.background = (set.roles[name] || set.roles.alpha).cap;
    wrap.append(dot);
  });
  return wrap;
}

function renderSavedBuilds() {
  const host = document.getElementById("saved-list");
  const list = readSaved();
  host.textContent = "";

  if (!list.length) {
    const empty = el("span", "hint");
    empty.style.margin = "0";
    empty.textContent = "None yet — press S or Save.";
    host.append(empty);
    return;
  }

  list.forEach((build, i) => {
    const chip = el("button", "saved-chip");
    chip.type = "button";
    const layout = getLayout(build.layout);
    const set = getKeycapSet(build.keycapSetId);
    const label = (set ? set.name : "?") + " · " + (layout ? layout.short : "?");
    chip.title = label + " — click to load, shift-click to delete";
    chip.setAttribute("aria-label", "Load saved build: " + label);
    chip.append(savedChipPreview(build));
    chip.addEventListener("click", (e) => {
      if (e.shiftKey) {
        const next = readSaved();
        next.splice(i, 1);
        writeSaved(next);
        return;
      }
      setState(build);
    });
    host.append(chip);
  });
}

/* =====================================================================
   SPEC SHEET (§13) — every number computed, nothing hardcoded
   ===================================================================== */

function computeBuild() {
  const layout = getLayout(state.layout);
  const rawSet = getKeycapSet(state.keycapSetId);
  const set = effectiveSet(rawSet, state);
  const sw = getSwitch(state.switchId);
  const kase = getCase(state.caseId);
  const mount = getMount(state.mount);

  const keyCount = layout.keyCount;
  const totalActuationG = keyCount * sw.actuationG;
  const capsPrice = rawSet.priceUSD;
  const switchPacks = Math.ceil(keyCount / 10);
  const switchPrice = switchPacks * sw.pricePer10USD;
  const casePrice = kase.priceUSD;

  return {
    layout: layout, set: rawSet, resolvedSet: set, sw: sw, case: kase, mount: mount,
    keyCount: keyCount,
    totalActuationG: totalActuationG,
    totalActuationKg: totalActuationG / 1000,
    capsPrice: capsPrice,
    switchPacks: switchPacks,
    switchPrice: switchPrice,
    casePrice: casePrice,
    estTotal: capsPrice + switchPrice + casePrice,
    soundProfile: soundProfile(rawSet, sw, kase, mount),
    vibeTags: vibeTags(set, sw)
  };
}

function soundProfile(set, sw, kase, mount) {
  const s = sw.sound.toLowerCase();

  let headline;
  if (sw.type.indexOf("silent") === 0) headline = "Quiet and close";
  else if (sw.type === "clicky") headline = "Sharp and unmissable";
  else if (/thock|deep|dense/.test(s)) headline = "Deep and punctuated";
  else if (/bright|high-pitched|poppy|clack/.test(s)) headline = "Bright and poppy";
  else if (sw.type === "tactile") headline = "Textured and controlled";
  else headline = "Even and unfussy";

  const mountClause = {
    "gasket": "The gasket mount and Poron stack absorb most of the case resonance",
    "top":    "The top mount holds the plate rigid, so the case rings a little more",
    "tray":   "The tray mount lets the PCB flex unevenly, which adds some hollowness",
    "o-ring": "The o-ring mount leaves a slight bounce and a hollow edge"
  }[mount.id];

  const caseClause = kase.id === "brass"
    ? "The full brass case adds mass and drops the pitch further."
    : kase.id === "polycarb"
      ? "Polycarbonate lifts the pitch and rounds off the edges."
      : "The " + kase.finish + " case keeps it tight and neutral.";

  const capClause = set.blank
    ? "Undyed PBT caps keep the top end dry."
    : "Thick doubleshot ABS caps add a little weight to every press.";

  return headline + ". " + mountClause + ", leaving the " + sw.name + "'s " +
         sw.stemMaterial.replace(/ \(.*\)/, "") + " bottom-out to carry the sound. " +
         caseClause + " " + capClause;
}

/** Three tags: palette luminance, switch weight, and how loud it is (§13). */
function vibeTags(set, sw) {
  const alphaL = relativeLuminance(set.roles.alpha.cap);
  const accent = set.roles.accent || set.roles.alpha;
  const accentL = relativeLuminance(accent.cap);

  let palette;
  if (alphaL > 0.55) palette = "bright";
  else if (alphaL < 0.08) palette = "blackout";
  else if (alphaL < 0.25) palette = "dark";
  else palette = "muted";
  if (Math.abs(accentL - alphaL) > 0.35) palette = palette + "-contrast";

  const weight = sw.bottomOutG >= 70 ? "heavy"
               : sw.bottomOutG <= 57 ? "light"
               : "medium";

  const loudness = sw.type.indexOf("silent") === 0 ? "office-safe"
                 : sw.type === "clicky" ? "loud"
                 : /thock|deep|dense|muted/.test(sw.sound) ? "thocky"
                 : "clacky";

  return [palette, weight, loudness];
}

const money = (n) => "$" + n.toFixed(2).replace(/\.00$/, "");
const num = (n) => n.toLocaleString("en-US");

function renderSpecSheet() {
  const b = computeBuild();
  const host = document.getElementById("spec-sheet");
  host.textContent = "";

  const rows = [
    ["Layout", b.layout.name + " — " + b.keyCount + " keys"],
    ["Case", b.case.name + " — " + b.case.finish],
    ["Mount", b.mount.name + " — " + b.mount.blurb],
    ["Keycaps", b.set.name + " — " + b.set.profile + " profile, " + b.set.material],
    ["Switches", b.sw.brand + " " + b.sw.name + " — " + (SWITCH_TYPE_LABELS[b.sw.type] || b.sw.type)],
    ["Weights", b.sw.actuationG + " g actuation · " + b.sw.bottomOutG + " g bottom-out"],
    ["Travel", b.sw.preTravelMm.toFixed(1) + " mm pre · " + b.sw.totalTravelMm.toFixed(1) + " mm total"],
    ["Total actuation force", num(b.totalActuationG) + " g · " + b.totalActuationKg.toFixed(2) + " kg"],
    ["Estimated price", null],
    ["Sound profile", b.soundProfile],
    ["Vibe", b.vibeTags.join(" · ")]
  ];

  const table = el("table", "spec-table");
  const tbody = el("tbody");

  rows.forEach(([label, value]) => {
    const tr = el("tr");
    const th = el("th");
    th.setAttribute("scope", "row");
    th.textContent = label;
    const td = el("td");

    if (label === "Estimated price") {
      const list = el("div", "price-breakdown");
      const line = (k, v) => {
        const row = el("div");
        const a = el("span"); a.textContent = k;
        const c = el("span"); c.textContent = v;
        row.append(a, c);
        return row;
      };
      list.append(
        line("Keycaps — " + b.set.name, money(b.capsPrice)),
        line("Switches — " + b.switchPacks + " × 10 @ " + money(b.sw.pricePer10USD), money(b.switchPrice)),
        line("Case — " + b.case.name, money(b.casePrice))
      );
      const total = line("Estimated total", money(b.estTotal));
      total.className = "price-total";
      list.append(total);
      const note = el("div", "hint");
      note.textContent = "Estimates only — not live pricing.";
      td.append(list, note);
    } else {
      td.textContent = value;
    }

    tr.append(th, td);
    tbody.append(tr);
  });

  table.append(tbody);
  host.append(table);
}

/* =====================================================================
   EXPORTS (§10)
   ===================================================================== */

function buildMarkdown() {
  const b = computeBuild();
  const L = [];
  L.push("# " + b.set.name + " · " + b.layout.name + " · " + b.sw.brand + " " + b.sw.name);
  L.push("");
  L.push("| Field | Value |");
  L.push("| --- | --- |");
  L.push("| Layout | " + b.layout.name + " — " + b.keyCount + " keys |");
  L.push("| Case | " + b.case.name + " — " + b.case.finish + " |");
  L.push("| Mount | " + b.mount.name + " |");
  L.push("| Keycaps | " + b.set.name + " — " + b.set.profile + " profile, " + b.set.material + " |");
  L.push("| Switches | " + b.sw.brand + " " + b.sw.name + " — " + (SWITCH_TYPE_LABELS[b.sw.type] || b.sw.type) + " |");
  L.push("| Weights | " + b.sw.actuationG + " g / " + b.sw.bottomOutG + " g |");
  L.push("| Travel | " + b.sw.preTravelMm.toFixed(1) + " / " + b.sw.totalTravelMm.toFixed(1) + " mm |");
  L.push("| Total actuation force | " + num(b.totalActuationG) + " g (" + b.totalActuationKg.toFixed(2) + " kg) |");
  L.push("| Keycaps (est.) | " + money(b.capsPrice) + " |");
  L.push("| Switches (est.) | " + b.switchPacks + " × 10 @ " + money(b.sw.pricePer10USD) + " = " + money(b.switchPrice) + " |");
  L.push("| Case (est.) | " + money(b.casePrice) + " |");
  L.push("| **Estimated total** | **" + money(b.estTotal) + "** |");
  L.push("| Vibe | " + b.vibeTags.join(" · ") + " |");
  L.push("");
  L.push(b.soundProfile);
  L.push("");
  L.push("_Prices are estimates, not live pricing. Colours are screen approximations._");
  return L.join("\n");
}

/** Full resolved config, including the colour values (§10). */
function buildJSON() {
  const b = computeBuild();
  const geo = GEOMETRY[state.layout];
  return JSON.stringify({
    generatedAt: new Date().toISOString(),
    shareUrl: shareLink(),
    layout: { id: b.layout.id, name: b.layout.name, keyCount: b.keyCount, widthU: b.layout.widthU },
    case: { id: b.case.id, name: b.case.name, finish: b.case.finish, body: b.case.body, accent: b.case.accent, priceUSD: b.case.priceUSD },
    mount: { id: b.mount.id, name: b.mount.name },
    keycaps: {
      id: b.set.id, name: b.set.name, designer: b.set.designer, year: b.set.year,
      profile: b.set.profile, material: b.set.material, priceUSD: b.set.priceUSD,
      roles: b.resolvedSet.roles,
      resolved: geo.keys.map(k => {
        const role = resolveRole(b.resolvedSet, k);
        return { key: k.id, group: k.group, role: role.name, cap: role.cap, legend: role.legend };
      })
    },
    switch: b.sw,
    derived: {
      totalActuationG: b.totalActuationG,
      totalActuationKg: Number(b.totalActuationKg.toFixed(3)),
      capsPriceUSD: b.capsPrice,
      switchPriceUSD: Number(b.switchPrice.toFixed(2)),
      casePriceUSD: b.casePrice,
      estimatedTotalUSD: Number(b.estTotal.toFixed(2)),
      priceNote: "Estimates only, not live pricing.",
      soundProfile: b.soundProfile,
      vibeTags: b.vibeTags
    }
  }, null, 2);
}

function shareLink() {
  return location.origin === "null"
    ? location.href.split("#")[0] + stateToHash(state)
    : location.origin + location.pathname + location.search + stateToHash(state);
}

/** Clipboard API needs a secure context; execCommand covers file://. */
function copyText(text, button) {
  const done = (ok) => flashButton(button, ok ? "Copied" : "Copy failed");
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => done(true), () => done(legacyCopy(text)));
    return;
  }
  done(legacyCopy(text));
}

function legacyCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = "-1000px";
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch (err) { ok = false; }
  ta.remove();
  return ok;
}

function flashButton(button, message) {
  if (!button) return;
  if (button._restore == null) button._restore = button.textContent;
  button.textContent = message;
  clearTimeout(button._flash);
  button._flash = setTimeout(() => {
    button.textContent = button._restore;
    button._restore = null;
  }, 1400);
}

function downloadJSON() {
  const blob = new Blob([buildJSON()], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "substrate-" + state.layout + "-" + state.keycapSetId + "-" + state.switchId + ".json";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* =====================================================================
   SHORTCUTS (§10) — 1-6 layouts, E explode, R randomize, S save, ? sheet
   ===================================================================== */

function isTyping(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || target.isContentEditable;
}

function randomizeBuild() {
  const patch = {
    layout: pick(LAYOUTS).id,
    caseId: pick(CASES).id,
    mount: pick(MOUNTS).id,
    keycapSetId: pick(KEYCAP_SETS).id,
    switchId: pick(SWITCHES).id
  };
  if (patch.keycapSetId === "blanks") patch.blankColor = pick(CASES).body;
  setState(patch);
  // everything lands at once; the per-key ripple sells it (§10)
  boards.forEach(b => b.ripple());
}

function initShortcuts() {
  const sheet = document.getElementById("shortcut-sheet");

  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key === "Escape" && sheet.open) { sheet.close(); return; }
    if (isTyping(e.target)) return;

    const k = e.key;

    if (k >= "1" && k <= "6") {
      const layout = LAYOUTS[Number(k) - 1];
      if (layout) { setState({ layout: layout.id }); e.preventDefault(); }
      return;
    }

    switch (k.toLowerCase()) {
      case "e":
        if (exploded) exploded.play();
        e.preventDefault();
        break;
      case "r":
        randomizeBuild();
        e.preventDefault();
        break;
      case "s":
        handleSave(document.getElementById("btn-save"));
        e.preventDefault();
        break;
      case "?":
        if (sheet.open) sheet.close(); else sheet.showModal();
        e.preventDefault();
        break;
    }
  });

  sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.close(); });
  const close = document.getElementById("shortcut-close");
  if (close) close.addEventListener("click", () => sheet.close());
}

function handleSave(button) {
  const added = saveCurrentBuild();
  flashButton(button, added ? "Saved" : "Already saved");
}

/* =====================================================================
   SCROLL REVEAL (§9) — fires once, 60ms stagger within a group
   ===================================================================== */

function initReveals() {
  const els = document.querySelectorAll(".reveal");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (reduced || !("IntersectionObserver" in window)) {
    els.forEach(e => e.classList.add("is-in"));
    return;
  }

  const io = new IntersectionObserver((entries) => {
    entries.filter(e => e.isIntersecting).forEach((entry, i) => {
      entry.target.style.setProperty("--reveal-delay", `${i * 60}ms`);
      entry.target.classList.add("is-in");
      io.unobserve(entry.target);
    });
  }, { rootMargin: "0px 0px -12% 0px", threshold: 0.05 });

  els.forEach(e => io.observe(e));
}

/* =====================================================================
   BOOT
   ===================================================================== */

/**
 * Phase 3 gate: applying a set must cost less than one frame (16.7ms).
 * Reading offsetHeight after each swap forces style recalc + layout into
 * the measurement, so this is the real cost, not just the JS.
 */
async function benchSets(passes = 5) {
  const stage = document.getElementById("stage");
  const before = state.keycapSetId;
  // Race rAF against a timer: rAF never fires in a hidden tab, and this
  // must not hang when the page is backgrounded.
  const frame = () => new Promise(r => {
    let done = false;
    const go = () => { if (!done) { done = true; r(); } };
    requestAnimationFrame(go);
    setTimeout(go, 32);
  });
  const samples = new Map(KEYCAP_SETS.map(s => [s.id, []]));

  for (let p = 0; p < passes; p++) {
    for (const s of KEYCAP_SETS) {
      // One change per frame — the real scenario. Measuring a tight loop of
      // 80 back-to-back swaps just measures accumulated style/GC debt.
      await frame();
      const t0 = performance.now();
      setState({ keycapSetId: s.id });
      void stage.offsetHeight;          // force style recalc + layout into the timing
      samples.get(s.id).push(performance.now() - t0);
    }
  }
  setState({ keycapSetId: before });

  const median = (a) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
  const rows = KEYCAP_SETS.map(s => ({
    set: s.name,
    median: round2(median(samples.get(s.id))),
    best: round2(Math.min(...samples.get(s.id))),
    worst: round2(Math.max(...samples.get(s.id)))
  }));
  const slowest = Math.max(...rows.map(r => r.median));
  return { rows, worst: slowest, ok: slowest < 16.7, passes };
}

/* =====================================================================
   §15 FINAL ACCEPTANCE CHECKLIST — the automatable half.

   Anything that needs a specific viewport (390px usability, the 3/2/1
   gallery breakpoints) or a specific environment (file://, fonts blocked)
   is checked from the outside; this covers the rest.
   ===================================================================== */

function checklist() {
  const rows = [];
  const add = (check, pass, detail) =>
    rows.push({ check, result: pass === null ? "SKIP" : (pass ? "PASS" : "FAIL"), detail: detail || "" });

  /* key counts */
  const counts = LAYOUTS.map(l => GEOMETRY[l.id].keyCount).join(" / ");
  add("Key counts exact", counts === "104 / 87 / 84 / 68 / 61 / 40", counts);

  /* the rendered DOM must agree with unit math, not carry its own pixels */
  let mismatched = 0;
  const geo = GEOMETRY[state.layout];
  document.querySelectorAll("#stage .cap").forEach(cap => {
    const key = geo.keys.find(k => k.id === cap.dataset.key);
    if (!key) return;
    if (cap.style.getPropertyValue("--x") !== px.x(key.x) + "px") mismatched++;
    if (cap.style.getPropertyValue("--w") !== px.capW(key.u) + "px") mismatched++;
  });
  add("Cap positions derive from unit math", mismatched === 0, mismatched + " mismatches");

  /* everything reachable */
  const reach = {
    sets: document.querySelectorAll("#keycap-gallery .set-card").length,
    switches: document.querySelectorAll("#switch-gallery .switch-card").length,
    cases: document.querySelectorAll("#case-swatches .swatch-btn").length,
    mounts: document.getElementById("sel-mount").options.length
  };
  add("16 sets / 32 switches / 8 cases / 4 mounts reachable",
      reach.sets === 16 && reach.switches === 32 && reach.cases === 8 && reach.mounts === 4,
      JSON.stringify(reach));

  /* zero external images, zero canvas/WebGL */
  const imgs = document.querySelectorAll("img, canvas, video, object, embed").length;
  const externalRefs = [...document.querySelectorAll("[src], [href]")]
    .map(n => n.getAttribute("src") || n.getAttribute("href"))
    .filter(v => v && /^https?:/i.test(v) && !/fonts\.(googleapis|gstatic)\.com/.test(v));
  add("Zero external images, zero canvas/WebGL", imgs === 0 && externalRefs.length === 0,
      imgs + " media nodes, " + externalRefs.length + " external refs");

  /* legend contrast */
  let worstContrast = Infinity, worstPair = "";
  for (const set of KEYCAP_SETS) {
    if (set.blank) continue;
    for (const [name, role] of Object.entries(set.roles)) {
      const r = contrastRatio(role.cap, role.legend);
      if (r < worstContrast) { worstContrast = r; worstPair = set.name + "/" + name; }
    }
  }
  add("All legend/cap pairs >= 3:1", worstContrast >= 3, "worst " + worstContrast + ":1 (" + worstPair + ")");

  /* share link round-trips */
  const before = {};
  for (const [, f] of SHARE_KEYS) before[f] = state[f];
  const round = hashToState(stateToHash(state));
  const tripOk = SHARE_KEYS.every(([p, f]) =>
    (p === "blank" && state.keycapSetId !== "blanks") ? true : round[f] === before[f]);
  add("Share link round-trips", tripOk, stateToHash(state));

  /* saved builds persist */
  let persistOk = false;
  try {
    const backup = storageGet(STORAGE_KEY_SAVED);
    writeSaved([{ layout: "60", caseId: "brass", keycapSetId: "gmk-laser", switchId: "boba-u4t", mount: "top" }]);
    persistOk = readSaved().length === 1 && readSaved()[0].caseId === "brass";
    if (backup == null) { try { window.localStorage.removeItem(STORAGE_KEY_SAVED); } catch (e) {} }
    else storageSet(STORAGE_KEY_SAVED, backup);
    renderSavedBuilds();
  } catch (err) { persistOk = false; }
  add("Saved builds survive a reload", persistOk, "localStorage round-trip");

  /* every interactive control is tab-reachable */
  const focusables = [...document.querySelectorAll(
    "a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])")]
    .filter(n => !n.disabled && n.offsetParent !== null);
  const unreachable = focusables.filter(n => n.tabIndex < 0);
  add("Interactive controls tab-reachable", unreachable.length === 0,
      focusables.length + " focusable, " + unreachable.length + " unreachable");

  /* reduced motion is actually wired, not just declared */
  const rmRules = [...document.styleSheets].flatMap(s => { try { return [...s.cssRules]; } catch (e) { return []; } })
    .filter(r => r.media && /prefers-reduced-motion/.test(r.conditionText || r.media.mediaText));
  add("prefers-reduced-motion honoured", rmRules.length >= 3 && typeof prefersReducedMotion === "function",
      rmRules.length + " media blocks + JS guards");

  /* section rhythm */
  const pad = parseFloat(getComputedStyle(document.getElementById("keycaps")).paddingTop);
  const wide = window.innerWidth > 1024;
  add("Section rhythm 160px on desktop", !wide || pad === 160, pad + "px at " + window.innerWidth + "px wide");

  /* exploded labels never overlap, swept across every mount and layout */
  let overlaps = 0, sweeps = 0;
  if (exploded && exploded.gutter > 0) {
    const restore = { mount: state.mount, layout: state.layout, explode: state.explode };
    for (const m of MOUNTS) for (const l of LAYOUTS) {
      setState({ mount: m.id, layout: l.id });
      for (let v = 41; v <= 100; v += 5) {
        state.explode = v;
        exploded.setExplode(v, { animate: false });
        exploded._annotate();
        sweeps++;
        const ys = [...exploded.svg.querySelectorAll("text.is-on")]
          .map(t => +t.getAttribute("y")).sort((a, b) => a - b);
        for (let i = 1; i < ys.length; i++) if (ys[i] - ys[i - 1] < 23.99) overlaps++;
      }
    }
    setState(restore);
  }
  add("Exploded labels never overlap", sweeps ? overlaps === 0 : null,
      sweeps ? overlaps + " overlaps across " + sweeps + " configs" : "not run — stage under 560px, annotations disabled");

  const failed = rows.filter(r => r.result === "FAIL");
  const skipped = rows.filter(r => r.result === "SKIP");
  console.groupCollapsed("%c§15 checklist — " + (rows.length - failed.length) + "/" + rows.length + " passing",
    "font-weight:600;color:" + (failed.length ? "#E07A5F" : "#7FD1C1"));
  console.table(rows);
  console.groupEnd();
  return {
    rows,
    failed: failed.map(r => r.check + " — " + r.detail),
    skipped: skipped.map(r => r.check + " — " + r.detail)
  };
}

function init() {
  // hash → localStorage → defaults, before anything paints (§10)
  hydrateState();

  populateControls();
  renderKeycapGallery();
  renderSwitchGallery();
  renderSavedBuilds();

  boards.push(new BoardRenderer(document.getElementById("stage"), { interactive: true }));
  boards.push(new BoardRenderer(document.getElementById("hero-stage"), { interactive: false }));
  exploded = new ExplodedView(document.getElementById("exploded-stage"));

  setState({});           // first paint
  initReveals();
  initShortcuts();
  validate();

  // A share link pasted into the address bar of this same tab
  window.addEventListener("hashchange", () => {
    const patch = hashToState(location.hash);
    if (Object.keys(patch).length) setState(patch);
  });

  window.addEventListener("resize", () => {
    boards.forEach(b => b.fit());
    if (exploded) exploded.fit();
  });

  window.KB = {
    state, setState, exploded, ExplodedView, SwitchAudio, synthParams, buildSwitch,
    renderSwitchGallery, soundCheck, LAYOUTS, GEOMETRY, KEYCAP_SETS, SWITCHES, CASES,
    MOUNTS, LAYERS, boards, contrastRatio, buildGeometry, validate, benchSets,
    effectiveSet, resolveRole, computeBuild, buildMarkdown, buildJSON, shareLink,
    stateToHash, hashToState, readSaved, writeSaved, saveCurrentBuild, checklist
  };
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
