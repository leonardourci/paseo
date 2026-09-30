/** Set on the chat's content while the keyboard caret is attached. */
export const OUTPUT_CARET_HOST_ATTRIBUTE = "data-output-caret-host";

/**
 * Whether keys typed at `target` edit text. The caret's host is editable only so the browser draws
 * a caret, so it doesn't count.
 */
export function isEditingSurface(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  return target.isContentEditable && !target.closest(`[${OUTPUT_CARET_HOST_ATTRIBUTE}]`);
}
