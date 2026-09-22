import { describe, expect, it } from "vitest";

import { isTypingElement } from "@/shared/keyboard";

describe("keyboard-guard", () => {
  it("detects input, textarea, and select elements as typing elements", () => {
    expect(isTypingElement({ tagName: "INPUT" })).toBe(true);
    expect(isTypingElement({ tagName: "input" })).toBe(true);
    expect(isTypingElement({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTypingElement({ tagName: "textarea" })).toBe(true);
    expect(isTypingElement({ tagName: "SELECT" })).toBe(true);
    expect(isTypingElement({ tagName: "select" })).toBe(true);
  });

  it("detects contentEditable elements as typing elements", () => {
    expect(isTypingElement({ tagName: "DIV", isContentEditable: true })).toBe(
      true,
    );
  });

  it("does not flag non-typing elements", () => {
    expect(isTypingElement({ tagName: "BODY" })).toBe(false);
    expect(isTypingElement({ tagName: "DIV" })).toBe(false);
    expect(isTypingElement({ tagName: "BUTTON" })).toBe(false);
    expect(isTypingElement(null)).toBe(false);
    expect(isTypingElement(undefined)).toBe(false);
  });
});
