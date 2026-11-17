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
