/**
 * Renders the two REVIEW SURFACES for the shipped palette set.
 *
 *   docs/pos-palettes.md          — the deliverable: 4 palettes x 2 grounds, rendered UNSIMULATED.
 *                                   This is the handoff for CVD readers: they judge the palette
 *                                   built for them, directly, with their own eyes.
 *   docs/pos-palettes-review.md   — the normal-vision palette under the three simulations, for a
 *                                   normally-sighted reviewer to check how far it degrades.
 *
 * Keeping these apart matters: showing a CVD reader a *simulation* asks them to validate our model
 * of their vision, which they cannot do. Showing them the real palette asks whether it works, which
 * they can.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { simulate, toHex, apca } from "./color-core.mjs";
import Color from "colorjs.io";

const NORMAL = JSON.parse(
  readFileSync(new URL("./palette.json", import.meta.url), "utf8")
);
const CVD = JSON.parse(
  readFileSync(new URL("./palette-cvd.json", import.meta.url), "utf8")
);
const { sentences, paragraph } = JSON.parse(
  readFileSync(new URL("./samples.json", import.meta.url), "utf8")
);

/**
 * Display order follows the AUTHORED palette's hue sequence, so the swatch strip walks the wheel
 * the way the design does — structure, things, modifiers, actions, back to structure:
 *   utterance 157.5° → pronoun 202.5° → noun 247.5° → adnominal 285° → adjective 315°
 *   → adverb 345° → verb 22.5° → auxiliary 67.5° → particle 112.5°
 */
const CATS = [
  ["utterance", "Utterance", "感動詞", 0.14],
  ["pronoun", "Pronoun", "代名詞", 5.06],
  ["noun", "Noun", "名詞", 26.4],
  ["adnominal", "Adnominal", "連体詞", 1.38],
  ["adjective", "Adjective", "形容詞", 1.51],
  ["adverb", "Adverb", "副詞", 1.81],
  ["verb", "Verb", "動詞", 13.71],
  ["auxiliary", "Auxiliary", "助動詞", 10.16],
  ["particle", "Particle", "助詞", 29.05]
];
const KEYS = CATS.map((c) => c[0]);
const BG = { dark: "#1f1f1f", light: "#ffffff" };
const PALETTES = [
  [
    "normal",
    "Standard",
    "The broad-audience palette. Optimised for normal colour vision while degrading as gracefully as it can — this is the one used in teaching materials."
  ],
  [
    "protan",
    "Protanopia",
    "Built natively for protanopia (red-blind). Hues sit on the blue–yellow axis that survives; lightness carries most of the signal."
  ],
  [
    "deutan",
    "Deuteranopia",
    "Built natively for deuteranopia (green-blind), the most common CVD. Same axis strategy as protan, tuned to that viewer's response."
  ],
  [
    "tritan",
    "Tritanopia",
    "Built natively for tritanopia (blue-blind, rare). The surviving axis here is red–cyan instead."
  ]
];

const cssFor = (variant, ground) =>
  variant === "normal" ? NORMAL[ground].css : CVD[variant][ground].css;

const JA = `'Yu Gothic','Hiragino Kaku Gothic ProN',Meiryo,'MS Gothic',sans-serif`;

const STYLE = `<style>
.pal{display:grid;grid-template-columns:104px repeat(9,1fr);border-radius:8px;overflow:hidden;
     background:var(--bg);margin:.5rem 0}
.pal .hd{font:600 10px system-ui;color:var(--fg);text-align:center;padding:8px 2px 6px;line-height:1.35}
.pal .hd em{font-style:normal;font-weight:400;opacity:.55}
.pal .rw{font:600 10px system-ui;color:var(--fg);text-align:right;padding-right:8px;align-self:center;opacity:.8}
.pal .sw{height:32px}
.pal .lc{font:11px ui-monospace,monospace;color:var(--fg);text-align:center;padding:6px 0 8px}
.pal .row{display:contents}
.pr{background:var(--bg);color:var(--fg);border-radius:8px;padding:14px 16px;margin:.5rem 0;font-family:${JA}}
.pr h6{font:600 9px system-ui;letter-spacing:.08em;text-transform:uppercase;opacity:.5;margin:0 0 8px;border:0;padding:0}
.pr p{margin:0;font-size:18px;font-weight:var(--w);line-height:1.95}
.pr .flow{font-size:17px;font-weight:var(--w);line-height:2.05}
.pr i{font-style:normal}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:10px 20px}
.cols>div{min-width:0}
.ja{opacity:.55}
.grouplabel{font:600 11px system-ui;letter-spacing:.06em;text-transform:uppercase;
            opacity:.6;margin:14px 0 2px}
/* Comparison groups: exactly two columns, so a 4-up is always a tidy 2x2 in one screenshot. */
.cols2{display:grid;grid-template-columns:1fr 1fr;gap:10px 16px}
.cols2>div{min-width:0}
@media (max-width:720px){.cols2{grid-template-columns:1fr}}
${KEYS.map((k) => `.${k}{color:var(--pos-${k})}.sw.${k}{background:var(--pos-${k})}`).join("\n")}
</style>`;

/** Colour objects come from the `oklch()` SOURCE, never from a hex fallback. */
const colorFor = (variant, ground, k) => new Color(cssFor(variant, ground)[k]);
/** Each palette carries the ground it was designed against. */
const bgFor = (variant, ground) =>
  (variant === "normal" ? NORMAL[ground].bg : CVD[variant][ground].bg) ??
  BG[ground];
/** Foreground for body text on that ground. */
const fgFor = (ground) => (ground === "dark" ? "#faf9f8" : "#39302c");

/** Emit the custom-property block for one palette+ground, optionally simulated. */
const vars = (scope, variant, ground, sim = null) => {
  const css = cssFor(variant, ground);
  const w = ground === "light" ? 500 : 400;
  // Simulations are computed from the source colour and emitted as hex — they are diagnostics.
  const val = (k) => (sim ? toHex(simulate(new Color(css[k]), sim)) : css[k]);
  return `.${scope}{--bg:${bgFor(variant, ground)};--fg:${fgFor(ground)};--w:${w};${KEYS.map(
    (k) => `--pos-${k}:${val(k)}`
  ).join(";")}}`;
};

const swatchGrid = (scope, variant, ground) => {
  let h = `<div class="pal ${scope}"><span></span>`;
  h += CATS.map(
    ([, label, , pct]) => `<span class="hd">${label}<br><em>${pct}%</em></span>`
  ).join("");
  h += `<span class="rw">colour</span><span class="row">${KEYS.map(
    (k) => `<span class="sw ${k}"></span>`
  ).join("")}</span>`;
  h += `<span class="rw">APCA</span>${KEYS.map(
    (k) =>
      `<span class="lc">${apca(colorFor(variant, ground, k), bgFor(variant, ground)).toFixed(0)}</span>`
  ).join("")}`;
  return `${h}</div>`;
};

const tokens = (toks) =>
  toks
    .map(([t, c]) => (c && KEYS.includes(c) ? `<i class="${c}">${t}</i>` : t))
    .join("");

const proseBlock = (scope, title, n = 6) =>
  `<div class="pr ${scope}"><h6>${title}</h6>${sentences
    .slice(0, n)
    .map((s) => `<p>${tokens(s.toks)}</p>`)
    .join("")}</div>`;

// ── Surface 1: the deliverable (unsimulated, for direct judgement) ──────────
{
  let css = "";
  for (const [v] of PALETTES) {
    for (const g of ["dark", "light"]) css += `${vars(`${v}-${g}`, v, g)}\n`;
  }

  let md = `<!-- generated by scratchpad/gen-palettes.mjs — do not hand-edit -->
${STYLE.replace("</style>", `${css}</style>`)}

# Part-of-speech palettes

Four palettes, each on both grounds. **Everything here is rendered as it actually is — no
simulations.** Pick whichever reads most clearly to you; the extension lets you choose.

Each palette assigns a colour to nine parts of speech so that word boundaries are visible in
unspaced Japanese. The percentages are how often each category appears in a 941,722-token corpus.

> **If you have a colour-vision deficiency:** the palette named for your type was built *for* your
> vision, not adapted from the standard one — its colours were chosen and measured in the way you
> perceive them. Compare it against **Standard** and tell us which separates words better. There is
> no wrong answer; these are candidates, and your reading is the evidence we lack.

Method and citations: [pos-palette-research.md](pos-palette-research.md).

---
`;

  for (const [v, label, blurb] of PALETTES) {
    md += `\n## ${label}\n\n${blurb}\n`;
    for (const g of ["dark", "light"]) {
      const scope = `${v}-${g}`;
      md += `\n### ${g === "dark" ? "Dark" : "Light"} background\n\n`;
      md += `${swatchGrid(scope, v, g)}\n\n`;
      md += `${proseBlock(scope, "Sample sentences")}\n\n`;
      md +=
        `<details><summary>Longer passage</summary>\n\n` +
        `<div class="pr ${scope}"><div class="flow">${tokens(paragraph)}</div></div>\n\n</details>\n\n`;
    }
    md += `| category | dark (source) | light (source) |\n| --- | --- | --- |\n`;
    for (const [k, label, ja] of CATS) {
      md += `| ${label} <span class="ja">${ja}</span> | \`${cssFor(v, "dark")[k]}\` | \`${cssFor(v, "light")[k]}\` |\n`;
    }
    md += `\n---\n`;
  }

  // ── Side-by-side comparison groups, one screenshot each ────────────────────
  md += `
## Side by side

Four groups, each sized for a single screenshot: the swatches for all four palettes on one ground,
then the same sentence rendered in all four. **Nothing here is simulated** — this is what each
palette actually looks like.
`;
  for (const ground of ["dark", "light"]) {
    md += `\n### All palettes — ${ground} swatches\n\n`;
    for (const [v, label] of PALETTES) {
      md += `<div class="grouplabel">${label}</div>\n${swatchGrid(
        `${v}-${ground}`,
        v,
        ground
      )}\n`;
    }
  }
  for (const ground of ["dark", "light"]) {
    md += `\n### All palettes — ${ground} sample text\n\n`;
    md += `<div class="cols2">${PALETTES.map(
      ([v, label]) =>
        `<div class="pr ${v}-${ground}"><h6>${label}</h6>${sentences
          .slice(0, 6)
          .map((s) => `<p>${tokens(s.toks)}</p>`)
          .join("")}</div>`
    ).join("")}</div>\n`;
  }
  for (const ground of ["dark", "light"]) {
    md += `\n### All palettes — ${ground} paragraph\n\n`;
    md += `<div class="cols2">${PALETTES.map(
      ([v, label]) =>
        `<div class="pr ${v}-${ground}"><h6>${label}</h6>` +
        `<div class="flow">${tokens(paragraph)}</div></div>`
    ).join("")}</div>\n`;
  }
  writeFileSync("C:/GitHub/@saeris/vscode-jisho/docs/pos-palettes.md", md);
  console.log(`written pos-palettes.md (${(md.length / 1024).toFixed(0)} KB)`);
}

// ── Surface 2: simulation review (normal palette only, for a sighted reviewer) ──
{
  const SIMS = [
    ["normal", "Normal vision"],
    ["protan", "Protanopia"],
    ["deutan", "Deuteranopia"],
    ["tritan", "Tritanopia"]
  ];
  let css = "";
  for (const g of ["dark", "light"]) {
    for (const [s] of SIMS) {
      css += `${vars(`sim-${s}-${g}`, "normal", g, s === "normal" ? null : s)}\n`;
    }
  }

  let md = `<!-- generated by scratchpad/gen-palettes.mjs — do not hand-edit -->
${STYLE.replace("</style>", `${css}</style>`)}

# Standard palette — simulation review

**For a normally-sighted reviewer.** The **Standard** palette rendered through simulations of the
three dichromacies, to show how far it degrades. Every block below is the *same nine colours*, passed
through the Brettel–Viénot–Mollon transform.

**Read it this way:** the closer a simulated block looks to *Normal vision*, the better the standard
palette is holding up. Where two colours merge, that pair is indistinguishable for those readers.

> This page is **not** for CVD readers to evaluate — a simulation asks someone to validate our model
> of their vision, which they cannot do from the inside. The palettes built for them are in
> [pos-palettes.md](pos-palettes.md), rendered unsimulated.
>
> A simulation is also a **worst case**: it models *dichromacy* (a cone type absent), while the more
> common condition is *anomalous trichromacy* (a cone type shifted), where more differentiation
> survives than shown here.

Measured ceiling, for context: at full separation (CIEDE2000 ≥ 17) normal vision supports **13**
distinct colours; deuteranopia supports **4**. Nine categories cannot be fully separated for every
viewer by colour alone — hence the per-type palettes and, for editor decorations, a non-colour
channel. See [the research notes](pos-palette-research.md).

---
`;
  for (const g of ["dark", "light"]) {
    md += `\n## ${g === "dark" ? "Dark" : "Light"} background\n\n`;
    for (const [s, label] of SIMS) {
      md += `### ${label}\n\n${swatchGrid(`sim-${s}-${g}`, "normal", g)}\n\n`;
    }
    md += `<div class="cols">${SIMS.map(
      ([s, label]) => `<div>${proseBlock(`sim-${s}-${g}`, label, 5)}</div>`
    ).join("")}</div>\n\n`;
  }
  writeFileSync(
    "C:/GitHub/@saeris/vscode-jisho/docs/pos-palettes-review.md",
    md
  );
  console.log(
    `written pos-palettes-review.md (${(md.length / 1024).toFixed(0)} KB)`
  );
}
