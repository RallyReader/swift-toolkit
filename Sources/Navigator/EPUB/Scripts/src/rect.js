//
//  Copyright 2025 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

import { log as logNative } from "./utils";

const debug = false;

/**
 * Converts a DOMRect into a JSON object understandable by the native side.
 */
export function toNativeRect(rect) {
  let point = adjustPointToViewport({ x: rect.left, y: rect.top });

  const width = rect.width;
  const height = rect.height;
  const left = point.x;
  const top = point.y;
  const right = left + width;
  const bottom = top + height;
  return { width, height, left, top, right, bottom };
}

/**
 * Adjusts the given coordinates to the viewport for FXL resources.
 */
export function adjustPointToViewport(point) {
  if (!frameElement) {
    return point;
  }
  let frameRect = frameElement.getBoundingClientRect();
  if (!frameRect) {
    return point;
  }

  let topScrollingElement = window.top.document.documentElement;
  return {
    x: point.x + frameRect.x + topScrollingElement.scrollLeft,
    y: point.y + frameRect.y + topScrollingElement.scrollTop,
  };
}

/**
 * Rally (RR-6363): the client rects of `range`.
 *
 * WebKit before iOS 27 measures a range in text drawn with a `::first-letter`
 * style as a caret 0 wide at the end of its line, for every word of the
 * paragraph ("Dog and Bear: Three to Get Ready", 9781429995566:
 * `.page006 .p1:first-letter { font-size: 40px; }`). Read aloud took such a word
 * for one not on the page and skipped it, and its mark drew nothing. An element
 * measures right, so such a range is measured again on a hidden copy of its
 * element, with its text wrapped in a span, and the rects are moved back onto
 * the element. The page's own DOM, and so every live range (decorations keep
 * theirs), is never changed.
 *
 * Rally (RR-6184): the same WebKit more often measures such a range one letter
 * too far along: every range in the text node that holds the first letter is
 * shifted by the letter's length, and the letter's own box is never reported
 * ("Mindy Kim and the Big Sibling Plan", 9781665935838: `p.ot::first-letter
 * { font-size: 2.4em; line-height: 0em; }`). Read aloud's underline for "My" was
 * drawn under "y " and the start of "name". Such a range is measured on a copy
 * too, of the element styled with `::first-letter` (`firstLetterBlock`).
 *
 * On every WebKit, a word that holds a raised initial (taller than its line, but
 * sitting on it) is drawn on its line: one underline at the line's bottom, not
 * the letter's at its own bottom and the rest's at the line's
 * (`firstLetterOnItsLine`).
 */
export function rangeClientRects(range) {
  const rects = Array.from(range.getClientRects());
  const block = firstLetterBlock(range);
  if (block) {
    const holdsLetter = holdsFirstLetter(range);
    const measured =
      (webKitShiftsFirstLetterText() &&
        measuredOnCopy(
          range,
          block,
          holdsLetter ? floatedFirstLetterStyle(block) : null
        )) ||
      rects;
    return holdsLetter ? firstLetterOnItsLine(measured, range) : measured;
  }
  if (!isMismeasured(range, rects)) {
    return rects;
  }
  return measuredOnCopy(range) || rects;
}

/**
 * Rally (RR-6363): the bounding rect of `range`; see `rangeClientRects`.
 *
 * Rally (RR-9599): the union of the boxes drawn for it (`unionOfDrawnRects`), not
 * `getBoundingClientRect()`, which also counts the zero-width rects at a line's
 * edge. A word right before a <br> (every iOS), or right after a kept newline
 * (iOS 17 and 18's WebKit, `white-space: pre` and the like), came out two lines
 * tall, from the line above or into the line below. The highlight drawn
 * (`getClientRectsNoOverlap`) was right; the rect the app was told (where the
 * word help bubble and the word burst go) was not.
 */
export function rangeBoundingRect(range) {
  const letterLines = separatelyLaidOutWordRects(range);
  if (letterLines) {
    return unionOf(letterLines);
  }
  const rect = range.getBoundingClientRect();
  if (firstLetterBlock(range)) {
    return firstLetterBoundingRect(range) || rect;
  }
  if (!isMismeasured(range, [rect])) {
    return unionOfDrawnRects(Array.from(range.getClientRects())) || rect;
  }
  const rects = measuredOnCopy(range);
  return rects && rects.length > 0 ? unionOf(rects) : rect;
}

/**
 * Rally (RR-9800): the bounding rect of a range in the text of a `::first-letter`
 * drop cap, as `rangeBoundingRect` measures it; null for any other range, so a
 * caller can keep measuring those as it did (the selection's rect).
 */
export function firstLetterBoundingRect(range) {
  return firstLetterBlock(range)
    ? unionOfDrawnRects(rangeClientRects(range))
    : null;
}

/** Text that shows, measured only as carets: every rect 0 wide but as tall as a line. */
function isMismeasured(range, rects) {
  return (
    !range.collapsed &&
    rects.length > 0 &&
    rects.every((rect) => rect.width === 0 && rect.height > 0) &&
    /\S/.test(range.toString())
  );
}

/**
 * Rally (RR-6184): the element whose `::first-letter` style draws the start of
 * `range`'s text node; null when there is none, for a range over more than one
 * node, and for a range past the first letter on a WebKit that measures it right
 * (nothing to change there; checked first, it is cheap).
 *
 * The node must be the first with text in that element (only that one holds the
 * letter: the text after an inline element measures right), and the element must
 * be laid out as a block (`::first-letter` applies to nothing else). It may be an
 * ancestor of the node's parent: `<p class="ot"><span>My name…`.
 */
function firstLetterBlock(range) {
  const node = range.startContainer;
  if (
    range.collapsed ||
    node !== range.endContainer ||
    node.nodeType !== Node.TEXT_NODE ||
    (!holdsFirstLetter(range) && !webKitShiftsFirstLetterText())
  ) {
    return null;
  }
  for (
    let element = node.parentElement;
    element && element !== document.documentElement;
    element = element.parentElement
  ) {
    if (firstTextNodeIn(element) !== node) {
      return null;
    }
    const display = getComputedStyle(element).display || "inline";
    if (
      display !== "inline" &&
      display !== "contents" &&
      hasFirstLetterStyle(element)
    ) {
      return element;
    }
  }
  return null;
}

/**
 * The first letter of a text node, as `::first-letter` takes it: the first
 * character after any whitespace, with the punctuation before it (`“H`).
 */
const firstLetterPattern = /^(\s*)([\p{Ps}\p{Pi}\p{Po}]*\S)/u;

/** `range` (within one text node) holds some of its node's first letter. */
function holdsFirstLetter(range) {
  const match = firstLetterPattern.exec(range.startContainer.data);
  if (!match) {
    return false;
  }
  const start = match[1].length;
  const end = match[0].length;
  return range.startOffset < end && range.endOffset > start;
}

/**
 * Rally (RR-6184): `rects` of a word that holds a first letter, with the letter's
 * box (the first, taller than the line) given the top and height of the line
 * drawn right after it, when the letter sits on that line: it starts above the
 * line and ends no more than a line below the line's bottom (the letter's own
 * descent: `line-height: 0`, a raised initial). Underlined, the word is then one
 * line at the line's bottom. A drop cap floated down beside several lines keeps
 * its box, so the underline doesn't run through it.
 *
 * Rally (RR-9799): a word that is only the letter ("I", "A") takes the line
 * from the first character drawn after it (`range`'s).
 */
export function firstLetterOnItsLine(rects, range = null) {
  const drawn = rects.filter((rect) => rect.width > 0 && rect.height > 0);
  if (drawn.length === 0) {
    return rects;
  }
  const letter = drawn[0];
  const line =
    drawn.find((rect) => rect !== letter && sitsOn(letter, rect)) ||
    (drawn.length === 1 && range ? characterAfter(range) : null);
  if (!line || !sitsOn(letter, line)) {
    return rects;
  }
  const onTheLine = makeRect(letter.left, line.top, letter.width, line.height);
  return rects.map((rect) => (rect === letter ? onTheLine : rect));
}

/** `letter` is taller than `line`, just before it, and sits on it (see `firstLetterOnItsLine`). */
function sitsOn(letter, line) {
  return (
    line.height < letter.height &&
    line.left >= letter.right - 2 &&
    letter.top < line.top &&
    letter.bottom > line.top &&
    letter.bottom <= line.bottom + line.height
  );
}

/** The drawn box of the first character after `range` in its text node, or null. */
function characterAfter(range) {
  const node = range.endContainer;
  const index = node.data.slice(range.endOffset).search(/\S/);
  if (index === -1) {
    return null;
  }
  const character = document.createRange();
  character.setStart(node, range.endOffset + index);
  character.setEnd(node, range.endOffset + index + 1);
  return (
    rangeClientRects(character).find(
      (rect) => rect.width > 0 && rect.height > 0
    ) || null
  );
}

/** The first text node in `element` with something other than whitespace. */
function firstTextNodeIn(element) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (/\S/.test(node.data)) {
      return node;
    }
  }
  return null;
}

/**
 * What a `::first-letter` rule sets, for a drop cap's or a raised initial's look:
 * properties the letter inherits from its element, and the ones it doesn't, with
 * their initial values.
 */
const inheritedFirstLetterProperties = [
  "fontSize",
  "fontFamily",
  "fontWeight",
  "fontStyle",
  "lineHeight",
  "letterSpacing",
  "textTransform",
  "color",
];
const ownFirstLetterProperties = {
  float: "none",
  verticalAlign: "baseline",
  marginLeft: "0px",
  marginRight: "0px",
  paddingLeft: "0px",
  paddingRight: "0px",
};

/**
 * `element`'s first letter is drawn with a style of its own. A property the
 * letter doesn't inherit counts only when it is neither its initial value nor the
 * element's: a body or a paragraph with margins of its own has no first-letter
 * style for that.
 */
function hasFirstLetterStyle(element) {
  const own = getComputedStyle(element);
  const letter = getComputedStyle(element, "::first-letter");
  if (!letter) {
    return false;
  }
  return (
    inheritedFirstLetterProperties.some(
      (property) => letter[property] !== own[property]
    ) ||
    Object.entries(ownFirstLetterProperties).some(
      ([property, initial]) =>
        letter[property] !== initial && letter[property] !== own[property]
    )
  );
}

let firstLetterTextShifts = null;

/**
 * Rally (RR-6184): this WebKit measures a range in `::first-letter` text one
 * letter too far along (before iOS 27), or as a caret: measured once a
 * document, on a hidden line "Wi" whose "W" is a first letter. Measured right,
 * the "W" starts the line; otherwise its range is the "i"'s box, or 0 wide.
 */
function webKitShiftsFirstLetterText() {
  if (firstLetterTextShifts === null) {
    firstLetterTextShifts = measureFirstLetterShift();
  }
  return firstLetterTextShifts === true;
}

const firstLetterProbeClass = "readium-rally-first-letter-probe";

function measureFirstLetterShift() {
  const body = document.body;
  if (!body) {
    return null;
  }
  const style = document.createElement("style");
  style.textContent = `.${firstLetterProbeClass}::first-letter { font-size: 400% !important; }`;
  const probe = document.createElement("div");
  probe.className = firstLetterProbeClass;
  probe.style.cssText =
    "position: absolute; left: 0; top: 0; visibility: hidden; pointer-events: none; " +
    "white-space: nowrap; margin: 0; padding: 0; border: 0; text-indent: 0; " +
    "text-align: left; direction: ltr; writing-mode: horizontal-tb; font-size: 20px;";
  probe.textContent = "Wi";
  (document.head || body).appendChild(style);
  body.appendChild(probe);
  try {
    const letter = document.createRange();
    letter.setStart(probe.firstChild, 0);
    letter.setEnd(probe.firstChild, 1);
    const drawn = Array.from(letter.getClientRects()).find(
      (rect) => rect.width > 0
    );
    const line = probe.getBoundingClientRect();
    if (!(line.width > 0)) {
      return null; // Nothing laid out yet (a hidden document): ask again later.
    }
    return !drawn || Math.abs(drawn.left - line.left) > 1;
  } catch (error) {
    logNative(`measuring a first letter failed: ${error.message}`);
    return null;
  } finally {
    probe.remove();
    style.remove();
  }
}

/**
 * The client rects of `range` (within one text node) measured on a copy of
 * `element` (by default the node's parent): the copy goes in just before the
 * element, so it matches the same selectors (`:first-child`, `p + p`), is hidden,
 * and is removed before anything is drawn. Null when the range spans nodes or
 * the copy can't be measured.
 *
 * Rally (RR-9798): a span never includes a floated first letter's box, so with
 * `floatedLetter` (the `::first-letter` style of a floated drop cap the range
 * holds) the letter is drawn on the copy by a span of its own with that style,
 * the copy's `::first-letter` is turned off, and the letter's box comes first.
 */
function measuredOnCopy(
  range,
  element = range.startContainer.parentElement,
  floatedLetter = null
) {
  const node = range.startContainer;
  if (node !== range.endContainer || node.nodeType !== Node.TEXT_NODE) {
    return null;
  }
  if (!element || !element.parentNode || !element.contains(node)) {
    return null;
  }
  const path = childPath(element, node);
  let noFirstLetterStyle = null;
  // Before the copy shifts it.
  const elementRect = element.getBoundingClientRect();
  const copy = element.cloneNode(true);
  copy.setAttribute("aria-hidden", "true");
  copy.style.visibility = "hidden";
  copy.style.pointerEvents = "none";
  element.parentNode.insertBefore(copy, element);
  try {
    const copyNode = path.reduce(
      (parent, index) => parent.childNodes[index],
      copy
    );
    const letter = floatedLetter && firstLetterPattern.exec(copyNode.data);
    // The word after the letter first: wrapping it leaves the letter's offsets as they are.
    const start = letter
      ? Math.max(range.startOffset, letter[0].length)
      : range.startOffset;
    const span =
      start < range.endOffset ? document.createElement("span") : null;
    if (span) {
      wrap(copyNode, start, range.endOffset, span);
    }
    let letterSpan = null;
    if (letter) {
      letterSpan = document.createElement("span");
      for (const property of floatedLetterProperties) {
        letterSpan.style[property] = floatedLetter[property];
      }
      wrap(copyNode, letter[1].length, letter[0].length, letterSpan);
      copy.classList.add(noFirstLetterClass);
      noFirstLetterStyle = document.createElement("style");
      noFirstLetterStyle.textContent = noFirstLetterRule;
      (document.head || document.body).appendChild(noFirstLetterStyle);
    }
    const copyRect = copy.getBoundingClientRect();
    const dx = elementRect.left - copyRect.left;
    const dy = elementRect.top - copyRect.top;
    const rects = [
      ...(letterSpan ? [letterSpan.getBoundingClientRect()] : []),
      ...(span ? Array.from(span.getClientRects()) : []),
    ]
      .filter((rect) => rect.width > 0)
      .map((rect) =>
        makeRect(rect.left + dx, rect.top + dy, rect.width, rect.height)
      );
    return rects.length > 0 ? rects : null;
  } catch (error) {
    logNative(`measuring a range on a copy failed: ${error.message}`);
    return null;
  } finally {
    copy.remove();
    if (noFirstLetterStyle) {
      noFirstLetterStyle.remove();
    }
  }
}

function wrap(node, start, end, element) {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  range.surroundContents(element);
}

/**
 * Rally (RR-9798): the `::first-letter` style of `block` when it floats (a drop
 * cap beside several lines), or null.
 */
function floatedFirstLetterStyle(block) {
  const letter = getComputedStyle(block, "::first-letter");
  return letter && letter.float && letter.float !== "none" ? letter : null;
}

/** What draws a floated first letter, copied onto the span that stands in for it. */
const floatedLetterProperties = [
  "float",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "lineHeight",
  "verticalAlign",
  "letterSpacing",
  "textTransform",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderTopStyle",
  "borderRightStyle",
  "borderBottomStyle",
  "borderLeftStyle",
];

const noFirstLetterClass = "readium-rally-no-first-letter";

/** Turns the copy's own `::first-letter` off: the letter's span draws it. */
const noFirstLetterRule =
  `.${noFirstLetterClass}::first-letter { font: inherit !important; ` +
  "float: none !important; line-height: inherit !important; " +
  "vertical-align: baseline !important; margin: 0 !important; " +
  "padding: 0 !important; border: 0 !important; " +
  "letter-spacing: inherit !important; text-transform: inherit !important; }";

/** The child indexes from `ancestor` down to `node`. */
function childPath(ancestor, node) {
  const path = [];
  for (let child = node; child !== ancestor; child = child.parentNode) {
    path.unshift(
      Array.prototype.indexOf.call(child.parentNode.childNodes, child)
    );
  }
  return path;
}

function makeRect(left, top, width, height) {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON() {
      return {
        left,
        top,
        width,
        height,
        right: left + width,
        bottom: top + height,
      };
    },
  };
}

/**
 * Rally (RR-9599): the union of `rects` bigger than the "boxes" highlight's
 * minimum area (`getClientRectsNoOverlap` drops the rest), or null when none is.
 */
export function unionOfDrawnRects(rects, minArea = 2 * 2) {
  const drawn = rects.filter((rect) => rect.width * rect.height > minArea);
  return drawn.length > 0 ? unionOf(drawn) : null;
}

function unionOf(rects) {
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return makeRect(left, top, right - left, bottom - top);
}

/**
 * Rally (RR-9728): the rects of a word whose letters the book lays out one by
 * one, one rect per line it is drawn on; null for any other range.
 *
 * A word on a curve or bouncing along a line puts every letter in its own
 * element: a rotated `<p>` per letter ("I Play", 9781626725126), or an SVG
 * `<text>` per glyph. Since RR-6140 such a word is read as one word, so its range
 * spans those elements, and WebKit gives it each letter's box, at its own height
 * along the curve, plus the border box of every element wholly inside it: a band
 * a line high from the letter to the right edge of the page. Underlined rect by
 * rect, the word had a line under each letter, lines above and through it.
 * Here each letter is measured on its own (so `rangeClientRects` still applies),
 * and the letters that share a line make one rect.
 *
 * Only for a word spread letter by letter (at most two characters a text node,
 * nothing drawn between them, no space in its text) over text nodes laid out
 * apart: in different blocks, inline blocks, transformed elements or SVG. A word
 * split by inline spans (a styled letter, a kerning span), OCR overlays and words
 * one per element (a phrase) keep the rects they had.
 */
export function separatelyLaidOutWordRects(range) {
  const parts = wordParts(range);
  if (!parts || !partsAreLaidOutApart(parts, range.commonAncestorContainer)) {
    return null;
  }
  const rects = [];
  for (const { node, start, end } of parts) {
    const part = document.createRange();
    part.setStart(node, start);
    part.setEnd(node, end);
    for (const rect of rangeClientRects(part)) {
      if (rect.width > 0 && rect.height > 0) {
        rects.push(rect);
      }
    }
  }
  const lines = unionByLine(rects, isVertical(parts[0].node));
  return lines.length > 0 ? lines : null;
}

/** The longest text node of a word laid out letter by letter. */
const maxLettersPerPart = 2;

/**
 * Rally (RR-9728): `rects` in reading order, one union per line: a rect is on the
 * line of the one before it when they overlap across the line (vertically, or
 * horizontally in vertical writing) by at least half the bigger one's size.
 * Letters along a curve chain into one line; a word broken over two lines (or
 * columns) gives two; a drop cap beside its word's other letters (much taller)
 * stays apart, as before.
 */
export function unionByLine(rects, vertical = false) {
  const [start, end, size] = vertical
    ? ["left", "right", "width"]
    : ["top", "bottom", "height"];
  const lines = [];
  let line = [];
  for (const rect of rects) {
    const previous = line[line.length - 1];
    if (previous) {
      const overlap =
        Math.min(previous[end], rect[end]) -
        Math.max(previous[start], rect[start]);
      if (overlap < Math.max(previous[size], rect[size]) / 2) {
        lines.push(unionOf(line));
        line = [];
      }
    }
    line.push(rect);
  }
  if (line.length > 0) {
    lines.push(unionOf(line));
  }
  return lines;
}

function isVertical(node) {
  const element = node.parentElement;
  const mode = element ? getComputedStyle(element).writingMode || "" : "";
  return mode.startsWith("vertical") || mode.startsWith("sideways");
}

/**
 * The text of `range` node by node, `{ node, start, end }`, when it is a word
 * spread letter by letter: more than one text node with text, at most
 * `maxLettersPerPart` characters each, no space, and nothing drawn between them
 * (the whitespace-only nodes between the letters' elements are not drawn). Null
 * otherwise. Walks from the range's start, not its common ancestor's.
 */
function wordParts(range) {
  const root = range.commonAncestorContainer;
  if (range.collapsed || root.nodeType === Node.TEXT_NODE) {
    return null;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = firstTextNode(range, walker);
  const parts = [];
  let gapIsDrawn = false;
  for (; node; node = walker.nextNode()) {
    if (!range.intersectsNode(node)) {
      if (parts.length > 0) {
        break; // past the range's end
      }
      continue;
    }
    const start = node === range.startContainer ? range.startOffset : 0;
    const end =
      node === range.endContainer ? range.endOffset : node.data.length;
    const text = node.data.slice(start, end);
    if (!/\S/.test(text)) {
      // Between two letters: a space the page draws ends the word.
      gapIsDrawn =
        gapIsDrawn || (parts.length > 0 && isDrawn(node, start, end));
      continue;
    }
    const letters = text.trim();
    if (
      gapIsDrawn ||
      /\s/.test(letters) ||
      Array.from(letters).length > maxLettersPerPart ||
      (node.parentElement && node.parentElement.closest(".text-overlay"))
    ) {
      return null;
    }
    const leading = text.length - text.trimStart().length;
    const trailing = text.length - text.trimEnd().length;
    parts.push({ node, start: start + leading, end: end - trailing });
  }
  return parts.length > 1 ? parts : null;
}

/** The first text node at or after the range's start; `walker` is left on it. */
function firstTextNode(range, walker) {
  const container = range.startContainer;
  if (container.nodeType === Node.TEXT_NODE) {
    walker.currentNode = container;
    return container;
  }
  const child = container.childNodes[range.startOffset];
  if (!child) {
    walker.currentNode = container;
    return walker.nextNode();
  }
  walker.currentNode = child;
  return child.nodeType === Node.TEXT_NODE ? child : walker.nextNode();
}

/** Some of the text is drawn: a box wider than nothing. */
function isDrawn(node, start, end) {
  const gap = document.createRange();
  gap.setStart(node, start);
  gap.setEnd(node, end);
  return Array.from(gap.getClientRects()).some(
    (rect) => rect.width > 0 && rect.height > 0
  );
}

/** Some part sits in an element below `root` that is not laid out inline with the rest. */
function partsAreLaidOutApart(parts, root) {
  return parts.some(({ node }) => {
    for (
      let element = node.parentElement;
      element && element !== root && element.contains(node);
      element = element.parentElement
    ) {
      if (typeof SVGElement !== "undefined" && element instanceof SVGElement) {
        return true;
      }
      const style = getComputedStyle(element);
      const display = style.display || "inline";
      const transform = style.transform || "none";
      if (display !== "inline" || transform !== "none") {
        return true;
      }
    }
    return false;
  });
}

export function getClientRectsNoOverlap(
  range,
  doNotMergeHorizontallyAlignedRects
) {
  const letterLines = separatelyLaidOutWordRects(range);
  if (letterLines) {
    return letterLines;
  }
  let clientRects = rangeClientRects(range);

  const tolerance = 1;
  const originalRects = [];
  for (const rangeClientRect of clientRects) {
    originalRects.push({
      bottom: rangeClientRect.bottom,
      height: rangeClientRect.height,
      left: rangeClientRect.left,
      right: rangeClientRect.right,
      top: rangeClientRect.top,
      width: rangeClientRect.width,
    });
  }
  const mergedRects = mergeTouchingRects(
    originalRects,
    tolerance,
    doNotMergeHorizontallyAlignedRects
  );
  const noContainedRects = removeContainedRects(mergedRects, tolerance);
  const newRects = replaceOverlapingRects(noContainedRects);
  const minArea = 2 * 2;
  for (let j = newRects.length - 1; j >= 0; j--) {
    const rect = newRects[j];
    const bigEnough = rect.width * rect.height > minArea;
    if (!bigEnough) {
      if (newRects.length > 1) {
        log("CLIENT RECT: remove small");
        newRects.splice(j, 1);
      } else {
        log("CLIENT RECT: remove small, but keep otherwise empty!");
        break;
      }
    }
  }
  log(`CLIENT RECT: reduced ${originalRects.length} --> ${newRects.length}`);
  return newRects;
}

function mergeTouchingRects(
  rects,
  tolerance,
  doNotMergeHorizontallyAlignedRects
) {
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const rect1 = rects[i];
      const rect2 = rects[j];
      if (rect1 === rect2) {
        log("mergeTouchingRects rect1 === rect2 ??!");
        continue;
      }
      const rectsLineUpVertically =
        almostEqual(rect1.top, rect2.top, tolerance) &&
        almostEqual(rect1.bottom, rect2.bottom, tolerance);
      const rectsLineUpHorizontally =
        almostEqual(rect1.left, rect2.left, tolerance) &&
        almostEqual(rect1.right, rect2.right, tolerance);
      const horizontalAllowed = !doNotMergeHorizontallyAlignedRects;
      const aligned =
        (rectsLineUpHorizontally && horizontalAllowed) ||
        (rectsLineUpVertically && !rectsLineUpHorizontally);
      const canMerge = aligned && rectsTouchOrOverlap(rect1, rect2, tolerance);
      if (canMerge) {
        log(
          `CLIENT RECT: merging two into one, VERTICAL: ${rectsLineUpVertically} HORIZONTAL: ${rectsLineUpHorizontally} (${doNotMergeHorizontallyAlignedRects})`
        );
        const newRects = rects.filter((rect) => {
          return rect !== rect1 && rect !== rect2;
        });
        const replacementClientRect = getBoundingRect(rect1, rect2);
        newRects.push(replacementClientRect);
        return mergeTouchingRects(
          newRects,
          tolerance,
          doNotMergeHorizontallyAlignedRects
        );
      }
    }
  }
  return rects;
}

function getBoundingRect(rect1, rect2) {
  const left = Math.min(rect1.left, rect2.left);
  const right = Math.max(rect1.right, rect2.right);
  const top = Math.min(rect1.top, rect2.top);
  const bottom = Math.max(rect1.bottom, rect2.bottom);
  return {
    bottom,
    height: bottom - top,
    left,
    right,
    top,
    width: right - left,
  };
}

function removeContainedRects(rects, tolerance) {
  const rectsToKeep = new Set(rects);
  for (const rect of rects) {
    const bigEnough = rect.width > 1 && rect.height > 1;
    if (!bigEnough) {
      log("CLIENT RECT: remove tiny");
      rectsToKeep.delete(rect);
      continue;
    }
    for (const possiblyContainingRect of rects) {
      if (rect === possiblyContainingRect) {
        continue;
      }
      if (!rectsToKeep.has(possiblyContainingRect)) {
        continue;
      }
      if (rectContains(possiblyContainingRect, rect, tolerance)) {
        log("CLIENT RECT: remove contained");
        rectsToKeep.delete(rect);
        break;
      }
    }
  }
  return Array.from(rectsToKeep);
}

function rectContains(rect1, rect2, tolerance) {
  return (
    rectContainsPoint(rect1, rect2.left, rect2.top, tolerance) &&
    rectContainsPoint(rect1, rect2.right, rect2.top, tolerance) &&
    rectContainsPoint(rect1, rect2.left, rect2.bottom, tolerance) &&
    rectContainsPoint(rect1, rect2.right, rect2.bottom, tolerance)
  );
}

export function rectContainsPoint(rect, x, y, tolerance) {
  return (
    (rect.left < x || almostEqual(rect.left, x, tolerance)) &&
    (rect.right > x || almostEqual(rect.right, x, tolerance)) &&
    (rect.top < y || almostEqual(rect.top, y, tolerance)) &&
    (rect.bottom > y || almostEqual(rect.bottom, y, tolerance))
  );
}

function replaceOverlapingRects(rects) {
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const rect1 = rects[i];
      const rect2 = rects[j];
      if (rect1 === rect2) {
        log("replaceOverlapingRects rect1 === rect2 ??!");
        continue;
      }
      if (rectsTouchOrOverlap(rect1, rect2, -1)) {
        let toAdd = [];
        let toRemove;
        const subtractRects1 = rectSubtract(rect1, rect2);
        if (subtractRects1.length === 1) {
          toAdd = subtractRects1;
          toRemove = rect1;
        } else {
          const subtractRects2 = rectSubtract(rect2, rect1);
          if (subtractRects1.length < subtractRects2.length) {
            toAdd = subtractRects1;
            toRemove = rect1;
          } else {
            toAdd = subtractRects2;
            toRemove = rect2;
          }
        }
        log(`CLIENT RECT: overlap, cut one rect into ${toAdd.length}`);
        const newRects = rects.filter((rect) => {
          return rect !== toRemove;
        });
        Array.prototype.push.apply(newRects, toAdd);
        return replaceOverlapingRects(newRects);
      }
    }
  }
  return rects;
}

function rectSubtract(rect1, rect2) {
  const rectIntersected = rectIntersect(rect2, rect1);
  if (rectIntersected.height === 0 || rectIntersected.width === 0) {
    return [rect1];
  }
  const rects = [];
  {
    const rectA = {
      bottom: rect1.bottom,
      height: 0,
      left: rect1.left,
      right: rectIntersected.left,
      top: rect1.top,
      width: 0,
    };
    rectA.width = rectA.right - rectA.left;
    rectA.height = rectA.bottom - rectA.top;
    if (rectA.height !== 0 && rectA.width !== 0) {
      rects.push(rectA);
    }
  }
  {
    const rectB = {
      bottom: rectIntersected.top,
      height: 0,
      left: rectIntersected.left,
      right: rectIntersected.right,
      top: rect1.top,
      width: 0,
    };
    rectB.width = rectB.right - rectB.left;
    rectB.height = rectB.bottom - rectB.top;
    if (rectB.height !== 0 && rectB.width !== 0) {
      rects.push(rectB);
    }
  }
  {
    const rectC = {
      bottom: rect1.bottom,
      height: 0,
      left: rectIntersected.left,
      right: rectIntersected.right,
      top: rectIntersected.bottom,
      width: 0,
    };
    rectC.width = rectC.right - rectC.left;
    rectC.height = rectC.bottom - rectC.top;
    if (rectC.height !== 0 && rectC.width !== 0) {
      rects.push(rectC);
    }
  }
  {
    const rectD = {
      bottom: rect1.bottom,
      height: 0,
      left: rectIntersected.right,
      right: rect1.right,
      top: rect1.top,
      width: 0,
    };
    rectD.width = rectD.right - rectD.left;
    rectD.height = rectD.bottom - rectD.top;
    if (rectD.height !== 0 && rectD.width !== 0) {
      rects.push(rectD);
    }
  }
  return rects;
}

function rectIntersect(rect1, rect2) {
  const maxLeft = Math.max(rect1.left, rect2.left);
  const minRight = Math.min(rect1.right, rect2.right);
  const maxTop = Math.max(rect1.top, rect2.top);
  const minBottom = Math.min(rect1.bottom, rect2.bottom);
  return {
    bottom: minBottom,
    height: Math.max(0, minBottom - maxTop),
    left: maxLeft,
    right: minRight,
    top: maxTop,
    width: Math.max(0, minRight - maxLeft),
  };
}

function rectsTouchOrOverlap(rect1, rect2, tolerance) {
  return (
    (rect1.left < rect2.right ||
      (tolerance >= 0 && almostEqual(rect1.left, rect2.right, tolerance))) &&
    (rect2.left < rect1.right ||
      (tolerance >= 0 && almostEqual(rect2.left, rect1.right, tolerance))) &&
    (rect1.top < rect2.bottom ||
      (tolerance >= 0 && almostEqual(rect1.top, rect2.bottom, tolerance))) &&
    (rect2.top < rect1.bottom ||
      (tolerance >= 0 && almostEqual(rect2.top, rect1.bottom, tolerance)))
  );
}

function almostEqual(a, b, tolerance) {
  return Math.abs(a - b) <= tolerance;
}

function log() {
  if (debug) {
    logNative.apply(null, arguments);
  }
}
