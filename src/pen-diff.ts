/**
 * .pen 파일 diff 엔진
 * 두 .pen 파일을 비교하여 추가/삭제/변경된 노드를 식별
 */

import type { PenDocument, PenNode, PenVariable } from "./pen-to-html.js";

export interface DiffResult {
  added: PenNode[];     // PR에서 새로 추가된 노드
  removed: PenNode[];   // PR에서 삭제된 노드
  modified: ModifiedNode[]; // 변경된 노드
}

export interface ModifiedNode {
  id: string;
  name: string;
  before: PenNode;
  after: PenNode;
  changes: string[];  // 어떤 속성이 변경되었는지
}

// ── Node Indexing ──

function collectNodes(node: PenNode, map: Map<string, PenNode>): void {
  map.set(node.id, node);
  for (const child of node.children ?? []) {
    collectNodes(child, map);
  }
}

function buildNodeIndex(doc: PenDocument): Map<string, PenNode> {
  const map = new Map<string, PenNode>();
  for (const child of doc.children) {
    collectNodes(child, map);
  }
  return map;
}

// ── Property Comparison ──

const VISUAL_PROPS = [
  "fill", "stroke", "effect", "opacity", "cornerRadius",
  "width", "height", "x", "y",
  "content", "fontSize", "fontFamily", "fontWeight", "lineHeight",
  "layout", "gap", "padding", "justifyContent", "alignItems",
  "enabled", "rotation", "flipX", "flipY", "clip",
  "textAlign", "letterSpacing",
  "iconFontName", "iconFontFamily",
] as const;

function serializeProp(value: unknown): string {
  if (value === undefined || value === null) return "";
  return JSON.stringify(value);
}

function compareNode(before: PenNode, after: PenNode): string[] {
  const changes: string[] = [];
  for (const prop of VISUAL_PROPS) {
    const bVal = serializeProp((before as unknown as Record<string, unknown>)[prop]);
    const aVal = serializeProp((after as unknown as Record<string, unknown>)[prop]);
    if (bVal !== aVal) {
      changes.push(prop);
    }
  }

  // Children structure change (added/removed children)
  const bChildIds = new Set((before.children ?? []).map((c) => c.id));
  const aChildIds = new Set((after.children ?? []).map((c) => c.id));
  const addedChildren = [...aChildIds].filter((id) => !bChildIds.has(id));
  const removedChildren = [...bChildIds].filter((id) => !aChildIds.has(id));
  if (addedChildren.length || removedChildren.length) {
    changes.push("children");
  }

  return changes;
}

// ── Parent Map & Node Navigation ──

function buildParentMap(doc: PenDocument): Map<string, string> {
  const parentMap = new Map<string, string>();
  function walk(node: PenNode, parentId?: string) {
    if (parentId) parentMap.set(node.id, parentId);
    for (const child of node.children ?? []) {
      walk(child, node.id);
    }
  }
  for (const child of doc.children) {
    walk(child);
  }
  return parentMap;
}

/**
 * 변경된 노드의 스크린샷 대상을 결정:
 * - frame이면 그 노드 자체
 * - text/기타면 직계 부모 frame
 */
export function getScreenshotTargets(
  nodeIds: string[],
  doc: PenDocument,
  nodeIndex: Map<string, PenNode>
): Set<string> {
  const parentMap = buildParentMap(doc);
  const result = new Set<string>();

  for (const id of nodeIds) {
    const node = nodeIndex.get(id);
    if (!node) continue;

    if (node.type === "frame") {
      // frame은 자기 자신
      result.add(id);
    } else {
      // text 등은 직계 부모 frame
      const parentId = parentMap.get(id);
      if (parentId) {
        result.add(parentId);
      } else {
        result.add(id);
      }
    }
  }

  return result;
}

/**
 * 변경이 포함된 최상위 노드(doc.children 중)를 찾는다.
 * 전체 맥락용 스크린샷에 사용.
 */
export function getTopLevelNodes(
  nodeIds: string[],
  doc: PenDocument
): Set<string> {
  const parentMap = buildParentMap(doc);
  const topLevelIds = new Set(doc.children.map((c) => c.id));
  const result = new Set<string>();

  for (const id of nodeIds) {
    // 부모를 타고 올라가서 최상위 노드를 찾는다
    let current = id;
    while (parentMap.has(current)) {
      current = parentMap.get(current)!;
    }
    // current가 doc.children 중 하나인지 확인
    if (topLevelIds.has(current)) {
      result.add(current);
    }
  }

  return result;
}

// ── Variable Diff ──

/** Properties that can reference variables (start with $) */
const VARIABLE_PROPS = ["fill", "stroke", "width", "height"] as const;

function serializeVariable(v: unknown): string {
  if (v === undefined || v === null) return "";
  return JSON.stringify(v);
}

/**
 * Find variables that changed between base and head documents.
 * Returns a Set of variable names (e.g., "--accent", "bg-primary").
 */
function getChangedVariables(
  baseVars: Record<string, PenVariable> | undefined,
  headVars: Record<string, PenVariable> | undefined
): Set<string> {
  const changed = new Set<string>();
  const bv = baseVars ?? {};
  const hv = headVars ?? {};

  // Check modified and removed variables
  for (const name of Object.keys(bv)) {
    if (serializeVariable(bv[name]) !== serializeVariable(hv[name])) {
      changed.add(name);
    }
  }
  // Check added variables
  for (const name of Object.keys(hv)) {
    if (!(name in bv)) {
      changed.add(name);
    }
  }

  return changed;
}

/**
 * Check if a node references any of the changed variables.
 * Variable references start with "$" (e.g., "$bg-primary", "$--accent").
 */
function nodeReferencesVariables(node: PenNode, changedVars: Set<string>): string[] {
  const affectedProps: string[] = [];

  for (const prop of VARIABLE_PROPS) {
    const value = (node as unknown as Record<string, unknown>)[prop];
    if (typeof value === "string" && value.startsWith("$")) {
      const varName = value.slice(1); // "$bg-primary" → "bg-primary"
      if (changedVars.has(varName)) {
        affectedProps.push(`${prop} (variable)`);
      }
    }
    // Also check nested objects (e.g., stroke.fill)
    if (typeof value === "object" && value !== null) {
      const obj = value as Record<string, unknown>;
      for (const [key, subVal] of Object.entries(obj)) {
        if (typeof subVal === "string" && subVal.startsWith("$")) {
          const varName = subVal.slice(1);
          if (changedVars.has(varName)) {
            affectedProps.push(`${prop}.${key} (variable)`);
          }
        }
      }
    }
  }

  return affectedProps;
}

// ── Main Diff ──

export function diffPen(base: PenDocument, head: PenDocument): DiffResult {
  const baseIndex = buildNodeIndex(base);
  const headIndex = buildNodeIndex(head);

  const added: PenNode[] = [];
  const removed: PenNode[] = [];
  const modified: ModifiedNode[] = [];
  const modifiedIds = new Set<string>();

  // Detect changed variables
  const changedVars = getChangedVariables(base.variables, head.variables);
  if (changedVars.size > 0) {
    console.log(`Changed variables: ${[...changedVars].join(", ")}`);
  }

  // Find added & modified
  for (const [id, headNode] of headIndex) {
    const baseNode = baseIndex.get(id);
    if (!baseNode) {
      added.push(headNode);
      continue;
    }
    const changes = compareNode(baseNode, headNode);
    if (changes.length > 0) {
      modified.push({
        id,
        name: headNode.name ?? id,
        before: baseNode,
        after: headNode,
        changes,
      });
      modifiedIds.add(id);
    }
  }

  // Find nodes affected by variable changes (not already in modified)
  if (changedVars.size > 0) {
    for (const [id, headNode] of headIndex) {
      if (modifiedIds.has(id)) continue;
      const affectedProps = nodeReferencesVariables(headNode, changedVars);
      if (affectedProps.length > 0) {
        const baseNode = baseIndex.get(id);
        modified.push({
          id,
          name: headNode.name ?? id,
          before: baseNode ?? headNode,
          after: headNode,
          changes: affectedProps,
        });
      }
    }
  }

  // Find removed
  for (const [id, baseNode] of baseIndex) {
    if (!headIndex.has(id)) {
      removed.push(baseNode);
    }
  }

  return { added, removed, modified };
}

/**
 * diff 결과에서 렌더링할 의미있는 노드 ID set을 반환
 */
export function getChangedNodeIds(diff: DiffResult): string[] {
  return [
    ...diff.added.map((n) => n.id),
    ...diff.removed.map((n) => n.id),
    ...diff.modified.map((n) => n.id),
  ];
}
