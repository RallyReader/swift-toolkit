//
//  Copyright 2026 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

// Rally (RR-9654): the first and last visible word of a page, in a paragraph that runs over a page
// break. Each word used to be found again with `indexOf` / `lastIndexOf`, so a word already used on
// the page before was measured there, off the page. The last page of The Wild Robot ("She would find
// her way back home.") had no word left, and "Start on this page" did nothing.
//
// jsdom has no layout, so the stub below plays WebKit's columns: the paragraph's text is cut into
// pages at `pageStarts`, each page is 300 px wide, a character is 8 px (a page holds 37), and the screen shows the
// pages from `firstPageOnScreen` on, as many as fit `window.innerWidth`.

const { isZeroWidthOnly, wordSpans } = require("../src/word-spans");
const {
  appendVirtualColumnIfNeeded,
  getFirstVisibleWordText,
  getFirstVisibleWordTextOnSide,
  getLastVisibleWordText,
} = require("../src/utils");

const pageWidth = 300;
const characterWidth = 8;
let pageStarts = [0];
let firstPageOnScreen = 0;

function pageOf(offset) {
  let page = 0;
  pageStarts.forEach((start, index) => {
    if (start <= offset) {
      page = index;
    }
  });
  return page;
}

function characterLeft(offset) {
  const page = pageOf(offset);
  return (
    (page - firstPageOnScreen) * pageWidth +
    (offset - pageStarts[page]) * characterWidth
  );
}

function box(left, right) {
  return {
    left,
    right,
    top: 0,
    bottom: 20,
    width: right - left,
    height: 20,
    x: left,
    y: 0,
  };
}

// Rally (RR-8475): text outside the paragraph (the navigator's blank virtual column) is zero-width
// characters at the start of the page after the paragraph's last, inside its margin.
const pageMargin = 20;

function measureRange(range) {
  if (range.startContainer.parentElement !== document.body.firstElementChild) {
    const left =
      (pageStarts.length - firstPageOnScreen) * pageWidth + pageMargin;
    return box(left, left);
  }
  const start = range.startOffset;
  const end =
    range.endContainer === range.startContainer
      ? range.endOffset
      : range.startContainer.nodeValue.length;
  let left = Infinity;
  let right = -Infinity;
  for (let offset = start; offset < end; offset++) {
    left = Math.min(left, characterLeft(offset));
    right = Math.max(right, characterLeft(offset) + characterWidth);
  }
  return left === Infinity ? box(0, 0) : box(left, right);
}

function setViewportWidth(width) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
}

function showParagraph(text, starts, onScreen) {
  document.body.innerHTML = `<p>${text}</p>`;
  pageStarts = starts;
  firstPageOnScreen = onScreen;
}

beforeEach(() => {
  Range.prototype.getBoundingClientRect = function () {
    return measureRange(this);
  };
  Range.prototype.getClientRects = function () {
    return [measureRange(this)];
  };
  setViewportWidth(pageWidth);
});

describe("wordSpans", () => {
  test("gives every word its own offsets, repeated words too", () => {
    expect(wordSpans("  She ran. She ran.\n")).toEqual([
      { word: "She", start: 2, end: 5 },
      { word: "ran.", start: 6, end: 10 },
      { word: "She", start: 11, end: 14 },
      { word: "ran.", start: 15, end: 19 },
    ]);
  });

  test("has no words in blank text", () => {
    expect(wordSpans(" \n\t")).toEqual([]);
  });
});

// RR-8475: the virtual column's zero-width space was a word.
describe("isZeroWidthOnly", () => {
  test("is true for zero-width characters alone", () => {
    ["\u200B", "\u200C\u200D", "\u2060\uFEFF"].forEach((word) =>
      expect(isZeroWidthOnly(word)).toBe(true)
    );
  });

  test("is false for a word, one with a zero-width character in it too", () => {
    expect(isZeroWidthOnly("home")).toBe(false);
    expect(isZeroWidthOnly("home\u200Bward")).toBe(false);
  });
});

describe("a paragraph that runs over a page break", () => {
  const sentence = "She would find her way back home. ";
  const text = sentence + sentence.trim();

  test("the first visible word of a page whose words were all used before", () => {
    showParagraph(text, [0, sentence.length], 1);

    const first = getFirstVisibleWordText();

    expect(first).not.toBeNull();
    expect(first.text.highlight).toBe("She");
    expect(first.text.before.endsWith("back home. ")).toBe(true);
  });

  test("the first visible word is the page's first, not a later one used for the first time", () => {
    // "home." is the page's only word not used on the page before.
    showParagraph(
      "She would find her way back. " + sentence.trim(),
      [0, 29],
      1
    );

    expect(getFirstVisibleWordText().text.highlight).toBe("She");
  });

  test("the last visible word of a page whose words are all used again later", () => {
    showParagraph(text, [0, sentence.length], 0);

    const last = getLastVisibleWordText();

    expect(last).not.toBeNull();
    expect(last.text.highlight).toBe("home.");
    expect(last.text.after.startsWith(" She")).toBe(true);
  });

  test("the first word of the right-hand page of two", () => {
    const short = "Her way back home. ";
    showParagraph(
      short + short + short.trim(),
      [0, short.length, short.length * 2],
      1
    );
    setViewportWidth(pageWidth * 2);

    const left = getFirstVisibleWordTextOnSide("left");
    const right = getFirstVisibleWordTextOnSide("right");

    expect(left.text.highlight).toBe("Her");
    expect(left.text.before.endsWith("home. ")).toBe(true);
    expect(right).not.toBeNull();
    expect(right.text.highlight).toBe("Her");
    expect(right.text.before.endsWith("home. Her way back home. ")).toBe(true);
  });
});

// Rally (RR-8475): a chapter whose last page is the left-hand page of a two-page spread. The
// navigator adds a blank virtual column for the right-hand page, holding a zero-width space, which
// was that page's first word: "Start on this page" offered the blank page, and choosing it started
// reading at the chapter's beginning (Wonder, "How I Came to Life", iPad landscape).
describe("a chapter's last page on the left of two", () => {
  const short = "Her way back home. ";

  beforeEach(() => {
    showParagraph(
      short + short + short.trim(),
      [0, short.length, short.length * 2],
      2
    );
    setViewportWidth(pageWidth * 2);

    // Two columns per screen, three in the chapter: the real `appendVirtualColumnIfNeeded` adds one.
    jest.spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: (name) => (name == "column-count" ? "2" : ""),
    });
    Object.defineProperty(document.documentElement, "scrollWidth", {
      configurable: true,
      get: () =>
        (pageStarts.length +
          document.querySelectorAll(".readium-virtual-column").length) *
        pageWidth,
    });
    appendVirtualColumnIfNeeded();
    jest.restoreAllMocks();
  });

  afterEach(() => {
    delete document.documentElement.scrollWidth;
  });

  test("the navigator added its virtual column, a zero-width space", () => {
    const columns = document.querySelectorAll(".readium-virtual-column");
    expect(columns.length).toBe(1);
    expect(columns[0].textContent).toBe("\u200B");
  });

  test("the blank right-hand page has no first word", () => {
    expect(getFirstVisibleWordTextOnSide("right")).toBeNull();
  });

  test("the left-hand page's first word is the chapter's last page's", () => {
    const left = getFirstVisibleWordTextOnSide("left");

    expect(left.text.highlight).toBe("Her");
    expect(left.text.before.endsWith("home. ")).toBe(true);
  });

  test("the spread's first word is on the left-hand page", () => {
    expect(getFirstVisibleWordText().text.highlight).toBe("Her");
  });

  test("the spread's last word is still the virtual column's space", () => {
    // As the chapter's last word (`getLastWordText`) is: the app compares the two
    // (`PreviewGate.isShowingLastPageOfChapter`).
    expect(getLastVisibleWordText().text.highlight).toBe("\u200B");
  });
});
