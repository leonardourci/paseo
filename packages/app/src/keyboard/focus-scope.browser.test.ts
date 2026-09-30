import { afterEach, describe, expect, it } from "vitest";
import { resolveKeyboardFocusScope } from "./focus-scope";

afterEach(() => {
  document.body.replaceChildren();
});

function mount(html: string): void {
  document.body.innerHTML = html;
}

function element(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`No ${selector} mounted`);
  return found;
}

function scopeOf(target: EventTarget | null) {
  return resolveKeyboardFocusScope({ target, commandCenterOpen: false });
}

describe("resolveKeyboardFocusScope", () => {
  it("resolves terminal scope from the direct keyboard event target", () => {
    mount('<div class="xterm"><div id="cell">$</div></div>');
    expect(scopeOf(element("#cell"))).toBe("terminal");
  });

  it("falls back to the focused element when the target is not an element", () => {
    mount('<div class="xterm"><textarea id="terminal-input"></textarea></div>');
    element("#terminal-input").focus();
    expect(scopeOf(null)).toBe("terminal");
  });

  it("detects editable scope from the focused element", () => {
    mount('<input id="field" />');
    element("#field").focus();
    expect(scopeOf(null)).toBe("editable");
  });

  it("treats the caret host as no field, and a note inside it as a field", () => {
    mount(`
      <div id="host" contenteditable="true" data-output-caret-host="">
        <div id="row"><p id="text">The parser reads the config.</p>
          <button id="copy" type="button">Copy</button>
          <textarea id="note"></textarea>
        </div>
      </div>`);

    expect(scopeOf(element("#host"))).toBe("other");
    expect(scopeOf(element("#text"))).toBe("other");
    expect(scopeOf(element("#copy"))).toBe("other");
    expect(scopeOf(element("#note"))).toBe("editable");
  });

  it("takes a contenteditable outside the output for a field", () => {
    mount('<div id="editor" contenteditable="true">draft</div>');
    expect(scopeOf(element("#editor"))).toBe("editable");
  });
});
