//
//  Copyright 2026 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

// Characterization tests for `rangeFromLocator` (utils.js): how a decoration's locator becomes a DOM
// range. The app sends `text.before/highlight/after`, optionally a `cssSelector`, and for read-aloud
// words `locations.start/end` (character offsets into `body.textContent`), which narrow the quote search
// to a window around the expected position (the Rally patch in vendored `match-quote.js`).

function load(body) {
  document.body.innerHTML = body;
}

function rangeFromLocator(locator) {
  return require("../src/utils").rangeFromLocator(locator);
}

/** The offset of the range's start in `body.textContent`. */
function offsetOf(range) {
  const prefix = document.createRange();
  prefix.setStart(document.body, 0);
  prefix.setEnd(range.startContainer, range.startOffset);
  return prefix.toString().length;
}

const failedCSSSelectorLog = "failed getting the range from css selector";

describe("text quote", () => {
  test("finds a unique highlight", () => {
    load("<p>The quick brown fox</p>");
    const range = rangeFromLocator({
      locations: {},
      text: { highlight: "brown" },
    });
    expect(range.toString()).toBe("brown");
    expect(offsetOf(range)).toBe(10);
  });

  test("uses before/after to pick between repeated words", () => {
    load("<p>the cat sat. the cat ran.</p>");
    const range = rangeFromLocator({
      locations: {},
      text: { before: "sat. the ", highlight: "cat", after: " ran" },
    });
    expect(range.toString()).toBe("cat");
    expect(offsetOf(range)).toBe(17);
  });

  test("without context, the first of repeated words wins", () => {
    load("<p>a cat and a cat</p>");
    const range = rangeFromLocator({
      locations: {},
      text: { highlight: "cat" },
    });
    expect(offsetOf(range)).toBe(2);
  });

  test("returns null and logs an error when the quote is nowhere", () => {
    load("<p>abc</p>");
    expect(
      rangeFromLocator({ locations: {}, text: { highlight: "zzzz" } })
    ).toBeNull();
    expect(postedMessages("logError")).toEqual([
      { message: "Quote not found" },
    ]);
  });
});

describe("start/end search window", () => {
  test("start/end select the occurrence inside the window (±5 characters)", () => {
    load("<p>a cat and a cat</p>");
    const range = rangeFromLocator({
      locations: { start: 12, end: 15 },
      text: { highlight: "cat" },
    });
    expect(offsetOf(range)).toBe(12);
  });

  test("an occurrence just inside the 5-character margin is found", () => {
    load("<p>a cat and a cat</p>");
    const range = rangeFromLocator({
      locations: { start: 9, end: 12 },
      text: { highlight: "cat" },
    });
    expect(offsetOf(range)).toBe(12);
  });

  test("with no exact match in the window, the whole text is searched approximately", () => {
    load(`<p>cat ${"x".repeat(30)} cat</p>`);
    const range = rangeFromLocator({
      locations: { start: 20, end: 23 },
      text: { highlight: "cat" },
    });
    expect(range.toString()).toBe("cat");
    expect(offsetOf(range)).toBe(0);
  });

  test("start/end are ignored unless both are given", () => {
    load("<p>a cat and a cat</p>");
    const range = rangeFromLocator({
      locations: { start: 12 },
      text: { highlight: "cat" },
    });
    expect(offsetOf(range)).toBe(2);
  });
});

describe("matchQuote window", () => {
  const {
    matchQuote,
  } = require("../src/vendor/hypothesis/anchoring/match-quote");

  test("offsets of a match inside the window are absolute", () => {
    expect(matchQuote("one two one two", "two", {}, 8, 15)).toMatchObject({
      start: 12,
      end: 15,
    });
  });

  test("without a window, context decides", () => {
    expect(
      matchQuote("one two one two", "two", { prefix: "one two one " })
    ).toMatchObject({ start: 12, end: 15 });
  });
});

describe("css selector cache", () => {
  test("a highlight in the element's first text node is found in that element", () => {
    load('<p id="a">hello world</p><p id="b">hello there</p>');
    const range = rangeFromLocator({
      locations: { cssSelector: "#b" },
      text: { highlight: "hello", after: " there" },
    });
    expect(range.toString()).toBe("hello");
    expect(range.startContainer.parentElement.id).toBe("b");
    expect(loggedMessages()).not.toContain(failedCSSSelectorLog);
  });

  test("today: a highlight past the element's first text node falls back to the whole-body search", () => {
    load('<p id="c">Hello <b>big</b> world</p>');
    const range = rangeFromLocator({
      locations: { cssSelector: "#c" },
      text: { highlight: "world" },
    });
    expect(range.toString()).toBe("world");
    expect(loggedMessages()).toContain(failedCSSSelectorLog);
  });

  test("today: the before/after check only compares the overlapping part", () => {
    // `before.endsWith(textBefore)`: at the start of the element nothing precedes the highlight,
    // so any `before` matches.
    load('<p id="d">cat and cat</p>');
    const range = rangeFromLocator({
      locations: { cssSelector: "#d" },
      text: { before: "a dog and ", highlight: "cat" },
    });
    expect(offsetOf(range)).toBe(0);
  });

  test("today: a cached element range emptied by a DOM replacement stays cached, and every lookup falls back", () => {
    load('<p id="e">first text</p>');
    rangeFromLocator({
      locations: { cssSelector: "#e" },
      text: { highlight: "first" },
    });
    load('<p id="e">second text with first</p>');
    const range = rangeFromLocator({
      locations: { cssSelector: "#e" },
      text: { highlight: "first" },
    });
    // Ranges are live: the cached one collapsed when its nodes were removed.
    expect(range.toString()).toBe("first");
    expect(offsetOf(range)).toBe(17);
    expect(loggedMessages()).toContain(failedCSSSelectorLog);
  });
});

describe("without a text quote", () => {
  test("a css selector selects the whole element", () => {
    load('<p id="x">one</p><p id="y">two</p>');
    const range = rangeFromLocator({ locations: { cssSelector: "#y" } });
    expect(range.toString()).toBe("two");
  });

  test("fragments select the first element found", () => {
    load('<p id="x">one</p><p id="y">two</p>');
    const range = rangeFromLocator({
      locations: { fragments: ["missing", "x", "y"] },
    });
    expect(range.toString()).toBe("one");
  });

  test("returns null when nothing matches", () => {
    load('<p id="x">one</p>');
    expect(
      rangeFromLocator({ locations: { cssSelector: "#missing" } })
    ).toBeNull();
  });
});
