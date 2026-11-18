//
//  Copyright 2026 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

// Rally (RR-9369): where a word in display type is drawn — a giant alphabet-book
// letter, such as the "e" opening each page of DK's "E is for Elephant".
//
// A text range's box spans its font's whole ascent and descent, not the glyph.
// At body size that is a few pixels of slack. At display size it is a band as
// tall as a line of body text: the underline, drawn along the box's bottom,
// floated a body line below the letter, and the box's top was off the page,
// so word help pointed at nothing. A word in display type is measured on its
// ink instead, with a body-text descent of room above and below it.
//
// Ported from the Android fork (RR-9367). The pure rules come first and are
// covered by test/display-type.test.js; `displayTypeRect` applies them to the
// page.

import { rangeBoundingRect, rangeClientRects } from "./rect";

// A word this many times taller than the text beside it is display type: a
// giant letter, not a default `h1`, which is set at twice its body's size.
const DISPLAY_TYPE_SCALE = 2.5;

// A neighbour further than this many text nodes away is not beside the word.
const NEIGHBOUR_LOOKUP_LIMIT = 8;

// Text turned further than this (sin of the angle, about 6°) is lettering, not
// display type: its box is not upright, so fitting it vertically would be wrong.
const UPRIGHT_SINE = 0.1;

/**
 * The height of the text beside a word whose first line is `height` tall, when
 * the word is display type next to it, else null. `neighbourHeights` are asked
 * in turn, and the first neighbour that is not small enough ends the check, so
 * an ordinary word pays for one. A missing neighbour (null, zero) is skipped: a
 * letter that opens its page has text on one side only.
 *
 * @param {number} height
 * @param {(() => number | null)[]} neighbourHeights
 * @returns {number | null}
 */
export function displayTypeBodyHeight(height, neighbourHeights) {
  let bodyHeight = 0;
  for (const measure of neighbourHeights) {
    const neighbourHeight = measure();
    if (!(neighbourHeight > 0)) continue;
    if (height < DISPLAY_TYPE_SCALE * neighbourHeight) return null;
    bodyHeight = Math.max(bodyHeight, neighbourHeight);
  }
  return bodyHeight > 0 ? bodyHeight : null;
}

/**
 * The index in `text` of the nearest non-space character after `offset` when
 * `forward`, else before it, or -1 when there is none.
 *
 * @param {string} text
 * @param {number} offset
 * @param {boolean} forward
 */
export function neighbourCharacterIndex(text, offset, forward) {
  const step = forward ? 1 : -1;
  for (
    let i = forward ? offset : offset - 1;
    i >= 0 && i < text.length;
    i += step
  ) {
    if (/\S/.test(text[i])) return i;
  }
  return -1;
}

/**
 * `text` as CSS `text-transform` `transform` draws it, so its ink is measured
 * on the glyphs shown: a lowercase "e" set in capitals is an "E".
 *
 * @param {string} text
 * @param {string} transform
 */
export function renderedText(text, transform) {
  switch (transform) {
    case "uppercase":
      return text.toUpperCase();
    case "lowercase":
      return text.toLowerCase();
    case "capitalize":
      return text.replace(
        /(^|\s)(\S)/g,
        (_, space, letter) => space + letter.toUpperCase()
      );
    default:
      return text;
  }
}

/**
 * `rect` narrowed to the word's ink, with the descent of this font at
 * `bodyHeight` (the height of the text beside the word) of room above and
 * below it. It never grows past the font's own box.
 *
 * `metrics` are the font's `fontBoundingBox*` and the text's
 * `actualBoundingBox*` from `CanvasRenderingContext2D.measureText`, at the
 * computed font size; the rect may be scaled by a transform, which their ratio
 * to the rect's height undoes. Returns null when the metrics do not describe
 * the rect.
 *
 * @param {{ left: number, top: number, width: number, height: number }} rect
 * @param {{ fontAscent: number, fontDescent: number, inkAscent: number, inkDescent: number }} metrics
 * @param {number} bodyHeight
 */
export function inkFittedRect(rect, metrics, bodyHeight) {
  const em = metrics.fontAscent + metrics.fontDescent;
  const scale = rect.height / em;
  if (!(scale > 0) || !Number.isFinite(scale)) return null;

  const baseline = rect.top + metrics.fontAscent * scale;
  const gap = (bodyHeight * metrics.fontDescent) / em;
  const top = Math.max(rect.top, baseline - metrics.inkAscent * scale - gap);
  const bottom = Math.min(
    rect.top + rect.height,
    baseline + Math.max(metrics.inkDescent, 0) * scale + gap
  );
  if (!(bottom > top)) return null;

  return {
    left: rect.left,
    right: rect.left + rect.width,
    width: rect.width,
    top,
    bottom,
    height: bottom - top,
    x: rect.left,
    y: top,
  };
}

/**
 * Whether the boxes `rects` (each { top, bottom }) all sit on one line: each
 * overlaps the first vertically.
 */
export function isOneLine(rects) {
  if (rects.length === 0) return false;
  const first = rects[0];
  return rects.every(
    (rect) => rect.top < first.bottom && rect.bottom > first.top
  );
}

/**
 * Whether the turn `transform` applies to an element's text (`{ cos, sin }` of
 * its angle on screen) leaves it upright.
 */
export function isUprightTurn({ cos, sin }) {
  return cos > 0 && Math.abs(sin) <= UPRIGHT_SINE;
}

// The page.

function containingElement(node) {
  return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
}

/** The height of the character at `index` in the text `node`, or 0. */
function characterHeight(node, index) {
  const character = document.createRange();
  character.setStart(node, index);
  character.setEnd(node, index + 1);
  for (const rect of character.getClientRects()) {
    if (rect.width > 0 && rect.height > 0) return rect.height;
  }
  return 0;
}

/** The height of the nearest non-space character before or after `range`, or null. */
function neighbourCharacterHeight(range, forward) {
  let node = forward ? range.endContainer : range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return null;
  let offset = forward ? range.endOffset : range.startOffset;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  walker.currentNode = node;
  for (let i = 0; i <= NEIGHBOUR_LOOKUP_LIMIT && node; i++) {
    const index = neighbourCharacterIndex(node.nodeValue, offset, forward);
    if (index !== -1) return characterHeight(node, index);
    node = forward ? walker.nextNode() : walker.previousNode();
    offset = forward ? 0 : node?.nodeValue.length;
  }
  return null;
}

/** The turn CSS transforms give `element`'s text on screen: { cos, sin }. */
function screenTurn(element) {
  let angle = 0;
  for (let node = element; node; node = node.parentElement) {
    const matrix = /^matrix\(([^,]+),([^,]+),/.exec(
      getComputedStyle(node).transform
    );
    if (matrix) {
      angle += Math.atan2(parseFloat(matrix[2]), parseFloat(matrix[1]));
    }
  }
  return { cos: Math.cos(angle), sin: Math.sin(angle) };
}

let textMeasureContext = null;

/**
 * A 2D context to measure text with. The canvas is made in the XHTML namespace:
 * a chapter served as XML (`.xml`, `application/xml`) makes a plain element,
 * with no `getContext`, from `createElement("canvas")`.
 */
function measureContext() {
  if (!textMeasureContext) {
    const canvas = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "canvas"
    );
    textMeasureContext =
      typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
  }
  return textMeasureContext;
}

/** The font and ink metrics of `text` as `element` draws it, or null. */
function measureInk(element, text) {
  const style = getComputedStyle(element);
  if (style.writingMode && style.writingMode !== "horizontal-tb") return null;
  const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  try {
    // A font still loading would be measured on its fallback.
    if (!document.fonts.check(font)) return null;
  } catch (error) {
    return null;
  }
  const context = measureContext();
  if (!context) return null;
  context.font = font;
  context.fontVariantCaps = style.fontVariantCaps;
  const metrics = context.measureText(renderedText(text, style.textTransform));
  return {
    fontAscent: metrics.fontBoundingBoxAscent,
    fontDescent: metrics.fontBoundingBoxDescent,
    inkAscent: metrics.actualBoundingBoxAscent,
    inkDescent: metrics.actualBoundingBoxDescent,
  };
}

/**
 * The rect of a one-line, upright `range` set in display type, fitted to its
 * ink, or null for any other range: body text, OCR overlays (their boxes are
 * the word's already), turned or vertical text, a word over several lines.
 * Null too when anything fails: the word then keeps its font's box, never
 * loses its rect.
 */
export function displayTypeRect(range) {
  try {
    return measuredDisplayTypeRect(range);
  } catch (error) {
    return null;
  }
}

function measuredDisplayTypeRect(range) {
  const text = range.toString().trim();
  if (!text) return null;
  const element = containingElement(range.startContainer);
  if (!element || element.closest(".text-overlay")) return null;

  const lines = rangeClientRects(range).filter(
    (rect) => rect.width > 0 && rect.height > 0
  );
  if (lines.length === 0) return null;

  const bodyHeight = displayTypeBodyHeight(lines[0].height, [
    () => neighbourCharacterHeight(range, false),
    () => neighbourCharacterHeight(range, true),
  ]);
  if (bodyHeight === null) return null;

  if (!isOneLine(lines) || !isUprightTurn(screenTurn(element))) return null;
  const metrics = measureInk(element, text);
  return (
    metrics && inkFittedRect(rangeBoundingRect(range), metrics, bodyHeight)
  );
}

/** Where `range`'s word is on screen: its ink when it is display type, else its bounding rect. */
export function wordRect(range) {
  return displayTypeRect(range) || rangeBoundingRect(range);
}
