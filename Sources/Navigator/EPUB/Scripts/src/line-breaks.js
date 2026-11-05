//
//  Copyright 2026 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

// Decides how a <br> gets its "\n" in the page text. `textContent` ignores
// <br>, so "I<br/>am." reads as "Iam." unless a "\n" text node separates the
// lines, as the Swift extractor's text does. Where the white-space style keeps
// newlines (the `white-space: pre` text boxes of fixed layouts), that "\n"
// draws a line break of its own: it replaces the <br>, or the line would break
// twice and every line below it would move down. Elsewhere the "\n" collapses
// and goes after the <br>, which draws the break. Kept free of DOM access so
// the cases can be tested in Node (test/line-breaks.test.js): `decorator.js`
// reads the computed style of each <br> and passes it in.

// `white-space-collapse` values (CSS Text 4) that keep newlines.
const NEWLINE_KEEPING_COLLAPSES = [
  "preserve",
  "preserve-breaks",
  "break-spaces",
];

// `white-space` values that keep newlines, for engines without
// `white-space-collapse`.
const NEWLINE_KEEPING_WHITE_SPACES = [
  "pre",
  "pre-wrap",
  "pre-line",
  "break-spaces",
];

/**
 * Whether a "\n" in text styled with `style` is drawn as a line break, so it
 * replaces a <br> instead of following it.
 *
 * `style` is { whiteSpace, whiteSpaceCollapse }, from the computed style of the
 * <br>. `whiteSpaceCollapse` is undefined or empty where the engine only has
 * `white-space`.
 */
export function keepsNewlines({ whiteSpace, whiteSpaceCollapse }) {
  if (whiteSpaceCollapse) {
    return NEWLINE_KEEPING_COLLAPSES.includes(whiteSpaceCollapse);
  }
  return NEWLINE_KEEPING_WHITE_SPACES.includes(whiteSpace);
}
