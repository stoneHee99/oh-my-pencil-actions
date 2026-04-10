/**
 * pencil-preview 메인 스크립트
 *
 * Usage:
 *   node dist/main.js <base.pen> <head.pen> [--output-dir screenshots]
 *
 * GitHub Actions에서:
 *   base branch의 .pen과 PR branch의 .pen을 비교하여
 *   변경된 노드의 before/after 스크린샷을 생성하고
 *   마크다운 리포트를 출력한다
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { join, basename } from "path";
import { penToHtml } from "./pen-to-html.js";
import { diffPen, getChangedNodeIds, getScreenshotTargets, getTopLevelNodes, type DiffResult } from "./pen-diff.js";
import { screenshotNodes } from "./render.js";
import type { PenDocument } from "./pen-to-html.js";

async function loadPen(path: string): Promise<PenDocument> {
  const raw = await readFile(path, "utf-8");
  return JSON.parse(raw) as PenDocument;
}

function buildNodeIndex(doc: PenDocument): Map<string, import("./pen-to-html.js").PenNode> {
  const map = new Map<string, import("./pen-to-html.js").PenNode>();
  function walk(node: import("./pen-to-html.js").PenNode) {
    map.set(node.id, node);
    for (const child of node.children ?? []) walk(child);
  }
  for (const child of doc.children) walk(child);
  return map;
}

type PenNode = import("./pen-to-html.js").PenNode;

/**
 * diff 결과를 마크다운 리포트로 변환
 * - 최상위 노드 전체 before/after (전체 맥락)
 * - 변경된 개별 노드 before/after (세부 변경)
 */
function generateMarkdown(
  diff: DiffResult,
  penFilename: string,
  screenshots: Map<string, string>, // "before-{id}" or "after-{id}" → path
  topLevelIds: Set<string>,
  targetIds: Set<string>,
  baseIndex: Map<string, PenNode>,
  headIndex: Map<string, PenNode>
): string {
  const lines: string[] = [];
  lines.push(`## 🎨 Design Changes: \`${penFilename}\``);
  lines.push("");

  if (diff.added.length === 0 && diff.removed.length === 0 && diff.modified.length === 0) {
    lines.push("No visual changes detected.");
    return lines.join("\n");
  }

  // Summary
  const counts: string[] = [];
  if (diff.added.length) counts.push(`**${diff.added.length}** added`);
  if (diff.removed.length) counts.push(`**${diff.removed.length}** removed`);
  if (diff.modified.length) counts.push(`**${diff.modified.length}** modified`);
  lines.push(`> ${counts.join(" · ")} nodes`);
  lines.push("");

  // 1. Top-level node overview
  for (const topId of topLevelIds) {
    const node = headIndex.get(topId) ?? baseIndex.get(topId);
    const name = node?.name ?? topId;
    lines.push(`### 📄 \`${name}\` (Overview)`);
    lines.push("");

    const beforeImg = screenshots.get(`before-${topId}`);
    const afterImg = screenshots.get(`after-${topId}`);

    if (beforeImg && afterImg) {
      lines.push("| Before | After |");
      lines.push("|--------|-------|");
      lines.push(`| ![before](${beforeImg}) | ![after](${afterImg}) |`);
    } else if (afterImg) {
      lines.push(`![${name}](${afterImg})`);
    } else if (beforeImg) {
      lines.push(`![${name}](${beforeImg})`);
    }
    lines.push("");
  }

  // 2. Individual changed nodes
  lines.push("### 🔍 Changed Nodes");
  lines.push("");

  for (const targetId of targetIds) {
    // Skip if this is also a top-level node (already shown above)
    if (topLevelIds.has(targetId)) continue;

    const node = headIndex.get(targetId) ?? baseIndex.get(targetId);
    const name = node?.name ?? targetId;

    // Find related modifications
    const relatedMods = diff.modified.filter((m) =>
      m.id === targetId || isDescendant(m.id, targetId, headIndex)
    );
    const relatedAdded = diff.added.filter((n) => n.id === targetId);
    const relatedRemoved = diff.removed.filter((n) => n.id === targetId);

    // Determine badge
    let badge = "✏️";
    if (relatedAdded.length) badge = "✅";
    else if (relatedRemoved.length) badge = "❌";

    lines.push(`#### ${badge} \`${name}\``);

    // Changed properties
    if (relatedMods.length) {
      const propsList = relatedMods
        .map((m) => `**${m.name}**: ${m.changes.join(", ")}`)
        .join(" · ");
      lines.push(`> ${propsList}`);
    }
    lines.push("");

    const beforeImg = screenshots.get(`before-${targetId}`);
    const afterImg = screenshots.get(`after-${targetId}`);

    if (beforeImg && afterImg) {
      lines.push("| Before | After |");
      lines.push("|--------|-------|");
      lines.push(`| ![before](${beforeImg}) | ![after](${afterImg}) |`);
    } else if (afterImg) {
      lines.push(`![${name}](${afterImg})`);
    } else if (beforeImg) {
      lines.push(`![${name}](${beforeImg})`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function isDescendant(
  nodeId: string,
  ancestorId: string,
  index: Map<string, PenNode>
): boolean {
  const ancestor = index.get(ancestorId);
  if (!ancestor) return false;
  function walk(node: PenNode): boolean {
    for (const child of node.children ?? []) {
      if (child.id === nodeId) return true;
      if (walk(child)) return true;
    }
    return false;
  }
  return walk(ancestor);
}

// ── CLI Entry Point ──

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error("Usage: pencil-preview <base.pen> <head.pen> [--output-dir dir]");
    process.exit(1);
  }

  const basePath = args[0];
  const headPath = args[1];
  const outputDirIdx = args.indexOf("--output-dir");
  const outputDir = outputDirIdx >= 0 ? args[outputDirIdx + 1] : "screenshots";

  console.log(`Comparing: ${basePath} → ${headPath}`);

  // 1. Load documents
  const basePen = await loadPen(basePath);
  const headPen = await loadPen(headPath);

  // 2. Diff
  const diff = diffPen(basePen, headPen);
  console.log(
    `Found: ${diff.added.length} added, ${diff.removed.length} removed, ${diff.modified.length} modified`
  );

  const headIndex = buildNodeIndex(headPen);
  const baseIndex = buildNodeIndex(basePen);

  if (diff.added.length === 0 && diff.removed.length === 0 && diff.modified.length === 0) {
    console.log("No changes detected.");
    const markdown = generateMarkdown(diff, basename(headPath), new Map(), new Set(), new Set(), baseIndex, headIndex);
    await mkdir(outputDir, { recursive: true });
    await writeFile(join(outputDir, "report.md"), markdown);
    return;
  }

  // 3. Determine what to screenshot
  const changedIds = getChangedNodeIds(diff);

  // 최상위 노드 (전체 맥락용)
  const topLevelIds = getTopLevelNodes(changedIds, headPen);
  // removed 노드의 최상위도 포함
  const removedTopLevel = getTopLevelNodes(diff.removed.map((n) => n.id), basePen);
  for (const id of removedTopLevel) topLevelIds.add(id);

  // 개별 변경 노드 (세부 비교용)
  const targetIds = getScreenshotTargets(changedIds, headPen, headIndex);
  const removedTargets = getScreenshotTargets(diff.removed.map((n) => n.id), basePen, baseIndex);
  for (const id of removedTargets) targetIds.add(id);

  // 스크린샷할 전체 ID 목록 (최상위 + 개별)
  const allIds = new Set([...topLevelIds, ...targetIds]);
  console.log(`Rendering: ${topLevelIds.size} top-level + ${targetIds.size} changed nodes`);

  // 4. Render & screenshot
  await mkdir(outputDir, { recursive: true });

  const baseHtml = penToHtml(basePen);
  const headHtml = penToHtml(headPen);

  const baseIds = [...allIds].filter((id) => baseIndex.has(id));
  const headIds = [...allIds].filter((id) => headIndex.has(id));

  const [beforeShots, afterShots] = await Promise.all([
    screenshotNodes(baseHtml, baseIds, outputDir, "before"),
    screenshotNodes(headHtml, headIds, outputDir, "after"),
  ]);

  // Unified screenshot map: "before-{id}" or "after-{id}" → path
  const screenshots = new Map<string, string>();
  for (const s of beforeShots) screenshots.set(`before-${s.nodeId}`, s.path);
  for (const s of afterShots) screenshots.set(`after-${s.nodeId}`, s.path);

  // 5. Generate report
  const markdown = generateMarkdown(
    diff,
    basename(headPath),
    screenshots,
    topLevelIds,
    targetIds,
    baseIndex,
    headIndex
  );

  const reportPath = join(outputDir, "report.md");
  await writeFile(reportPath, markdown);
  console.log(`Report saved: ${reportPath}`);

  // Also write to stdout for GitHub Actions
  console.log("\n--- REPORT ---\n");
  console.log(markdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
