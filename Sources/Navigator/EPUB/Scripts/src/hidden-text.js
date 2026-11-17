//
//  Copyright 2026 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

// Rally (RR-9323): hidden text laid out on the lines of the text the page
// shows. Many fixed-layout picture books print their text in the illustration
// and lay the same text over it, invisible (`p { opacity: 0 }`), for search,
// selection and read-aloud. Each printed line ends with a <br>, and the box
// around the text is sized to the printed text. The book rarely says which
// font that was, so WebKit lays the hidden text out in its default font: a
// little wider, a line wraps one word early, and every line below it moves
// down. Read-aloud marks the hidden words, so its highlight and underline land
// one line below the printed word ("Good Night, Escargot", 9780374396695,
// p.4: the underline for "pajama" under "I hope you").
//
// `decorator.js` stops such text from wrapping where the book breaks its lines
// itself, and narrows a line drawn a little wider than its box to fit it (a
// smaller font, the line height kept). These
// decisions are kept free of DOM access so the cases can be tested in Node
// (test/hidden-text.test.js).

/**
 * A line drawn wider than its box by more than this is not a font that came
 * out wider than the book's: the book means the text to wrap there, so it is
 * left as it is.
 */
export const MAX_FONT_OVERFLOW = 1.25;

/**
 * A line this much wider than its box (px) fits it: a box as wide as its text
 * measures a little differently from the text.
 */
export const FIT_TOLERANCE = 1;

/**
 * Whether text with these computed styles draws nothing: it, or an element
 * around it, is fully transparent, or its glyphs are.
 *
 * `opacities` are the computed `opacity` of the text's element and of each
 * element around it; `color` and `textFillColor` are the element's computed
 * `color` and `-webkit-text-fill-color` (both inherited).
 */
export function drawsNoText({ opacities, color, textFillColor }) {
  if (opacities.some((opacity) => parseFloat(opacity) === 0)) {
    return true;
  }
  // `-webkit-text-fill-color` defaults to `currentcolor`, which computes to `color`.
  return isTransparent(textFillColor || color);
}

/** Whether a computed CSS color is fully transparent. */
export function isTransparent(color) {
  if (!color) {
    return false;
  }
  const value = color.trim().toLowerCase();
  if (value === "transparent") {
    return true;
  }
  const match = /^rgba?\(([^)]*)\)$/.exec(value);
  if (!match) {
    return false;
  }
  // "rgba(0, 0, 0, 0)" or "rgb(0 0 0 / 0)".
  const parts = match[1].split(/[\s,/]+/).filter((part) => part.length > 0);
  if (parts.length < 4) {
    return false;
  }
  const alpha = parts[3];
  return parseFloat(alpha) === 0;
}

/**
 * How wide a block's lines are, against the width of its box, as
 * `hiddenLinesLayout` takes them: from the box's start edge to where the
 * lines end (their right in left-to-right text), so text the book sets before
 * the start edge (a negative `text-indent`, 9781338281408 p.37) is not taken
 * for a line too long. A line too long for its box starts at the start edge
 * whatever the alignment, and runs past the end edge.
 *
 * All values are page px: the text's bounds, and the box's content edges.
 */
export function lineExtent({
  textLeft,
  textRight,
  boxLeft,
  boxRight,
  direction,
}) {
  const widest =
    direction === "rtl" ? boxRight - textLeft : textRight - boxLeft;
  return { widest, available: boxRight - boxLeft };
}

/**
 * How to lay out a block of hidden text whose lines the book breaks with <br>,
 * once it is kept from wrapping: `widest` is how far its lines reach from the
 * box's start edge then, `available` the width of its content box (both in
 * page px, see `lineExtent`).
 *
 * Returns `{ nowrap, scale }`: whether to keep it from wrapping, and the
 * scale of its font that fits its widest line in the box (1 when it fits).
 */
export function hiddenLinesLayout({ widest, available }) {
  if (!(widest > 0) || !(available > 0)) {
    return { nowrap: false, scale: 1 };
  }
  if (widest <= available + FIT_TOLERANCE) {
    return { nowrap: true, scale: 1 };
  }
  if (widest > available * MAX_FONT_OVERFLOW) {
    return { nowrap: false, scale: 1 };
  }
  return { nowrap: true, scale: available / widest };
}
