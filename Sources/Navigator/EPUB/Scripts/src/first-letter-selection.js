//
//  Copyright 2026 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

// Rally: the selection in the text of a `::first-letter` drop cap.
//
// Before iOS 27, WebKit's offsets in the text node that holds a drop cap are a
// letter early (RR-6184): a selection made over "name" holds " nam", and the
// caret at a point is a letter early too (`firstLetterShift`). WebKit draws and
// reads such a selection by the same mistake, so the highlight and the
// selection's text are right; only its offsets are off.
//
// RR-9855: a long press in such a text node (iOS 27: any word; before: the drop
// cap itself) makes WebKit select from the page's first drop-cap paragraph to
// the pressed point, across paragraphs. Plain Safari does it too. The caret at
// the press is right, so the pressed word is selected in its place.

import { firstLetterElementOf, firstLetterShift } from "./rect";

/** A long press older than this made no selection that is changing now. */
const pressLifetime = 3000;

/** Letters, digits and apostrophes: what WebKit's word selection takes. */
const wordCharacter = /[\p{L}\p{N}\p{M}'’]/u;

let press = null;

/**
 * Notes a touch at (`x`, `y`) (viewport coordinates); `hadSelection` when text
 * was selected as it began, so it extends a selection rather than makes one.
 */
export function notePress(x, y, hadSelection, time = Date.now()) {
  press = { x, y, hadSelection, time };
}

/**
 * The range of `selection` in its text: before iOS 27, a selection's offsets in
 * a drop cap's text node are a letter early, so they are moved on by the
 * letter's length (an offset 0 stays: it holds the letter, " My" is "My"). The
 * locator's text around the selection is taken from this range.
 */
export function textRangeOfSelection(range) {
  const start = textOffset(range.startContainer, range.startOffset);
  const end = textOffset(range.endContainer, range.endOffset);
  if (start === range.startOffset && end === range.endOffset) {
    return range;
  }
  const textRange = document.createRange();
  textRange.setStart(range.startContainer, start);
  textRange.setEnd(range.endContainer, end);
  return textRange;
}

function textOffset(node, offset) {
  const shift = offset > 0 ? firstLetterShift(node) : 0;
  return shift > 0 ? Math.min(node.data.length, offset + shift) : offset;
}

/**
 * RR-9855: replaces a selection that a long press in a drop cap's text made
 * across paragraphs with the pressed word. Returns whether it did. A selection
 * within the pressed text node is left as WebKit made it.
 */
export function correctLongPressSelection(
  selection = window.getSelection(),
  now = Date.now()
) {
  if (
    !press ||
    press.hadSelection ||
    now - press.time > pressLifetime ||
    !selection ||
    selection.rangeCount !== 1 ||
    selection.isCollapsed ||
    typeof document.caretRangeFromPoint !== "function"
  ) {
    return false;
  }
  const caret = document.caretRangeFromPoint(press.x, press.y);
  const node = caret && caret.startContainer;
  if (!node || !firstLetterElementOf(node)) {
    return false;
  }
  const range = selection.getRangeAt(0);
  if (range.startContainer === node && range.endContainer === node) {
    return false;
  }
  const word = selectionOfWordAt(node, caret.startOffset);
  if (!word) {
    return false;
  }
  selection.setBaseAndExtent(node, word.start, node, word.end);
  return true;
}

/**
 * The offsets, as this WebKit takes them, of a selection of the word at
 * `offset` (a caret's, in WebKit's offsets) in the text `node`, or null when
 * there is no word there.
 */
export function selectionOfWordAt(node, offset) {
  const shift = firstLetterShift(node);
  const word = wordAt(node.data, offset > 0 ? offset + shift : 0);
  if (!word) {
    return null;
  }
  // Back into WebKit's offsets. The letter has none of its own: a selection
  // from 0 holds it (0 to 1 is "My").
  const start = word.start > 0 ? word.start - shift : 0;
  const end = Math.max(start + 1, word.end - shift);
  return { start, end };
}

/** The word of `text` at or just before `offset`, as { start, end }, or null. */
export function wordAt(text, offset) {
  let index = Math.min(offset, text.length - 1);
  if (index < 0) {
    return null;
  }
  if (!wordCharacter.test(text[index])) {
    index -= 1; // a caret just after the word
    if (index < 0 || !wordCharacter.test(text[index])) {
      return null;
    }
  }
  let start = index;
  while (start > 0 && wordCharacter.test(text[start - 1])) {
    start -= 1;
  }
  let end = index + 1;
  while (end < text.length && wordCharacter.test(text[end])) {
    end += 1;
  }
  return { start, end };
}
