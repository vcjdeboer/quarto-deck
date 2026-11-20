import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
  assertThrows,
} from "jsr:@std/assert@1";
import {
  brandPalette,
  contrast,
  DEFAULT_PALETTE,
  isDark,
  mix,
  NEUTRAL_DEFAULTS,
  normHex,
  parseBrand,
  readBrand,
  resolveColour,
} from "./brand.ts";
import {
  applyTemplateKeys,
  colourMap,
  composeScss,
  cssClasses,
  currentTemplate,
  currentTemplateKeys,
  gitignoreWith,
  newDeckQmd,
  recolourText,
  sampleDeck,
  scssSections,
  TEMPLATE_NAMES,
  templateBrand,
  templateFile,
  templateOutputs,
} from "./templates.ts";
import { TEMPLATE_FILES } from "./templates_bundle.ts";
import { bundleSource, templateFiles } from "./templates/build.ts";
import {
  chainSvg,
  claimVsDataSvg,
  compareTwoSvg,
  roleColours,
  sectionSlide,
} from "./slides.ts";
import { outlineDeck } from "./outline.ts";
import { model } from "./quarto_deck.ts";

/** The colours the extension hard-coded before brands (slides.ts HOUSE). */
const OLD_HOUSE = {
  navy: "#12384A",
  greenDark: "#2E7D32",
  red: "#C0392B",
  grey: "#6B6B6B",
  pill: "#E3E8EB",
  tints: {
    good: "#EEF5EA",
    bad: "#FBEDEB",
    neutral: "#EEF2F4",
    muted: "#F2F2F2",
  },
};
const WUR_HEX = ["#12384A", "#34B233", "#2E8B2C", "#2E7D32", "#C0392B"];

// --- template library --------------------------------------------------------

Deno.test("templates_bundle.ts is in sync with templates/ (run templates/build.ts)", async () => {
  const files = await templateFiles();
  assertEquals(TEMPLATE_FILES, files);
  assertStringIncludes(bundleSource(files), "export const TEMPLATE_FILES");
});

Deno.test("every template has a _brand.yml and a theme.scss with both sections", () => {
  assertEquals(TEMPLATE_NAMES, ["wur", "neutral", "dark", "contrast"]);
  for (const t of TEMPLATE_NAMES) {
    const b = templateBrand(t);
    assertEquals(b.name, t);
    const p = brandPalette(b);
    for (const v of [p.primary, p.good, p.bad, p.muted, p.background]) {
      assertMatch(v, /^#[0-9A-F]{6}$/);
    }
    scssSections(templateFile(`${t}/theme.scss`));
  }
});

Deno.test("no WUR colour outside the wur template (code, shared files, other templates)", async () => {
  for (const [path, text] of Object.entries(TEMPLATE_FILES)) {
    if (path.startsWith("wur/")) continue;
    for (const h of WUR_HEX) {
      assert(!text.toUpperCase().includes(h), `${h} in templates/${path}`);
    }
  }
  for await (const e of Deno.readDir(new URL(".", import.meta.url))) {
    if (
      !e.isFile || !e.name.endsWith(".ts") || e.name.endsWith("_test.ts") ||
      e.name === "templates_bundle.ts"
    ) continue;
    const text = await Deno.readTextFile(new URL(e.name, import.meta.url));
    for (const h of WUR_HEX) {
      assert(!text.toUpperCase().includes(h), `${h} in ${e.name}`);
    }
  }
});

Deno.test("deck-base.html styles every class the slide kinds use, with variables only", () => {
  const css = templateFile("shared/deck-base.html");
  const have = cssClasses(css);
  for (
    const c of [
      "statement",
      "sm",
      "src",
      "lo",
      "lo-done",
      "claims",
      "cmp",
      "four",
      "after",
      "task",
      "ask",
      "wordbank",
      "canvas",
      "hint",
      "diagram",
      "fig-xl",
      "fig-tall",
      "fig-max",
      "ph",
      "exam",
      "stem",
      "side",
      "cred",
      "example",
      "portrait",
      "who",
      "nm",
      "pos",
      "credit-photo",
      "bleed",
      "panel",
      "plab",
      "legend",
      "r-stretch",
    ]
  ) assert(have.has(c), `.${c} missing from deck-base.html`);
  const rules = templateFile("shared/rules.scss");
  for (const c of ["section", "plain", "dark", "bignum", "statement"]) {
    assert(cssClasses(rules).has(c), `.${c} missing from rules.scss`);
  }
  // only the photo-credit pill keeps a literal colour
  const hex = [...css.matchAll(/#[0-9a-fA-F]{3,6}\b/g)].map((m) => m[0]);
  assertEquals(hex, ["#fff"]);
});

// --- brand → palette -------------------------------------------------------------

Deno.test("parseBrand reads palette, roles, logo and fonts", () => {
  const b = parseBrand(`
meta:
  name: lab
color:
  palette:
    ink-blue: "#036"
    sun: "#FFAA00"
  primary: ink-blue
  danger: "#b00"
logo:
  medium:
    light: assets/lab.png
typography:
  fonts:
    - family: Lato
      source: google
  base: Lato
  headings:
    family: Merriweather
`);
  assertEquals(b.name, "lab");
  assertEquals(b.palette, { "ink-blue": "#036", sun: "#FFAA00" });
  assertEquals(b.roles, { primary: "ink-blue", danger: "#b00" });
  assertEquals(b.logo, "assets/lab.png");
  assertEquals(b.fonts, { base: "Lato", headings: "Merriweather" });
  assertEquals(parseBrand("logo: x.png").logo, "x.png");
  assertEquals(resolveColour(b, "primary"), "#003366");
  assertEquals(resolveColour(b, "sun"), "#FFAA00");
  assertEquals(resolveColour(b, "nope"), null);
  const p = brandPalette(b);
  assertEquals([p.primary, p.bad], ["#003366", "#BB0000"]);
  // no success: the neutral green; no grey: derived from text and background
  assertEquals(p.good, NEUTRAL_DEFAULTS.success);
  assertEquals(p.muted, mix(p.foreground, p.background, 0.6));
});

Deno.test("roles map onto the brand: neutral → primary, good → success, bad → danger, muted → grey", () => {
  const p = brandPalette(templateBrand("wur"));
  assertEquals(roleColours(p), {
    good: { ink: OLD_HOUSE.greenDark, tint: OLD_HOUSE.tints.good },
    bad: { ink: OLD_HOUSE.red, tint: OLD_HOUSE.tints.bad },
    neutral: { ink: OLD_HOUSE.navy, tint: OLD_HOUSE.tints.neutral },
    muted: { ink: OLD_HOUSE.grey, tint: OLD_HOUSE.tints.muted },
  });
  assertEquals([p.pill, p.section, p.titleSlide], [
    OLD_HOUSE.pill,
    OLD_HOUSE.navy,
    OLD_HOUSE.navy,
  ]);
});

Deno.test("without _brand.yml the neutral defaults apply, not WUR", async () => {
  const p = brandPalette(null);
  assertEquals(p, DEFAULT_PALETTE);
  assertEquals(p.primary, NEUTRAL_DEFAULTS.primary);
  for (const h of WUR_HEX) {
    assert(!JSON.stringify(p).includes(h));
  }
  // the neutral template is the same look
  const n = brandPalette(templateBrand("neutral"));
  for (const k of ["primary", "good", "bad", "muted", "background"] as const) {
    assertEquals(n[k], p[k], k);
  }
  const dir = await Deno.makeTempDir();
  try {
    assertEquals(await readBrand(dir, "talk.qmd"), null);
    await Deno.mkdir(`${dir}/sub`);
    await Deno.writeTextFile(
      `${dir}/sub/_brand.yml`,
      templateFile("dark/_brand.yml"),
    );
    assertEquals((await readBrand(dir, "sub/talk.qmd"))?.name, "dark");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("colour helpers", () => {
  assertEquals(normHex("#abc"), "#AABBCC");
  assertThrows(() => normHex("navy"));
  assertEquals(mix("#000000", "#FFFFFF", 0.5), "#808080");
  assert(isDark("#12384A") && !isDark("#FAFAF7"));
  assert(contrast("#000000", "#FFFFFF") > 20);
});

Deno.test("every template keeps diagram text readable on its boxes (contrast ≥ 3)", () => {
  for (const t of TEMPLATE_NAMES) {
    const p = brandPalette(templateBrand(t));
    const r = roleColours(p);
    for (const role of ["good", "bad", "neutral"] as const) {
      assert(
        contrast(r[role].ink, r[role].tint) >= 3,
        `${t} ${role}: ${r[role].ink} on ${r[role].tint}`,
      );
    }
    assert(contrast(p.ink, p.surface) >= 4.5, `${t} ink on surface`);
    assert(contrast(p.onPrimary, p.primary) >= 3, `${t} text on primary`);
    assert(contrast(p.onSection, p.section) >= 4.5, `${t} text on section`);
  }
});

// --- patterns take the palette ------------------------------------------------------

Deno.test("diagram patterns: WUR brand gives the old house colours, no brand the neutral ones", () => {
  const spec = { cards: [{ claim: "a claim", measurement: "a measurement" }] };
  const wur = claimVsDataSvg(spec, brandPalette(templateBrand("wur")));
  for (const h of ["#12384A", "#C0392B", "#E3E8EB", "#6B6B6B", "#FBEDEB"]) {
    assertStringIncludes(wur, h);
  }
  const plain = claimVsDataSvg(spec);
  for (const h of WUR_HEX) assert(!plain.includes(h), h);
  assertStringIncludes(plain, NEUTRAL_DEFAULTS.primary);
  assert(!plain.includes("data-bg"));
  const dark = brandPalette(templateBrand("dark"));
  const svg = chainSvg({ boxes: [{ label: "a" }, { label: "b" }] }, dark);
  assertStringIncludes(svg, 'class="diagram" data-bg="dark"');
  assertStringIncludes(
    svg,
    dark.surface === dark.tints.neutral ? "" : dark.tints.neutral,
  );
  assertStringIncludes(
    compareTwoSvg({
      left: { heading: "a", steps: ["x"], outcome: "o" },
      right: { heading: "b", steps: ["y"], outcome: "p" },
      bottom: "line",
    }, dark),
    `fill="${dark.onPrimary}"`,
  );
  assertStringIncludes(sectionSlide("S"), NEUTRAL_DEFAULTS.primary);
});

// --- generated theme --------------------------------------------------------------

Deno.test("composeScss: palette from _brand.yml, then template, shared defaults, shared rules", () => {
  for (const t of TEMPLATE_NAMES) {
    const pal = brandPalette(templateBrand(t));
    const scss = composeScss(t, pal);
    const { defaults, rules } = scssSections(scss);
    assertStringIncludes(defaults, `$qd-primary: ${pal.primary};`);
    assertStringIncludes(defaults, "$font-family-sans-serif: $qd-font-body;");
    assertStringIncludes(rules, "--qd-primary: #{$qd-primary};");
    assert(
      defaults.indexOf("$qd-primary:") < defaults.indexOf("$qd-heading:"),
    );
    assertEquals(scss.match(/scss:defaults/g)?.length, 1);
    assertEquals(scss.match(/scss:rules/g)?.length, 1);
  }
  assertStringIncludes(
    composeScss("wur", brandPalette(templateBrand("wur"))),
    "$qd-top-bar: 6px;",
  );
});

Deno.test("templateOutputs: _brand.yml, theme/<name>.scss, theme/deck-base.html next to main", () => {
  assertEquals(Object.keys(templateOutputs("dark", "talk.qmd")), [
    "_brand.yml",
    "theme/dark.scss",
    "theme/deck-base.html",
  ]);
  assertEquals(Object.keys(templateOutputs("dark", "sub/talk.qmd")), [
    "sub/_brand.yml",
    "sub/theme/dark.scss",
    "sub/theme/deck-base.html",
  ]);
  // keepBrand: the deck's own colours drive the theme
  const own = templateFile("wur/_brand.yml").replace(
    'navy: "#12384A"',
    'navy: "#203040"',
  );
  const o = templateOutputs("wur", "talk.qmd", own);
  assertEquals(o["_brand.yml"], own);
  assertStringIncludes(o["theme/wur.scss"], "$qd-primary: #203040;");
});

// --- YAML rewrite -------------------------------------------------------------------

const COURSE = `---
title: "Glycolysis"
subtitle: "BIO101 Metabolism · A. Lecturer"
format:
  revealjs:
    theme: [default, theme/wur-brand.scss]
    logo: assets/wur-logo.png
    width: 1280
    # the course footer
    footer: "BIO101 · A. Lecturer"
    include-in-header: theme/deck-extras.html
    title-slide-attributes:
      data-background-color: "#12384A"
execute:
  echo: false
---

{{< include glyc/_00_open.qmd >}}
`;

Deno.test("applyTemplateKeys: only the template-owned keys change", () => {
  const r = applyTemplateKeys(COURSE, {
    theme: "theme/dark.scss",
    include: "theme/deck-base.html",
    titleBackground: null,
  });
  assertEquals(
    r.text,
    COURSE.replace(
      "[default, theme/wur-brand.scss]",
      "[default, theme/dark.scss]",
    )
      .replace(
        "include-in-header: theme/deck-extras.html",
        "include-in-header: theme/deck-base.html",
      )
      .replace(
        '    title-slide-attributes:\n      data-background-color: "#12384A"\n',
        "",
      ),
  );
  assertEquals(r.dropped, ["theme/deck-extras.html"]);
  assertEquals(r.changes.length, 3);
  assertEquals(currentTemplate(r.text), "dark");
  // back to wur: the title slide colour returns, everything else as before
  const back = applyTemplateKeys(r.text, {
    theme: "theme/wur.scss",
    include: "theme/deck-base.html",
    titleBackground: "#12384A",
  });
  assertEquals(
    back.text,
    COURSE.replace("theme/wur-brand.scss", "theme/wur.scss").replace(
      "theme/deck-extras.html",
      "theme/deck-base.html",
    ),
  );
  // applying the same template twice changes nothing
  const again = applyTemplateKeys(back.text, {
    theme: "theme/wur.scss",
    include: "theme/deck-base.html",
    titleBackground: "#12384A",
  });
  assertEquals([again.text, again.changes], [back.text, []]);
});

Deno.test("applyTemplateKeys: logo and footer only when given; other title attributes kept", () => {
  const text = COURSE.replace(
    '      data-background-color: "#12384A"',
    '      data-background-color: "#12384A"\n      data-background-image: "bg.png"',
  );
  const r = applyTemplateKeys(text, {
    theme: "theme/neutral.scss",
    include: "theme/deck-base.html",
    logo: "assets/logo.png",
    footer: 'Physiology "2026"',
    titleBackground: null,
  });
  const k = currentTemplateKeys(r.text);
  assertEquals(k.logo, "assets/logo.png");
  assertEquals(k.footer, 'Physiology "2026"');
  assertStringIncludes(r.text, "    # the course footer\n    footer:");
  assertStringIncludes(
    r.text,
    '    title-slide-attributes:\n      data-background-image: "bg.png"',
  );
  assert(!r.text.includes("data-background-color"));
});

Deno.test("applyTemplateKeys: keeps other theme entries and includes, block lists and text includes", () => {
  const text = `---
title: T
format:
  revealjs:
    theme:
      - default
      - extra/custom.scss
      - theme/old.scss
    include-in-header:
      - theme/deck-extras.html
      - text: |
          <script src="x.js"></script>
      - theme/tick-anim.html
---
`;
  const r = applyTemplateKeys(text, {
    theme: "theme/contrast.scss",
    include: "theme/deck-base.html",
    titleBackground: null,
  });
  assertStringIncludes(
    r.text,
    "theme: [default, extra/custom.scss, theme/contrast.scss]",
  );
  assertStringIncludes(
    r.text,
    `    include-in-header:
      - text: |
          <script src="x.js"></script>
      - theme/tick-anim.html
      - theme/deck-base.html
---`,
  );
  assertEquals(r.dropped, ["theme/deck-extras.html"]);
});

Deno.test("applyTemplateKeys: format: revealjs scalar and a missing format", () => {
  const a = applyTemplateKeys(
    "---\ntitle: T\nformat: revealjs\n---\n\n## A\n",
    {
      theme: "theme/dark.scss",
      include: "theme/deck-base.html",
      titleBackground: null,
    },
  );
  assertEquals(
    a.text,
    "---\ntitle: T\nformat:\n  revealjs:\n    theme: [default, theme/dark.scss]\n    include-in-header: theme/deck-base.html\n---\n\n## A\n",
  );
  const b = applyTemplateKeys("---\ntitle: T\n---\n", {
    theme: "theme/wur.scss",
    include: "theme/deck-base.html",
    titleBackground: "#12384A",
  });
  assertStringIncludes(
    b.text,
    'format:\n  revealjs:\n    theme: [default, theme/wur.scss]\n    include-in-header: theme/deck-base.html\n    title-slide-attributes:\n      data-background-color: "#12384A"\n---',
  );
  assertThrows(
    () =>
      applyTemplateKeys("---\nformat: html\n---\n", {
        theme: "theme/wur.scss",
        include: "theme/deck-base.html",
        titleBackground: null,
      }),
    Error,
    "not revealjs",
  );
  assertThrows(
    () =>
      applyTemplateKeys("## no front matter\n", {
        theme: "theme/wur.scss",
        include: "theme/deck-base.html",
        titleBackground: null,
      }),
    Error,
    "front matter",
  );
});

// --- new deck and sample deck ---------------------------------------------------------

Deno.test("newDeckQmd: template YAML, matching outcome lists, timed notes; outline is clean", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const files = {
      ...templateOutputs("wur", "talk.qmd"),
      "talk.qmd": newDeckQmd({
        template: "wur",
        title: "Mitochondria",
        footer: "Course · Lecturer",
        logo: "assets/logo.png",
        titleBackground: "#12384A",
      }),
    };
    for (const [f, t] of Object.entries(files)) {
      await Deno.mkdir(`${dir}/${f}`.replace(/\/[^/]*$/, ""), {
        recursive: true,
      });
      await Deno.writeTextFile(`${dir}/${f}`, t);
    }
    const o = outlineDeck(dir, "talk.qmd");
    assertEquals(o.visibleSlides, 2);
    assertEquals(o.outcomes?.match, true);
    assertEquals(o.styleIssues.filter((i) => i.level === "rule"), []);
    assert(
      o.missingIncludes.some((m) => m.includes("assets/logo.png")),
      o.missingIncludes.join(),
    );
    assertEquals(currentTemplate(files["talk.qmd"]), "wur");
    const k = currentTemplateKeys(files["talk.qmd"]);
    assertEquals(k.include, ["theme/deck-base.html"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("sampleDeck: every slide kind, no lint rule broken", async () => {
  for (const t of TEMPLATE_NAMES) {
    const dir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(
        `${dir}/sample.qmd`,
        sampleDeck(t, brandPalette(templateBrand(t))),
      );
      const o = outlineDeck(dir, "sample.qmd");
      assertEquals(o.visibleSlides, 9, t); // + the title slide = 10
      assertEquals(
        o.styleIssues.filter((i) => i.level === "rule").map((i) => i.id),
        [],
        t,
      );
      assertEquals(o.outcomes?.match, true);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  }
});

Deno.test("recolour maps old brand roles to new ones, exact matches only", () => {
  const wur = brandPalette(templateBrand("wur"));
  const dark = brandPalette(templateBrand("dark"));
  const { map } = colourMap(wur, dark);
  assertEquals(map.get(normHex(wur.primary)), normHex(dark.primary));
  const p = wur.primary.toLowerCase();
  const text = [
    "---",
    `title-slide-attributes: {data-background-color: "${p}"}`,
    "---",
    `<rect fill="${p}" stroke="#123456"/>`,
    `[a](#add) &#123; <b style="color:${wur.primary.toUpperCase()}">x</b>`,
  ].join("\n");
  const r = recolourText(text, "m.qmd", map, true);
  const lines = r.text.split("\n");
  assertEquals(lines[1].includes(p), true); // front matter untouched
  assertEquals(
    lines[3],
    `<rect fill="${normHex(dark.primary).toLowerCase()}" stroke="#123456"/>`,
  );
  assertStringIncludes(lines[4], `color:${normHex(dark.primary)}`);
  assertStringIncludes(lines[4], "(#add) &#123;");
  assertEquals(r.changes.map((c) => c.line), [4, 5]);
  assertEquals(r.other, ["#123456"]);
  // same palette: nothing to map
  assertEquals(colourMap(wur, wur).map.size, 0);
  // wur primary is also ink/section/titleSlide: mapped as primary, reported
  const sh = colourMap(wur, dark).shared.find((x) =>
    x.hex === normHex(wur.primary)
  );
  assertEquals(sh?.as, "primary");
});

Deno.test("gitignoreWith adds the snapshot folder once", () => {
  assertEquals(
    gitignoreWith(null),
    ".deck_backups/\n.deck_previews/\n.quarto/\n",
  );
  assertEquals(
    gitignoreWith("*.html"),
    "*.html\n.deck_backups/\n.deck_previews/\n.quarto/\n",
  );
  assertEquals(
    gitignoreWith("/.deck_backups\n.deck_previews/\n.quarto/\n"),
    null,
  );
});

Deno.test("model registers the template methods and resources", () => {
  for (
    const m of [
      "template_list",
      "deck_init",
      "template_apply",
      "template_preview",
    ]
  ) assert(m in model.methods, m);
  for (const r of ["template", "templates", "templatePreview"]) {
    assert(r in model.resources, r);
  }
  assert("templateSheet" in model.files);
});
