//
//  Copyright 2026 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

// Characterization tests for `getTextFrom` (selection.js), which builds the `before`/`after` context of
// a selection ("Start Here", "Lookup", checker marks). The context is cut to whole words, up to 200
// characters on each side.

function textAround(body, highlight, occurrence = 0) {
  document.body.innerHTML = body;
  const text = document.body.textContent;
  let start = -1;
  for (let i = 0; i <= occurrence; i++) {
    start = text.indexOf(highlight, start + 1);
  }
  const {
    TextRange,
  } = require("../src/vendor/hypothesis/anchoring/text-range");
  const range = TextRange.fromOffsets(
    document.body,
    start,
    start + highlight.length
  ).toRange();
  return require("../src/selection").getTextFrom(highlight, range);
}

test("returns the highlight with word-trimmed context", () => {
  expect(textAround("<p>The quick brown fox jumps over</p>", "fox")).toEqual({
    highlight: "fox",
    before: "quick brown ",
    after: " jumps",
  });
});

test("today: the first word of `before` is dropped when it holds two or more words, and the last of `after`", () => {
  // `before` is cut after its first non-letter followed by a letter, `after` before its last letter
  // followed by a non-letter (when that is past index 1), even when nothing was truncated.
  expect(textAround("<p>Once upon a time there</p>", "a")).toEqual({
    highlight: "a",
    before: "upon ",
    after: " time",
  });
});

test("a single word of context is kept", () => {
  expect(textAround("<p>Once upon a</p>", "upon")).toEqual({
    highlight: "upon",
    before: "Once ",
    after: " a",
  });
});

test("today: for the last word of the text, `after` is the start of the text", () => {
  // The offset loop stops before reaching the end of the text, so the end offset stays 0.
  expect(textAround("<p>Once upon</p>", "upon")).toEqual({
    highlight: "upon",
    before: "Once ",
    after: "Once",
  });
});

test("today: block boundaries add no separator to the context", () => {
  expect(
    textAround("<p>one two</p><p>three four</p><p>five six</p>", "three")
  ).toEqual({
    highlight: "three",
    before: "two",
    after: " fourfive",
  });
});

test("context is limited to 200 characters, then trimmed to whole words", () => {
  const words = Array(80).fill("lorem").join(" ");
  const result = textAround(`<p>${words} target ${words}</p>`, "target");
  expect(result.before).toBe(Array(33).fill("lorem").join(" ") + " ");
  expect(result.after).toBe(" " + Array(33).fill("lorem").join(" "));
});

test("a repeated word keeps the context of the selected occurrence", () => {
  expect(textAround("<p>red cat, blue cat, green</p>", "cat", 1)).toEqual({
    highlight: "cat",
    before: "cat, blue ",
    after: ", green",
  });
});
