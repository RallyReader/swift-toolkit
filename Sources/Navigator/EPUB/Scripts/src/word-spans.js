//
//  Copyright 2026 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

/**
 * Rally (RR-9654): the words of a text node's `text`, each with its own offsets
 * (`start`, `end`), in order.
 *
 * The first and last visible word (utils.js) used to find each word again with
 * `indexOf` (`lastIndexOf` for the last word), which gives the word's first (last)
 * place in the whole node. A paragraph that runs over a page break is one text
 * node, so a word already used on the page before was measured there, off the
 * page: the page's first word was skipped for a later one, and on a page whose
 * every word was used before ("She would find her way back home.", the last
 * page of The Wild Robot) no word was found, and "Start on this page" did nothing.
 */
export function wordSpans(text) {
  const spans = [];
  const pattern = /\S+/g;
  let match;
  while ((match = pattern.exec(text))) {
    spans.push({
      word: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return spans;
}

/**
 * Rally (RR-8475): whether `word` (a span of `wordSpans`) is zero-width
 * characters alone, which `\S` matches (they are not white space) but nobody
 * reads. The blank virtual column (`appendVirtualColumnIfNeeded`, utils.js)
 * holds a zero-width space, which was the first word of the empty right-hand
 * page at a chapter's end on a two-page spread: "Start on this page" offered
 * that page, and choosing it started reading at the chapter's beginning (the
 * app's text of the chapter has no such word).
 *
 * Only the first visible word skips them. The last visible word and the
 * chapter's last word (`getLastWordText`) both still give the virtual column's
 * space, and the app compares the two to tell that the chapter's last page is
 * shown (`PreviewGate.isShowingLastPageOfChapter`).
 */
export function isZeroWidthOnly(word) {
  return /^[\u200B-\u200D\u2060\uFEFF]+$/.test(word);
}
