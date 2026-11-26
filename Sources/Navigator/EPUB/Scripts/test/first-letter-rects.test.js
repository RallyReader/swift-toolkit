//
//  Copyright 2026 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

// Rally (RR-6184, RR-9798, RR-9799, RR-9800, RR-9855): measuring and selecting a range in the text of a
// `::first-letter` drop cap.
//
// WebKit before iOS 27 measures every range in the text node that holds a paragraph's first letter
// one letter too far along, and never reports the letter's own box ("Mindy Kim and the Big Sibling
// Plan", 9781665935838: `p.ot::first-letter { font-size: 2.4em; line-height: 0em; }`). Read aloud's
// underline for "My" was drawn under "y " and the start of "name". Such a range is measured on a
// hidden copy of the paragraph, where a span around the text measures right.
//
// jsdom has no layout, so the stubs below play WebKit: every character 10 px wide, a `.drop`
// paragraph's first letter styled by `::first-letter`. `webKitShifts` picks the WebKit: before iOS 27
// a range in the first letter's text node lies one letter further along (the hidden "Wi" line that
// detects it too); iOS 27 draws the first letter 66 px tall from 30 px above the line (a `.float` one 102 px tall from the line's top). The copy lies
// 40 px lower and 5 px to the right of the paragraph, so its rects must be moved back.

const copyOffset = { x: 5, y: 40 };
let webKitShifts;
let rect;

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

/** The `.drop` paragraph or the probe line whose first letter `node` holds, or null. */
function firstLetterHolder(node) {
  const holder = node.parentElement.closest(
    ".drop, .readium-rally-first-letter-probe"
  );
  if (!holder) {
    return null;
  }
  const walker = document.createTreeWalker(holder, NodeFilter.SHOW_TEXT);
  return walker.nextNode() === node ? holder : null;
}

function measureRange(range) {
  const node = range.startContainer;
  const { startOffset: start, endOffset: end } = range;
  const holder = firstLetterHolder(node);
  if (holder && webKitShifts) {
    return [
      box({
        left: (start + 1) * 10,
        top: 0,
        width: (end - start) * 10,
        height: 34,
      }),
    ];
  }
  if (holder && start === 0) {
    // A `.float` paragraph's drop cap hangs down beside three lines.
    const floated = holder.classList.contains("float");
    return [
      floated
        ? box({ left: 0, top: 0, width: 10, height: 102 })
        : box({ left: 0, top: -30, width: 10, height: 66 }),
      ...(end > 1
        ? [box({ left: 10, top: 0, width: (end - 1) * 10, height: 34 })]
        : []),
    ];
  }
  return [
    box({ left: start * 10, top: 0, width: (end - start) * 10, height: 34 }),
  ];
}

/** The drawn characters before `element` in its hidden copy of a paragraph. */
function offsetInCopy(element) {
  const copy = element.closest('[aria-hidden="true"]');
  const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
  let offset = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (element.contains(node)) {
      return offset;
    }
    if (/\S/.test(node.data)) {
      offset += node.data.length; // whitespace between elements is not drawn
    }
  }
  return offset;
}

const realGetComputedStyle = window.getComputedStyle;

beforeEach(() => {
  jest.resetModules();
  rect = require("../src/rect");
  webKitShifts = true;

  Range.prototype.getClientRects = function () {
    return measureRange(this);
  };
  Range.prototype.getBoundingClientRect = function () {
    const rects = measureRange(this);
    const left = Math.min(...rects.map((r) => r.left));
    const top = Math.min(...rects.map((r) => r.top));
    const right = Math.max(...rects.map((r) => r.right));
    const bottom = Math.max(...rects.map((r) => r.bottom));
    return box({ left, top, width: right - left, height: bottom - top });
  };
  Element.prototype.getBoundingClientRect = function () {
    if (this.style.float === "left" && this.closest('[aria-hidden="true"]')) {
      // The span standing in for a floated first letter on a copy (RR-9798).
      return box({
        left: copyOffset.x,
        top: copyOffset.y,
        width: 10,
        height: 102,
      });
    }
    const isCopy = this.getAttribute("aria-hidden") === "true";
    return box({
      left: isCopy ? copyOffset.x : 0,
      top: isCopy ? copyOffset.y : 0,
      width: 400,
      height: 34,
    });
  };
  Element.prototype.getClientRects = function () {
    if (
      this.tagName.toLowerCase() !== "span" ||
      !this.closest('[aria-hidden="true"]')
    ) {
      return [this.getBoundingClientRect()];
    }
    return [
      box({
        left: copyOffset.x + offsetInCopy(this) * 10,
        top: copyOffset.y,
        width: this.textContent.length * 10,
        height: 34,
      }),
    ];
  };
  window.getComputedStyle = (element, pseudo) => {
    const style = realGetComputedStyle(element);
    if (pseudo === "::first-letter" && element.classList.contains("drop")) {
      return {
        ...style,
        display: style.display,
        fontSize: "48px",
        float: element.classList.contains("float") ? "left" : "none",
      };
    }
    return style;
  };
  global.getComputedStyle = window.getComputedStyle;
});

afterEach(() => {
  window.getComputedStyle = realGetComputedStyle;
  global.getComputedStyle = realGetComputedStyle;
});

/** The range of `word` in the text node of `selector` that holds it. */
function rangeOf(word, selector = "p") {
  const walker = document.createTreeWalker(
    document.querySelector(selector),
    NodeFilter.SHOW_TEXT
  );
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const start = node.data.indexOf(word);
    if (start !== -1) {
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + word.length);
      return range;
    }
  }
  throw new Error(`no "${word}"`);
}

describe("before iOS 27, a word in a drop cap's text", () => {
  test("is measured on a copy of its paragraph, at its place on the page", () => {
    document.body.innerHTML = '<p class="drop">My name is Mindy Kim.</p>';
    expect(rect.rangeClientRects(rangeOf("My"))).toMatchObject([
      { left: 0, top: 0, width: 20, height: 34 },
    ]);
    expect(rect.rangeBoundingRect(rangeOf("My"))).toMatchObject({
      left: 0,
      width: 20,
    });
    expect(rect.rangeClientRects(rangeOf("name"))).toMatchObject([
      { left: 30, top: 0, width: 40, height: 34 },
    ]);
  });

  test("is found through the inline elements that hold it", () => {
    document.body.innerHTML =
      '<p class="drop">\n  <span><b>My</b> name</span> is</p>';
    expect(rect.rangeClientRects(rangeOf("My"))).toMatchObject([
      { left: 0, width: 20 },
    ]);
  });

  test("is read aloud with its underline under it", () => {
    document.body.innerHTML = '<p class="drop">My name is Mindy Kim.</p>';
    expect(rect.getClientRectsNoOverlap(rangeOf("My"), true)).toMatchObject([
      { left: 0, width: 20 },
    ]);
  });

  test("leaves the page and the range as they were", () => {
    document.head.innerHTML = "<title>chapter</title>";
    document.body.innerHTML = '<p class="drop">My name is Mindy Kim.</p>';
    const head = document.head.innerHTML;
    const body = document.body.innerHTML;
    const range = rangeOf("name");
    const node = range.startContainer;

    rect.rangeClientRects(range);

    expect(document.head.innerHTML).toBe(head);
    expect(document.body.innerHTML).toBe(body);
    expect(range.startContainer).toBe(node);
    expect(range.startOffset).toBe(3);
    expect(range.endOffset).toBe(7);
  });
});

describe("before iOS 27, a word WebKit measures right", () => {
  test("after an inline element of a drop cap's paragraph keeps its own rects", () => {
    document.body.innerHTML =
      '<p class="drop">My name is <i>Mindy</i> Kim.</p>';
    const range = rangeOf("Kim");
    expect(rect.rangeClientRects(range)).toEqual(measureRange(range));
  });

  test("in a paragraph without a first-letter style keeps its own rects", () => {
    document.body.innerHTML = "<p>My name is Mindy Kim.</p>";
    const range = rangeOf("name");
    expect(rect.rangeClientRects(range)).toEqual(measureRange(range));
  });
});

describe("from iOS 27, a word in a drop cap's text", () => {
  beforeEach(() => {
    webKitShifts = false;
  });

  test("is drawn on its line, the drop cap's box too", () => {
    document.body.innerHTML = '<p class="drop">My name is Mindy Kim.</p>';
    expect(rect.rangeClientRects(rangeOf("My"))).toMatchObject([
      { left: 0, top: 0, width: 10, height: 34 },
      { left: 10, top: 0, width: 10, height: 34 },
    ]);
    expect(rect.rangeBoundingRect(rangeOf("My"))).toMatchObject({
      left: 0,
      top: 0,
      width: 20,
      height: 34,
    });
  });

  test("is underlined once, at its line's bottom", () => {
    document.body.innerHTML = '<p class="drop">My name is Mindy Kim.</p>';
    expect(rect.getClientRectsNoOverlap(rangeOf("My"), true)).toMatchObject([
      { left: 0, top: 0, width: 20, height: 34 },
    ]);
  });

  test("keeps a drop cap floated down beside several lines", () => {
    document.body.innerHTML = '<p class="drop float">My name is Mindy Kim.</p>';
    const range = rangeOf("My");
    expect(rect.rangeClientRects(range)).toEqual(measureRange(range));
  });

  test("past the drop cap keeps its rects, measured on no copy", () => {
    document.body.innerHTML = '<p class="drop">My name is Mindy Kim.</p>';
    const insertBefore = jest.spyOn(Node.prototype, "insertBefore");
    const range = rangeOf("name");
    expect(rect.rangeClientRects(range)).toEqual(measureRange(range));
    expect(insertBefore).not.toHaveBeenCalled();
    insertBefore.mockRestore();
  });
});

// Rally (RR-9798): a span never includes a floated first letter's box, so the copy draws the letter
// with a span of its own, floated like the letter.
describe("before iOS 27, a word with a floated drop cap", () => {
  test("is measured with the drop cap's box first", () => {
    document.body.innerHTML = '<p class="drop float">Once upon a time.</p>';
    expect(rect.rangeClientRects(rangeOf("Once"))).toMatchObject([
      { left: 0, top: 0, width: 10, height: 102 },
      { left: 10, top: 0, width: 30, height: 34 },
    ]);
  });

  test("leaves the page as it was, its first-letter rule too", () => {
    document.head.innerHTML = "<title>chapter</title>";
    document.body.innerHTML = '<p class="drop float">Once upon a time.</p>';
    const head = document.head.innerHTML;
    const body = document.body.innerHTML;

    rect.rangeClientRects(rangeOf("Once"));

    expect(document.head.innerHTML).toBe(head);
    expect(document.body.innerHTML).toBe(body);
  });

  test("past the drop cap is measured as before", () => {
    document.body.innerHTML = '<p class="drop float">Once upon a time.</p>';
    expect(rect.rangeClientRects(rangeOf("upon"))).toMatchObject([
      { left: 50, top: 0, width: 40, height: 34 },
    ]);
  });
});

// Rally (RR-9799): a word that is only the drop cap takes its line from the character after it.
describe("from iOS 27, a one-letter word drawn as a drop cap", () => {
  beforeEach(() => {
    webKitShifts = false;
  });

  test("is drawn on its line", () => {
    document.body.innerHTML = '<p class="drop">I had everything.</p>';
    expect(rect.rangeClientRects(rangeOf("I"))).toMatchObject([
      { left: 0, top: 0, width: 10, height: 34 },
    ]);
  });

  test("alone in its paragraph keeps its box", () => {
    document.body.innerHTML = '<p class="drop">I</p>';
    const range = rangeOf("I");
    expect(rect.rangeClientRects(range)).toEqual(measureRange(range));
  });
});

// Rally (RR-9800): the selection's rect, which the app places the selection menu from. Before
// iOS 27, a selection made in a drop cap's text holds a range one letter early (" nam" with "name"
// highlighted: WebKit maps what is drawn to the text by the same mistake it measures with), so
// WebKit's own rect for it is where the highlight is drawn, and measuring the range right is not.
describe("the selection's rect", () => {
  function selectionRect(range) {
    global.readium = { link: { href: "chapter.xhtml" } };
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return require("../src/selection").getCurrentSelectionLazy().rect;
  }

  afterEach(() => {
    delete global.readium;
  });

  test("before iOS 27, in a drop cap's text, is where WebKit draws the selection", () => {
    document.body.innerHTML = '<p class="drop">My name is Mindy Kim.</p>';
    // "name" is drawn at 30 px; the selection WebKit makes over it holds " nam".
    expect(selectionRect(rangeOf(" nam"))).toMatchObject({
      left: 30,
      width: 40,
    });
  });

  test("elsewhere is WebKit's", () => {
    document.body.innerHTML = "<p>My name is Mindy Kim.</p>";
    expect(selectionRect(rangeOf("name"))).toMatchObject({
      left: 30,
      width: 40,
    });
  });
});

// Rally: the text the reader gets around a selection (its locator's `before` and `after`, which Start
// Here goes to) is taken from where the selection really is, not from its offsets a letter early.
describe("the selection's text", () => {
  function selectionText(range) {
    global.readium = { link: { href: "chapter.xhtml" } };
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return require("../src/selection").getCurrentSelection().text;
  }

  afterEach(() => {
    delete global.readium;
  });

  test("before iOS 27, in a drop cap's text, is around the word highlighted", () => {
    document.body.innerHTML = '<p class="drop">My name is Mindy Kim.</p>';
    const text = selectionText(rangeOf(" nam"));
    expect(text.highlight).toBe("name");
    expect(text.before).toBe("My ");
    expect(text.after.startsWith(" is Mindy")).toBe(true);
  });

  test("before iOS 27, a selection from the drop cap holds it", () => {
    document.body.innerHTML = '<p class="drop">My name is Mindy Kim.</p>';
    const text = selectionText(rangeOf("M"));
    expect(text.highlight).toBe("My");
    expect(text.after.startsWith(" name")).toBe(true);
  });

  test("from iOS 27, is around the selection's own range", () => {
    webKitShifts = false;
    document.body.innerHTML = '<p class="drop">My name is Mindy Kim.</p>';
    const text = selectionText(rangeOf("name"));
    expect(text.highlight).toBe("name");
    expect(text.before).toBe("My ");
  });
});

// Rally (RR-9855): a long press in a drop cap's text made WebKit select from the page's first drop-cap
// paragraph to the pressed point. The pressed word is selected in its place, in WebKit's offsets.
describe("a long press in a drop cap's text", () => {
  const pageHTML =
    '<p class="drop">I had everything.</p>' +
    '<p class="drop" id="second">My name is Mindy Kim.</p>';

  function longPress(caretOffset, selected) {
    const node = document.querySelector("#second").firstChild;
    document.caretRangeFromPoint = () => {
      const caret = document.createRange();
      caret.setStart(node, caretOffset);
      return caret;
    };
    const {
      notePress,
      correctLongPressSelection,
    } = require("../src/first-letter-selection");
    notePress(100, 200, false, 0);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(selected());
    const corrected = correctLongPressSelection(selection, 1000);
    const range = selection.getRangeAt(0);
    return {
      corrected,
      node: range.startContainer === node && range.endContainer === node,
      offsets: [range.startOffset, range.endOffset],
    };
  }

  /** WebKit's selection: from "had" in the first paragraph to `end` in the second. */
  function acrossParagraphs(end) {
    return () => {
      const range = document.createRange();
      range.setStart(document.querySelector("p").firstChild, 2);
      range.setEnd(document.querySelector("#second").firstChild, end);
      return range;
    };
  }

  beforeEach(() => {
    document.body.innerHTML = pageHTML;
  });

  afterEach(() => {
    delete document.caretRangeFromPoint;
  });

  test("from iOS 27, selects the pressed word", () => {
    webKitShifts = false;
    // The caret is right: "na|me".
    expect(longPress(5, acrossParagraphs(5))).toEqual({
      corrected: true,
      node: true,
      offsets: [3, 7],
    });
  });

  test("before iOS 27, selects the pressed word in WebKit's offsets", () => {
    // The caret is a letter early, and so is the selection of "name": 2 to 6.
    expect(longPress(4, acrossParagraphs(0))).toEqual({
      corrected: true,
      node: true,
      offsets: [2, 6],
    });
  });

  test("before iOS 27, on the drop cap selects its word", () => {
    // 0 to 1 is "My" before iOS 27.
    expect(longPress(0, acrossParagraphs(0))).toEqual({
      corrected: true,
      node: true,
      offsets: [0, 1],
    });
  });

  test("leaves a selection within the pressed text as WebKit made it", () => {
    const own = () => {
      const range = document.createRange();
      const node = document.querySelector("#second").firstChild;
      range.setStart(node, 2);
      range.setEnd(node, 6);
      return range;
    };
    expect(longPress(4, own)).toEqual({
      corrected: false,
      node: true,
      offsets: [2, 6],
    });
  });

  test("leaves a selection made long after the press", () => {
    const node = document.querySelector("#second").firstChild;
    document.caretRangeFromPoint = () => {
      const caret = document.createRange();
      caret.setStart(node, 4);
      return caret;
    };
    const {
      notePress,
      correctLongPressSelection,
    } = require("../src/first-letter-selection");
    notePress(100, 200, false, 0);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(acrossParagraphs(0)());
    expect(correctLongPressSelection(selection, 10000)).toBe(false);
  });
});

describe("the word at a caret", () => {
  test("takes letters and apostrophes, not punctuation", () => {
    const { wordAt } = require("../src/first-letter-selection");
    const text = "My name is Kim, Mindy's.";
    expect(wordAt(text, 13)).toEqual({ start: 11, end: 14 }); // "Kim"
    expect(wordAt(text, 14)).toEqual({ start: 11, end: 14 }); // just after it
    expect(wordAt(text, 18)).toEqual({ start: 16, end: 23 }); // "Mindy's"
    expect(wordAt(text, 15)).toBeNull(); // the space after the comma
  });
});

// Rally: the read-aloud range of a paragraph's last word runs to the whitespace after the paragraph.
describe("a range ending at the next node", () => {
  test("before iOS 27, a drop cap paragraph's last word is measured where it is drawn", () => {
    document.body.innerHTML =
      '<p class="drop">My name is Kim.</p>\n<p>Next</p>';
    const word = rangeOf("Kim.");
    const range = document.createRange();
    range.setStart(word.startContainer, word.startOffset);
    range.setEnd(document.body.childNodes[1], 0);
    const plain = (value) => JSON.parse(JSON.stringify(value));
    expect(plain(rect.rangeClientRects(range))).toEqual(
      plain(rect.rangeClientRects(word))
    );
    expect(plain(rect.rangeBoundingRect(range))).toEqual(
      plain(rect.rangeBoundingRect(word))
    );
    expect(plain(rect.rangeClientRects(word))[0].left).toBe(110); // "Kim." as drawn
  });
});
