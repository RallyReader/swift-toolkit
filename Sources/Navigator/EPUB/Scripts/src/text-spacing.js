//
//  Copyright 2026 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

// Decides whether two pieces of text that follow each other in the DOM with
// no whitespace between them are separate words. Fixed layouts converted from
// PDF draw every fragment as its own positioned element, so `textContent`
// glues "A" + "rt" + "is" into "Artis" unless we add a space where the page
// shows a gap. Kept free of DOM access so the scenarios can be tested in Node
// (test/text-geometry-spacing.test.js): `decorator.js` measures the page and passes
// plain values in.

// A gap wider than this share of the line height is a word space. Word gaps
// drawn with margins in PDF conversions are ~0.4em (~0.33 of the line box),
// kerning inside a word stays under ~0.15em (~0.12 of the line box).
const WORD_GAP_RATIO = 0.2;

// A drop cap is a single letter drawn at least this many times larger than the
// text that follows it. Its margin makes the gap to the rest of its word wider
// than kerning, so it may be up to DROP_CAP_GAP_RATIO of the line height. A
// drop cap followed by a separate word also has a word space on top of that.
const DROP_CAP_MIN_SIZE_RATIO = 2;
const DROP_CAP_GAP_RATIO = 0.5;

// Two rects whose vertical overlap covers at least this share of the shorter
// one are on the same line. A drop cap counts as being on the line it starts.
const SAME_LINE_OVERLAP_RATIO = 0.5;

// Pieces whose writing directions differ by more than this are not on the
// same line, e.g. a rotated caption next to regular text.
const SAME_DIRECTION_MAX_ANGLE = Math.PI / 6;

// Rotated pieces whose font sizes differ by more than this factor belong to
// different lines, e.g. a curved title running along a curved paragraph. The
// viewport box of a rotated glyph is larger than the glyph, so the boxes alone
// can't tell them apart.
const ROTATED_SAME_LINE_MAX_SIZE_RATIO = 1.5;

// Rotations below this are treated as regular text.
const ROTATED_MIN_ANGLE = Math.PI / 36;

/**
 * Whether `previous` and `next` are on the same line.
 *
 * Each rect is { top, bottom, left, right }, in the frame of the text: x runs
 * along the line and y across it.
 */
export function isOnSameLine(previous, next) {
  const height = Math.min(
    previous.bottom - previous.top,
    next.bottom - next.top
  );
  if (height <= 0) {
    return false;
  }
  const overlap =
    Math.min(previous.bottom, next.bottom) - Math.max(previous.top, next.top);
  return overlap >= height * SAME_LINE_OVERLAP_RATIO;
}

/**
 * Returns the bounding box of the viewport `rect` once the page is rotated by
 * `-angle` (radians), so text drawn at `angle` runs left to right in it.
 * Rotated and curved text in PDF conversions is drawn with CSS transforms,
 * and the viewport boxes of its characters don't line up horizontally.
 */
export function toTextFrame(rect, angle) {
  if (!angle) {
    return rect;
  }
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const xs = [];
  const ys = [];
  for (const x of [rect.left, rect.right]) {
    for (const y of [rect.top, rect.bottom]) {
      xs.push(x * cos + y * sin);
      ys.push(-x * sin + y * cos);
    }
  }
  return {
    top: Math.min(...ys),
    bottom: Math.max(...ys),
    left: Math.min(...xs),
    right: Math.max(...xs),
  };
}

/**
 * Whether a space must be inserted between two DOM-adjacent text pieces.
 *
 * `previous` and `next` are { text, rect, angle, fontSize }: `rect` is the
 * viewport box of the last character of `previous` and the first character of
 * `next`, or null when that character is not rendered, `angle` is the rotation
 * of the text in radians (0 for regular text) and `fontSize` its drawn size.
 */
export function needsSpaceBetween(previous, next) {
  if (/\s$/.test(previous.text) || /^\s/.test(next.text)) {
    return false;
  }
  if (!previous.rect || !next.rect) {
    return false;
  }

  const previousAngle = previous.angle || 0;
  const nextAngle = next.angle || 0;
  const turn = Math.atan2(
    Math.sin(nextAngle - previousAngle),
    Math.cos(nextAngle - previousAngle)
  );
  if (Math.abs(turn) > SAME_DIRECTION_MAX_ANGLE) {
    return true;
  }
  const angle = previousAngle + turn / 2;
  if (
    Math.abs(angle) > ROTATED_MIN_ANGLE &&
    previous.fontSize > 0 &&
    next.fontSize > 0 &&
    Math.max(previous.fontSize, next.fontSize) >
      Math.min(previous.fontSize, next.fontSize) *
        ROTATED_SAME_LINE_MAX_SIZE_RATIO
  ) {
    return true;
  }
  const previousRect = toTextFrame(previous.rect, angle);
  const nextRect = toTextFrame(next.rect, angle);

  if (!isOnSameLine(previousRect, nextRect)) {
    return true;
  }

  const height = Math.min(
    previousRect.bottom - previousRect.top,
    nextRect.bottom - nextRect.top
  );
  // A piece drawn well before the previous one on the same line is another
  // word that comes later in the DOM, e.g. side-by-side labels. Kerning only
  // overlaps neighbouring characters by a fraction of the line height.
  const gap = nextRect.left - previousRect.right;
  const gapRatio = isDropCap(previous, next)
    ? DROP_CAP_GAP_RATIO
    : WORD_GAP_RATIO;
  return gap > height * gapRatio || gap < -height;
}

/**
 * Whether `previous` looks like the drop cap starting the word in `next`.
 */
function isDropCap(previous, next) {
  const letter = previous.text;
  return (
    letter.length === 1 &&
    letter.toLowerCase() !== letter.toUpperCase() &&
    next.fontSize > 0 &&
    previous.fontSize >= next.fontSize * DROP_CAP_MIN_SIZE_RATIO
  );
}
