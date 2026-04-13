/**
 * .pen → HTML/CSS 변환기
 * open-pencil의 렌더링 파이프라인을 경량 HTML/CSS로 재구현
 */

// ── Types ──

export interface PenDocument {
  version: string;
  children: PenNode[];
  variables?: Record<string, PenVariable>;
  themes?: Record<string, string[]>;
}

export interface PenNode {
  type: string;
  id: string;
  name?: string;
  x?: number;
  y?: number;
  width?: number | string;
  height?: number | string;
  rotation?: number;
  flipX?: boolean;
  flipY?: boolean;
  fill?: string | PenFill;
  stroke?: PenStroke;
  effect?: PenEffect | PenEffect[];
  opacity?: number;
  enabled?: boolean;
  clip?: boolean;
  cornerRadius?: number | number[];
  layout?: string;
  gap?: number;
  padding?: number | number[];
  justifyContent?: string;
  alignItems?: string;
  content?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string | number;
  lineHeight?: number;
  letterSpacing?: number;
  textAlign?: string;
  textAlignVertical?: string;
  textGrowth?: string;
  children?: PenNode[];
  reusable?: boolean;
  ref?: string;
  descendants?: Record<string, Partial<PenNode>>;
  // Icon font
  iconFontName?: string;
  iconFontFamily?: string;
}

export interface PenVariable {
  type: string;
  value: string | number | PenVariableValue[];
}

interface PenVariableValue {
  value: string | number;
  theme?: Record<string, string>;
}

interface PenFill {
  type?: string;
  enabled?: boolean;
  url?: string;
  mode?: string;
  color?: string;
  stops?: Array<{ color: string; position: number }>;
  angle?: number;
}

interface PenStroke {
  align?: string;
  thickness?: number | Record<string, number>;
  fill?: string;
  join?: string;
  cap?: string;
}

interface PenEffect {
  type: string;
  shadowType?: string;
  color?: string;
  offset?: { x: number; y: number };
  blur?: number;
  spread?: number;
}

// ── Variable Resolution ──

function resolveVariable(ref: string, variables: Record<string, PenVariable>): string | undefined {
  // "$--accent" → look up "--accent"
  const varName = ref.startsWith("$") ? ref.slice(1) : ref;
  const v = variables[varName];
  if (!v) return undefined;

  if (typeof v.value === "string" || typeof v.value === "number") {
    return String(v.value);
  }
  // Array of themed values - use first (default)
  if (Array.isArray(v.value) && v.value.length > 0) {
    return String(v.value[0].value);
  }
  return undefined;
}

function resolveColor(
  fill: string | PenFill | undefined,
  variables: Record<string, PenVariable>
): string | undefined {
  if (!fill) return undefined;

  if (typeof fill === "string") {
    if (fill.startsWith("$")) {
      return resolveVariable(fill, variables);
    }
    return fill;
  }

  // Object fill
  if (fill.type === "image") return undefined;

  if (fill.type === "gradient" && fill.stops) {
    const angle = fill.angle ?? 180;
    const stops = fill.stops
      .map((s) => {
        const c = s.color.startsWith("$") ? resolveVariable(s.color, variables) ?? s.color : s.color;
        return `${c} ${Math.round(s.position * 100)}%`;
      })
      .join(", ");
    return `linear-gradient(${angle}deg, ${stops})`;
  }

  if (fill.color) {
    return fill.color.startsWith("$") ? resolveVariable(fill.color, variables) ?? fill.color : fill.color;
  }

  return undefined;
}

// ── CSS Generation ──

type ParentDir = "row" | "column" | "none";

function getNodeDirection(node: PenNode): ParentDir {
  if (node.layout === "vertical" || node.layout === "column") return "column";
  if (node.layout === "horizontal" || node.layout === "row") return "row";
  // implicit layout detection
  if (node.type === "frame" && (!node.layout || node.layout === "none")) {
    const childrenUsesFill = (node.children ?? []).some(
      (c) => c.width === "fill_container" || c.height === "fill_container"
    );
    if (node.gap !== undefined || node.alignItems !== undefined ||
        node.justifyContent !== undefined || childrenUsesFill ||
        (node.padding !== undefined && (node.children ?? []).length > 0)) {
      return "row"; // implicit horizontal
    }
  }
  return "none";
}

function buildStyle(node: PenNode, variables: Record<string, PenVariable>, isRoot: boolean, parentDir: ParentDir = "none"): string {
  const s: string[] = [];

  // Position: children in non-layout parents use absolute positioning
  if (parentDir === "none" && (node.x !== undefined || node.y !== undefined)) {
    s.push("position: absolute");
    if (node.x !== undefined) s.push(`left: ${node.x}px`);
    if (node.y !== undefined) s.push(`top: ${node.y}px`);
  }

  // Size
  const w = node.width;
  const h = node.height;
  if (w === "fill_container") {
    if (parentDir === "row") {
      // horizontal 부모에서 너비 균등 분할
      s.push("flex: 1", "min-width: 0");
    } else {
      // vertical 부모 또는 none → 전체 너비
      s.push("width: 100%", "min-width: 0");
    }
  } else if (w === "hug_content") {
    // auto
  } else if (typeof w === "number") {
    s.push(`width: ${w}px`);
  } else if (typeof w === "string" && w.startsWith("$")) {
    const resolved = resolveVariable(w, variables);
    if (resolved) s.push(`width: ${resolved}px`);
  }

  if (h === "fill_container") {
    if (parentDir === "column") {
      s.push("flex: 1", "min-height: 0");
    } else {
      s.push("height: 100%", "min-height: 0");
    }
  } else if (h === "hug_content") {
    // auto
  } else if (typeof h === "number") {
    s.push(`height: ${h}px`, "flex-shrink: 0");
  }

  // Layout (flex) - getNodeDirection으로 통합 판단
  const dir = getNodeDirection(node);
  if (dir !== "none") {
    s.push("display: flex");
    s.push(`flex-direction: ${dir}`);
  } else if ((node.type === "frame" || node.type === "ellipse") && (node.children ?? []).length > 0) {
    // Non-layout container with children → position: relative for absolute children
    s.push("position: relative");
  }

  if (node.gap !== undefined) s.push(`gap: ${node.gap}px`);

  // Justify content
  if (node.justifyContent) {
    const jcMap: Record<string, string> = {
      center: "center",
      end: "flex-end",
      "space-between": "space-between",
      "space_between": "space-between",
      "space-around": "space-around",
      "space_around": "space-around",
    };
    s.push(`justify-content: ${jcMap[node.justifyContent] ?? node.justifyContent}`);
  }

  // Align items
  if (node.alignItems) {
    const aiMap: Record<string, string> = {
      center: "center",
      end: "flex-end",
      start: "flex-start",
      stretch: "stretch",
      baseline: "baseline",
    };
    s.push(`align-items: ${aiMap[node.alignItems] ?? node.alignItems}`);
  }

  // Padding
  if (node.padding !== undefined) {
    if (typeof node.padding === "number") {
      s.push(`padding: ${node.padding}px`);
    } else if (Array.isArray(node.padding)) {
      if (node.padding.length === 2) {
        s.push(`padding: ${node.padding[0]}px ${node.padding[1]}px`);
      } else if (node.padding.length === 4) {
        s.push(`padding: ${node.padding[0]}px ${node.padding[1]}px ${node.padding[2]}px ${node.padding[3]}px`);
      }
    }
  }

  // Fill → background
  const bg = resolveColor(node.fill, variables);
  if (bg) {
    if (bg.startsWith("linear-gradient")) {
      s.push(`background: ${bg}`);
    } else {
      s.push(`background-color: ${bg}`);
    }
  }

  // Image fill
  if (typeof node.fill === "object" && node.fill?.type === "image" && node.fill.url) {
    s.push(
      `background-image: url('${node.fill.url}')`,
      "background-size: cover",
      "background-position: center"
    );
  }

  // Corner radius
  if (node.cornerRadius !== undefined) {
    if (typeof node.cornerRadius === "number") {
      s.push(`border-radius: ${node.cornerRadius}px`);
    } else if (Array.isArray(node.cornerRadius)) {
      s.push(`border-radius: ${node.cornerRadius.map((r) => `${r}px`).join(" ")}`);
    }
  }

  // Stroke → border
  if (node.stroke) {
    const strokeColor = resolveColor(node.stroke.fill, variables) ?? "#000";
    const th = node.stroke.thickness;

    if (typeof th === "number") {
      s.push(`border: ${th}px solid ${strokeColor}`);
    } else if (typeof th === "object") {
      if (th.top) s.push(`border-top: ${th.top}px solid ${strokeColor}`);
      if (th.right) s.push(`border-right: ${th.right}px solid ${strokeColor}`);
      if (th.bottom) s.push(`border-bottom: ${th.bottom}px solid ${strokeColor}`);
      if (th.left) s.push(`border-left: ${th.left}px solid ${strokeColor}`);
    }
  }

  // Effects → box-shadow
  const effects = node.effect
    ? Array.isArray(node.effect) ? node.effect : [node.effect]
    : [];
  const shadows = effects
    .filter((e) => e.type === "shadow")
    .map((e) => {
      const color = e.color ?? "rgba(0,0,0,0.1)";
      const ox = e.offset?.x ?? 0;
      const oy = e.offset?.y ?? 0;
      const blur = e.blur ?? 0;
      const spread = e.spread ?? 0;
      const inset = e.shadowType === "inner" ? "inset " : "";
      return `${inset}${ox}px ${oy}px ${blur}px ${spread}px ${color}`;
    });
  if (shadows.length) s.push(`box-shadow: ${shadows.join(", ")}`);

  // Opacity
  if (node.opacity !== undefined && node.opacity < 1) {
    s.push(`opacity: ${node.opacity}`);
  }

  // Rotation / flip
  const transforms: string[] = [];
  if (node.rotation) transforms.push(`rotate(${node.rotation}deg)`);
  if (node.flipX) transforms.push("scaleX(-1)");
  if (node.flipY) transforms.push("scaleY(-1)");
  if (transforms.length) s.push(`transform: ${transforms.join(" ")}`);

  // Clip
  if (node.clip) s.push("overflow: hidden");

  // Visibility
  if (node.enabled === false) s.push("display: none");

  // Text properties
  if (node.type === "text") {
    if (node.fontSize) s.push(`font-size: ${node.fontSize}px`);
    // Fallback chain matching open-pencil: primary → Inter → Arabic → CJK → sans-serif
    if (node.fontFamily) s.push(`font-family: '${node.fontFamily}', 'Inter', 'Noto Naskh Arabic', 'Noto Sans KR', 'Noto Sans SC', 'Noto Sans JP', sans-serif`);
    if (node.fontWeight) s.push(`font-weight: ${node.fontWeight}`);
    if (node.lineHeight) {
      // open-pencil: lineHeight < 5 is a multiplier, otherwise absolute px
      if (node.lineHeight < 5) {
        s.push(`line-height: ${node.lineHeight}`);
      } else {
        s.push(`line-height: ${node.lineHeight}px`);
      }
    } else {
      s.push("line-height: 1.4");
    }
    if (node.letterSpacing) s.push(`letter-spacing: ${node.letterSpacing}px`);
    if (node.textAlign) s.push(`text-align: ${node.textAlign}`);
    // Text wrapping
    const hasNewlines = (node.content ?? "").includes("\n");
    if (node.textGrowth === "fixed-width" || node.width === "fill_container") {
      s.push("flex: 1", "min-width: 0", hasNewlines ? "white-space: pre-wrap" : "white-space: normal");
    } else if (hasNewlines) {
      s.push("white-space: pre-wrap");
    } else {
      s.push("white-space: nowrap");
    }

    // Text color from fill
    const textColor = resolveColor(node.fill, variables);
    if (textColor) {
      // Override background, use color instead
      const bgIdx = s.findIndex((x) => x.startsWith("background-color:"));
      if (bgIdx >= 0) s.splice(bgIdx, 1);
      s.push(`color: ${textColor}`);
    }
  }

  // Icon font — apply fill as color
  if (node.type === "icon_font") {
    const iconColor = resolveColor(node.fill, variables);
    if (iconColor) {
      const bgIdx = s.findIndex((x) => x.startsWith("background-color:"));
      if (bgIdx >= 0) s.splice(bgIdx, 1);
      s.push(`color: ${iconColor}`);
    }
  }

  return s.join("; ");
}

// ── HTML Generation ──

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderNode(node: PenNode, variables: Record<string, PenVariable>, isRoot: boolean, parentDir: ParentDir = "none"): string {
  if (node.enabled === false) return "";

  const style = buildStyle(node, variables, isRoot, parentDir);
  const dataAttrs = `data-pen-id="${node.id}" data-pen-name="${escapeHtml(node.name ?? "")}"`;

  if (node.type === "text") {
    const content = escapeHtml(node.content ?? "");
    return `<span ${dataAttrs} style="${style}">${content}</span>`;
  }

  // Icon font → render based on icon font family
  if (node.type === "icon_font" && node.iconFontName) {
    const family = node.iconFontFamily ?? "";

    // Material Symbols (Rounded, Outlined, Sharp)
    if (family.startsWith("Material Symbols")) {
      const cssClass = family.toLowerCase().replace(/\s+/g, "-");
      return `<span ${dataAttrs} class="${cssClass}" style="${style}">${node.iconFontName}</span>`;
    }

    // Material Icons (legacy)
    if (family === "material" || family === "material-icons" || family === "Material Icons") {
      return `<span ${dataAttrs} class="material-icons" style="${style}">${node.iconFontName}</span>`;
    }

    // Lucide icons (SVG via data-lucide attribute)
    if (family === "lucide") {
      return `<i ${dataAttrs} data-lucide="${node.iconFontName}" style="${style}"></i>`;
    }

    // All other icon sets → Iconify (supports mdi, heroicons, tabler, solar, mingcute, ri, etc.)
    return `<span ${dataAttrs} class="iconify" data-icon="${family}:${node.iconFontName}" style="${style}"></span>`;
  }

  // Ellipse → div with border-radius: 50%
  if (node.type === "ellipse") {
    const ellipseStyle = style + (style ? "; " : "") + "border-radius: 50%";
    const childrenHtml = (node.children ?? [])
      .map((child) => renderNode(child, variables, false, "none"))
      .join("\n");
    return `<div ${dataAttrs} style="${ellipseStyle}">${childrenHtml}</div>`;
  }

  // Rectangle → div (same as frame but without layout)
  if (node.type === "rectangle") {
    return `<div ${dataAttrs} style="${style}"></div>`;
  }

  // 이 노드의 layout 방향 → 자식에게 전달
  const myDir = getNodeDirection(node);
  const childrenHtml = (node.children ?? [])
    .map((child) => renderNode(child, variables, false, myDir))
    .join("\n");

  return `<div ${dataAttrs} style="${style}">${childrenHtml}</div>`;
}

// ── Main Export ──

export function penToHtml(doc: PenDocument, options?: { highlightIds?: Set<string> }): string {
  const variables = doc.variables ?? {};
  const highlightIds = options?.highlightIds;

  // Build highlight CSS if needed
  const highlightCss = highlightIds
    ? `
    <style>
      [data-pen-id] { position: relative; }
      ${[...highlightIds]
        .map(
          (id) => `[data-pen-id="${id}"]::after {
        content: "";
        position: absolute;
        inset: -2px;
        border: 2px solid #FF3B30;
        border-radius: inherit;
        pointer-events: none;
        z-index: 9999;
      }`
        )
        .join("\n")}
    </style>`
    : "";

  // Render each top-level child
  const bodyHtml = doc.children
    .map((child) => renderNode(child, variables, true))
    .join("\n");

  // Collect all font families and icon font families
  const fonts = new Set<string>();
  const iconFontFamilies = new Set<string>();
  function collectFonts(node: PenNode) {
    if (node.fontFamily) fonts.add(node.fontFamily);
    if (node.iconFontFamily) iconFontFamilies.add(node.iconFontFamily);
    for (const child of node.children ?? []) collectFonts(child);
  }
  doc.children.forEach(collectFonts);

  // Fonts that are NOT on Google Fonts — load from alternative CDNs
  const CUSTOM_FONT_CDN: Record<string, string> = {
    "Geist": "https://cdn.jsdelivr.net/npm/geist@1.3.1/dist/fonts/geist-sans/style.css",
    "Geist Mono": "https://cdn.jsdelivr.net/npm/geist@1.3.1/dist/fonts/geist-mono/style.css",
    "Geist Sans": "https://cdn.jsdelivr.net/npm/geist@1.3.1/dist/fonts/geist-sans/style.css",
    "Pretendard": "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css",
    "Pretendard Variable": "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css",
  };

  const customFontLinks: string[] = [];
  const googleFontsList: string[] = [];

  // Always load fallback fonts (matching open-pencil's fallback chain)
  // Arabic
  googleFontsList.push("Noto Naskh Arabic");
  // CJK (Korean, Chinese, Japanese)
  googleFontsList.push("Noto Sans KR");
  googleFontsList.push("Noto Sans SC");
  googleFontsList.push("Noto Sans JP");

  for (const f of fonts) {
    if (CUSTOM_FONT_CDN[f]) {
      customFontLinks.push(`<link href="${CUSTOM_FONT_CDN[f]}" rel="stylesheet">`);
    } else {
      googleFontsList.push(f);
    }
  }

  // Build Google Fonts URL (only for fonts not handled by custom CDN)
  const googleFontFamilies = googleFontsList
    .map((f) => `family=${encodeURIComponent(f)}:wght@100;200;300;400;500;600;700;800;900`)
    .join("&");
  const googleFontsLink = googleFontsList.length > 0
    ? `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?${googleFontFamilies}&display=swap" rel="stylesheet">`
    : "";

  // Calculate total page dimensions from top-level children
  let pageWidth = 0;
  let pageHeight = 0;
  for (const child of doc.children) {
    const cx = (child.x ?? 0);
    const cw = typeof child.width === "number" ? child.width : 0;
    const cy = (child.y ?? 0);
    const ch = typeof child.height === "number" ? child.height : 0;
    pageWidth = Math.max(pageWidth, cx + cw);
    pageHeight = Math.max(pageHeight, cy + ch);
  }

  // Icon font libraries (head links)
  const iconHeadLinks: string[] = [];
  // Icon scripts (placed at end of body for immediate execution)
  const iconBodyScripts: string[] = [];

  // Material Symbols variants (Google Fonts)
  const materialSymbolsVariants = ["Rounded", "Outlined", "Sharp"];
  for (const variant of materialSymbolsVariants) {
    const key = `Material Symbols ${variant}`;
    const keyLower = key.toLowerCase().replace(/\s+/g, "-");
    if (iconFontFamilies.has(key) || iconFontFamilies.has(keyLower)) {
      const urlFamily = `Material+Symbols+${variant}`;
      iconHeadLinks.push(
        `<link href="https://fonts.googleapis.com/css2?family=${urlFamily}:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200" rel="stylesheet">`
      );
    }
  }

  // Material Icons (legacy)
  if (iconFontFamilies.has("material") || iconFontFamilies.has("material-icons") || iconFontFamilies.has("Material Icons")) {
    iconHeadLinks.push(
      `<link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">`
    );
  }

  // Lucide icons (SVG-based via JS)
  if (iconFontFamilies.has("lucide")) {
    iconBodyScripts.push(
      `<script src="https://unpkg.com/lucide@0.474.0/dist/umd/lucide.min.js"></script>`,
      `<script>lucide.createIcons();</script>`
    );
  }

  // Iconify (universal icon framework — supports mdi, heroicons, tabler, solar, mingcute, ri, etc.)
  const iconifyFamilies = [...iconFontFamilies].filter(f =>
    !f.startsWith("Material") && f !== "material" && f !== "material-icons" && f !== "lucide"
  );
  if (iconifyFamilies.length > 0) {
    iconBodyScripts.push(
      `<script src="https://code.iconify.design/3/3.1.1/iconify.min.js"></script>`
    );
  }

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
${googleFontsLink}
${customFontLinks.join("\n")}
${iconHeadLinks.join("\n")}
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    position: relative;
    background: #E5E5E5;
    width: ${pageWidth + 100}px;
    min-height: ${pageHeight + 100}px;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  [data-lucide] {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .material-symbols-rounded, .material-symbols-outlined, .material-symbols-sharp, .material-icons {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
  }
  .iconify {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
</style>
${highlightCss}
</head>
<body>
${bodyHtml}
${iconBodyScripts.join("\n")}
</body>
</html>`;
}
