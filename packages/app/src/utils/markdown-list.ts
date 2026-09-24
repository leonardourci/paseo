import { SPACING } from "@/styles/theme";

interface MarkdownNode {
  type?: string;
  index?: number;
  markup?: string;
  attributes?: {
    start?: number | string;
  };
  children?: MarkdownNode[];
}

const LIST_BULLET = "•";
const DEFAULT_ORDERED_LIST_MARKUP = ".";
const MARKDOWN_LIST_MARGIN_TOP = SPACING[1];
const MARKDOWN_LIST_MARGIN_BOTTOM_TO_PROSE = SPACING[4];
const MARKDOWN_LIST_MARGIN_BOTTOM_TO_LIST = SPACING[2];
const MARKDOWN_NESTED_LIST_MARGIN_BOTTOM = 0;
const MARKDOWN_TERMINAL_LIST_MARGIN_BOTTOM = 0;

function toParentNodes(parent: unknown): MarkdownNode[] {
  if (Array.isArray(parent)) {
    return parent;
  }

  if (parent && typeof parent === "object") {
    return [parent as MarkdownNode];
  }

  return [];
}

function getNearestListParent(parent: unknown): MarkdownNode | undefined {
  return toParentNodes(parent).find(
    (ancestor) => ancestor?.type === "ordered_list" || ancestor?.type === "bullet_list",
  );
}

function getOrderedListItemIndex(node: MarkdownNode, listParent: MarkdownNode): number {
  if (typeof node.index === "number" && Number.isFinite(node.index) && node.index >= 0) {
    return node.index;
  }

  if (Array.isArray(listParent.children)) {
    const fallbackIndex = listParent.children.indexOf(node);
    if (fallbackIndex >= 0) {
      return fallbackIndex;
    }
  }

  return 0;
}

function parseOrderedListStart(node: MarkdownNode): number {
  const rawStart = node.attributes?.start;
  if (typeof rawStart === "number" && Number.isFinite(rawStart)) {
    return rawStart;
  }

  if (typeof rawStart === "string") {
    const parsed = Number.parseInt(rawStart, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 1;
}

export function getMarkdownNextSiblingType(
  node: MarkdownNode,
  parent: unknown,
): string | undefined {
  const ancestors = toParentNodes(parent);
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const ancestor = ancestors[i];
    if (!Array.isArray(ancestor?.children)) continue;
    const idx = ancestor.children.indexOf(node);
    if (idx >= 0) {
      return ancestor.children[idx + 1]?.type;
    }
  }
  return undefined;
}

function isListType(type: string | undefined): boolean {
  return type === "bullet_list" || type === "ordered_list";
}

/** The items at one level: those of every list directly in the container, in order. */
function itemsIn(container: MarkdownNode): MarkdownNode[] {
  return (container.children ?? [])
    .filter((child) => isListType(child.type))
    .flatMap((list) => list.children ?? []);
}

/**
 * The list item's index path in its block: [2, 0] is the first item nested in the third. Each
 * level counts on across sibling lists. Null inside a blockquote, where what follows an item
 * would land inside the quote.
 */
export function getMarkdownListItemPath(node: MarkdownNode, parent: unknown): number[] | null {
  const ancestors = toParentNodes(parent);
  const path: number[] = [];
  let item = node;
  // An item's ancestors alternate: its list, then what holds the list (an item, or the body).
  for (let level = 1; level < ancestors.length; level += 2) {
    const container = ancestors[level];
    if (container.type === "blockquote") return null;
    path.unshift(itemsIn(container).indexOf(item));
    if (container.type !== "list_item") break;
    item = container;
  }
  return path;
}

function hasListItemAncestor(parent: unknown): boolean {
  return toParentNodes(parent).some((ancestor) => ancestor?.type === "list_item");
}

export function getMarkdownListSpacing(
  node: MarkdownNode,
  parent: unknown,
): { marginTop: number; marginBottom: number } {
  if (hasListItemAncestor(parent)) {
    return {
      marginTop: MARKDOWN_LIST_MARGIN_TOP,
      marginBottom: MARKDOWN_NESTED_LIST_MARGIN_BOTTOM,
    };
  }

  const nextType = getMarkdownNextSiblingType(node, parent);
  if (!nextType) {
    return {
      marginTop: MARKDOWN_LIST_MARGIN_TOP,
      marginBottom: MARKDOWN_TERMINAL_LIST_MARGIN_BOTTOM,
    };
  }

  return {
    marginTop: MARKDOWN_LIST_MARGIN_TOP,
    marginBottom: isListType(nextType)
      ? MARKDOWN_LIST_MARGIN_BOTTOM_TO_LIST
      : MARKDOWN_LIST_MARGIN_BOTTOM_TO_PROSE,
  };
}

export function getMarkdownListMarker(
  node: MarkdownNode,
  parent: unknown,
): {
  isOrdered: boolean;
  marker: string;
} {
  const listParent = getNearestListParent(parent);
  if (!listParent || listParent.type !== "ordered_list") {
    return {
      isOrdered: false,
      marker: LIST_BULLET,
    };
  }

  const orderedIndex = getOrderedListItemIndex(node, listParent);
  const orderedStart = parseOrderedListStart(listParent);
  const orderedMarkup =
    typeof node.markup === "string" && node.markup.length > 0
      ? node.markup
      : DEFAULT_ORDERED_LIST_MARKUP;

  return {
    isOrdered: true,
    marker: `${orderedStart + orderedIndex}${orderedMarkup}`,
  };
}
