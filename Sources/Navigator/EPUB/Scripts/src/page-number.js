//
//  Copyright 2026 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

// Decides whether a word decoration is a printed page number, which read
// aloud skips. Kept free of DOM access so the scenarios can be tested in Node
// (test/page-number.test.js): `decorator.js` measures the page and passes
// plain values in.

/**
 * Whether the decorated text is made of digits only.
 */
export function isPageNumber(text) {
  return /^\d+$/.test(text.trim());
}

/**
 * Whether a word starting at `top` sits in the top or bottom band of the text
 * area described by `bounds` ({ minY, maxY, measured }).
 *
 * Uses a tight threshold when real text bounds were measured (OCR/fixed
 * layouts) and a more generous one when falling back to the viewport.
 */
export function isAtTopOrBottom(top, bounds) {
  const textHeight = bounds.maxY - bounds.minY;
  if (textHeight <= 0) {
    return false;
  }
  const relativeTop = top - bounds.minY;
  const threshold = bounds.measured ? 0.05 : 0.15;
  return (
    relativeTop < textHeight * threshold ||
    relativeTop > textHeight * (1 - threshold)
  );
}

/**
 * Whether the element holding the number contains nothing else.
 *
 * In OCR-style layouts every word is in its own element, so DOM isolation is
 * not meaningful there.
 */
export function isDOMIsolated({ text, parentText, isInOCRLayout }) {
  const trimmedParentText = parentText.trim();
  const isOnlyPageNumber = trimmedParentText === text.trim();
  const parentHasMinimalContent = trimmedParentText.length <= 5;
  return !isInOCRLayout && (isOnlyPageNumber || parentHasMinimalContent);
}

/**
 * Whether reading text continues right after a word on the same line, like
 * "1 large egg" in an ingredient list, which a page number never has.
 *
 * `nextRect` is the rect of the first non-space character after the word.
 * A wide gap (e.g. a running header "12      THE BIG DAY") doesn't count.
 */
export function continuesOnTheSameLine(wordRect, nextRect) {
  if (!wordRect || !nextRect) {
    return false;
  }
  const overlap =
    Math.min(wordRect.bottom, nextRect.bottom) -
    Math.max(wordRect.top, nextRect.top);
  if (overlap < Math.min(wordRect.height, nextRect.height) / 2) {
    return false;
  }
  const gap = nextRect.left - wordRect.right;
  return gap >= 0 && gap < wordRect.height;
}

/**
 * Whether the number stands on its own in the text, given the text `before`
 * and `after` it in the resource, and whether text follows it on its line.
 *
 * Returns the intermediate checks as well, for logging.
 */
export function pageNumberIsolation({
  before,
  after,
  domIsolated,
  followedOnSameLine = false,
}) {
  // "whole sleepover." followed by the page number
  const beforeEndsWithPunctuationAndWhitespace = /[.!?;:]\s*$/.test(before);
  const beforeHasMultipleNewlines = /\n\s*\n/.test(before);
  const beforeEndsWithSignificantWhitespace = /\s{2,}$/.test(before);

  // A word right before the number on the same line ("Chapter 1", "Part 2")
  // means it is not a page number.
  const lastNewlineIndex = before.lastIndexOf("\n");
  const immediateTextBefore =
    lastNewlineIndex !== -1 ? before.substring(lastNewlineIndex + 1) : before;
  const beforeEndsWithWordAndSpace = /[a-zA-Z]\s+$/.test(immediateTextBefore);

  // A digit + connecting character right before the number ("8:" → "30" is
  // the time "8:30"). Whitespace is collapsed for OCR layouts where each word
  // is in its own element separated by newlines.
  const beforeContentCollapsed = before.replace(/\s+/g, " ").trim();
  const beforeConnectsToNumber = /\d[:-]$/.test(beforeContentCollapsed);

  const beforeIsEmpty = before.length === 0;
  const beforeEndsInNewline = before.endsWith("\n");
  const beforeHasNoAlphanumeric = !/[a-zA-Z0-9]/.test(before);

  const afterIsEmpty = after.length === 0;
  const afterBeginsWithNewline = after.startsWith("\n");
  const afterHasNoAlphanumeric = !/[a-zA-Z0-9]/.test(after);
  // processSpansForTextSpacing (and the text extractor) add a space between
  // absolutely positioned elements.
  const afterBeginsWithWhitespace = /^\s/.test(after);

  const afterIsSeparated =
    afterIsEmpty ||
    afterBeginsWithNewline ||
    afterHasNoAlphanumeric ||
    afterBeginsWithWhitespace;

  const isolatedByText =
    (beforeIsEmpty || beforeEndsInNewline || beforeHasNoAlphanumeric) &&
    afterIsSeparated;

  const isolated =
    !followedOnSameLine &&
    !beforeEndsWithWordAndSpace &&
    !beforeConnectsToNumber &&
    (isolatedByText ||
      (domIsolated && afterIsSeparated) ||
      (beforeEndsWithPunctuationAndWhitespace && domIsolated && afterIsEmpty) ||
      (beforeHasMultipleNewlines &&
        (afterIsEmpty ||
          afterBeginsWithNewline ||
          afterBeginsWithWhitespace)) ||
      (beforeEndsWithSignificantWhitespace && domIsolated && afterIsEmpty));

  return {
    isolated,
    checks: {
      followedOnSameLine,
      isolatedByText,
      domIsolated,
      beforeEndsWithWordAndSpace,
      beforeConnectsToNumber,
      beforeEndsWithPunctuationAndWhitespace,
      beforeHasMultipleNewlines,
      beforeEndsWithSignificantWhitespace,
      afterIsSeparated,
    },
  };
}

/**
 * Whether a word decoration is a page number that read aloud must skip.
 *
 * - text: the decorated word
 * - before / after: the text around it in the resource
 * - top: top of the word's bounding rect, in viewport coordinates
 * - bounds: { minY, maxY, measured } of the page's text area
 * - parentText: text of the element holding the word
 * - isInOCRLayout: whether the word belongs to an OCR overlay
 * - followedOnSameLine: whether text continues right after the word on its
 *   line (see continuesOnTheSameLine)
 */
export function shouldSkipPageNumber({
  text,
  before = "",
  after = "",
  top,
  bounds,
  parentText = "",
  isInOCRLayout = false,
  followedOnSameLine = false,
}) {
  if (!text || !isPageNumber(text) || !isAtTopOrBottom(top, bounds)) {
    return false;
  }
  const domIsolated = isDOMIsolated({ text, parentText, isInOCRLayout });
  return pageNumberIsolation({ before, after, domIsolated, followedOnSameLine })
    .isolated;
}
