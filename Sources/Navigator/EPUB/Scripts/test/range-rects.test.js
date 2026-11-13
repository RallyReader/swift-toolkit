//
//  Copyright 2026 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

// Rally (RR-6363): measuring a range when WebKit measures it as a caret.
//
// WebKit before iOS 27 measures every range in a text node drawn with a `::first-letter` style
// as a caret 0 wide at the end of its line ("Dog and Bear: Three to Get Ready", 9781429995566,
// page 6). Read aloud then skipped every word of the paragraph. `rangeClientRects` measures such a
// range again on a hidden copy of its element, where a span around the text measures right.
//
// jsdom has no layout, so the stubs below play WebKit: a range in a `.first-letter` paragraph
// measures as a caret, any other range and every span by its characters (10 px each). The copy
// lies 40 px lower and 5 px to the right of the paragraph, so its rects must be moved back.

const { rangeBoundingRect, rangeClientRects } = require("../src/rect");

const paragraphRect = { left: 0, top: 0 };
const copyOffset = { x: 5, y: 40 };
const caret = box({ left: 573, top: 0, width: 0, height: 34 });

function box({ left, top, width, height }) {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
  };
}

/** The characters of `element`'s parent before `element`. */
function offsetInParent(element) {
  let offset = 0;
  for (const node of element.parentNode.childNodes) {
    if (node === element) {
      return offset;
    }
    offset += node.textContent.length;
  }
  return offset;
}

function measureRange(range) {
  if (range.startContainer.parentElement.classList.contains("first-letter")) {
    return caret;
  }
  return box({
    left: range.startOffset * 10,
    top: 0,
    width: (range.endOffset - range.startOffset) * 10,
    height: 34,
  });
}

beforeEach(() => {
  Range.prototype.getClientRects = function () {
    return [measureRange(this)];
  };
  Range.prototype.getBoundingClientRect = function () {
    return measureRange(this);
  };
  Element.prototype.getBoundingClientRect = function () {
    const isCopy = this.getAttribute("aria-hidden") === "true";
    return box({
      left: paragraphRect.left + (isCopy ? copyOffset.x : 0),
      top: paragraphRect.top + (isCopy ? copyOffset.y : 0),
      width: 400,
      height: 34,
    });
  };
  Element.prototype.getClientRects = function () {
    if (this.tagName.toLowerCase() !== "span") {
      return [this.getBoundingClientRect()];
    }
    return [
      box({
        left: copyOffset.x + offsetInParent(this) * 10,
        top: copyOffset.y,
        width: this.textContent.length * 10,
        height: 34,
      }),
    ];
  };
});

/** The range of `word` in the first paragraph's text. */
function rangeOf(word) {
  const node = document.querySelector("p").firstChild;
  const start = node.data.indexOf(word);
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, start + word.length);
  return range;
}

const page006 =
  '<div class="page006"><p class="p1 first-letter">\n\t“Oh, my. ”\n</p></div>';

describe("a range WebKit measures as a caret", () => {
  test("is measured on a copy of its element, at its place on the page", () => {
    document.body.innerHTML = page006;
    // "\n\t“Oh, " comes before "my": 7 characters.
    expect(rangeClientRects(rangeOf("my"))).toMatchObject([
      { left: 70, top: 0, width: 20, height: 34 },
    ]);
    expect(rangeBoundingRect(rangeOf("Oh"))).toMatchObject({
      left: 30,
      top: 0,
      width: 20,
      height: 34,
    });
  });

  test("leaves the page and the range as they were", () => {
    document.body.innerHTML = page006;
    const before = document.body.innerHTML;
    const range = rangeOf("my");
    const node = range.startContainer;

    rangeClientRects(range);

    expect(document.body.innerHTML).toBe(before);
    expect(document.querySelector('[aria-hidden="true"]')).toBeNull();
    expect(range.startContainer).toBe(node);
    expect(range.startOffset).toBe(7);
    expect(range.endContainer).toBe(node);
    expect(range.endOffset).toBe(9);
  });

  test("of whitespace only is kept as WebKit measured it", () => {
    document.body.innerHTML = page006;
    const node = document.querySelector("p").firstChild;
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, 2);
    expect(rangeClientRects(range)).toEqual([caret]);
  });
});

describe("a range WebKit measures right", () => {
  test("keeps its own rects", () => {
    document.body.innerHTML = '<p class="p1">\n\t“Oh, my. ”\n</p>';
    const range = rangeOf("my");
    expect(rangeClientRects(range)).toEqual([measureRange(range)]);
    expect(rangeBoundingRect(range)).toEqual(range.getBoundingClientRect());
  });
});

describe("read aloud's mark on such a word", () => {
  const underline = {
    element: '<div class="underline"/>',
    stylesheet: ".underline { border-bottom: 2px solid; }",
    layout: "boxes",
    width: "wrap",
  };

  test("posts the word's rect, not a caret", () => {
    document.body.innerHTML = page006;
    const decorator = require("../src/decorator");
    decorator.registerTemplates({ underline });
    decorator.getDecorations("words").addEnhanced({
      id: "w1",
      style: "underline",
      element: underline.element,
      locator: {
        href: "page006.xhtml",
        type: "application/xhtml+xml",
        locations: {},
        text: { before: "\n\t“Oh, ", highlight: "my", after: ". ”\n" },
      },
      userInfo: {},
    });

    const [message] = postedMessages("decorationRect");
    expect(message.id).toBe("w1");
    expect(message.rect).toMatchObject({ width: 20, height: 34 });
  });
});
