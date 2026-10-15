//
//  Copyright 2026 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

// Characterization tests for the decoration groups (decorator.js): the read-aloud highlights are
// "enhanced" decorations, drawn into one `visible-area-<page>` container per page, and every added
// decoration answers with a `decorationRect` message — a zero rect when the word is skipped (an
// isolated page number, or a word before the visible pages).
//
// jsdom has no layout, so the rect of every range is the one set with `layoutAt`.

const underline = {
  element: '<div class="underline"/>',
  stylesheet: ".underline { border-bottom: 2px solid; }",
  layout: "boxes",
  width: "wrap",
};

const zeroRect = { left: 0, top: 0, width: 0, height: 0 };

let rect;

/** Gives every range and element the same client rect. */
function layoutAt({ left = 100, top = 300, width = 40, height = 20 } = {}) {
  rect = {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON() {
      return this;
    },
  };
}

beforeEach(() => {
  layoutAt();
  Range.prototype.getBoundingClientRect = () => rect;
  Range.prototype.getClientRects = () => [rect];
  Element.prototype.getBoundingClientRect = () => rect;
});

function loadChapter(body) {
  document.body.innerHTML = body;
  const decorator = require("../src/decorator");
  decorator.registerTemplates({ underline });
  return decorator.getDecorations("words");
}

function word(id, before, highlight, after, userInfo = {}) {
  return {
    id,
    style: "underline",
    element: underline.element,
    locator: {
      href: "chapter.xhtml",
      type: "application/xhtml+xml",
      locations: {},
      text: { before, highlight, after },
    },
    userInfo,
  };
}

function nativeRect({ left, top, width, height }) {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  };
}

const rectMessages = () => postedMessages("decorationRect");
const errorMessages = () => postedMessages("logError").map((m) => m.message);

describe("enhanced decorations", () => {
  test("a word is drawn in its page's visible area and its rect is posted", () => {
    const group = loadChapter("<p>The quick brown fox</p>");
    group.addEnhanced(word("w1", "The quick ", "brown", " fox"));

    expect(rectMessages()).toEqual([
      {
        id: "w1",
        group: "words",
        rect: nativeRect(rect),
        ocrLayout: false,
      },
    ]);
    const area = document.getElementById("visible-area-0");
    expect(area.classList.contains("visible-area")).toBe(true);
    const item = area.querySelector('[data-style="underline"]');
    expect(item.querySelector(".underline").style.left).toBe("100px");
    expect(item.querySelector(".underline").style.top).toBe("300px");
  });

  test("a word on the second page goes into the second page's area", () => {
    const group = loadChapter("<p>The quick brown fox</p>");
    layoutAt({ left: window.innerWidth + 100 });
    group.addEnhanced(word("w1", "The quick ", "brown", " fox"));
    expect(document.getElementById("visible-area-1")).not.toBeNull();
    expect(
      document.getElementById("visible-area-1").querySelector(".underline")
        .style.left
    ).toBe("100px");
  });

  test("a word before the visible pages is skipped with a zero rect", () => {
    const group = loadChapter("<p>The quick brown fox</p>");
    layoutAt({ left: -500 });
    group.addEnhanced(word("w1", "The quick ", "brown", " fox"));
    expect(rectMessages()).toEqual([
      { id: "w1", group: "words", rect: zeroRect, ocrLayout: false },
    ]);
    expect(errorMessages()).toContain("fallback to invalid rect");
  });

  test("shoulNotBeIgnored draws a word before the visible pages", () => {
    const group = loadChapter("<p>The quick brown fox</p>");
    layoutAt({ left: -500 });
    group.addEnhanced(
      word("w1", "The quick ", "brown", " fox", { shoulNotBeIgnored: true })
    );
    expect(rectMessages()[0].rect).toEqual(nativeRect(rect));
  });

  test("today: a decoration without userInfo is skipped with a zero rect", () => {
    const group = loadChapter("<p>The quick brown fox</p>");
    const decoration = word("w1", "The quick ", "brown", " fox");
    delete decoration.userInfo;
    group.addEnhanced(decoration);
    expect(rectMessages()).toEqual([
      { id: "w1", group: "words", rect: zeroRect, ocrLayout: false },
    ]);
  });

  test("a word that cannot be found posts nothing", () => {
    const group = loadChapter("<p>The quick brown fox</p>");
    group.addEnhanced(word("w1", "", "zzzzzzzz", ""));
    expect(rectMessages()).toEqual([]);
  });

  test("an unknown style posts nothing", () => {
    const group = loadChapter("<p>The quick brown fox</p>");
    group.addEnhanced({ ...word("w1", "", "brown", ""), style: "nope" });
    expect(rectMessages()).toEqual([]);
    expect(errorMessages()).toContain("Unknown decoration style: nope");
  });

  test("clearEnhanced removes one word, clearAllEnhanced every page area", () => {
    const group = loadChapter("<p>The quick brown fox</p>");
    group.addEnhanced(word("w1", "The ", "quick", " brown"));
    group.addEnhanced(word("w2", "quick ", "brown", " fox"));
    const area = document.getElementById("visible-area-0");
    expect(area.children.length).toBe(2);

    group.clearEnhanced("w1");
    expect(area.children.length).toBe(1);

    group.clearAllEnhanced();
    expect(document.getElementById("visible-area-0")).toBeNull();
  });

  test("requestLayout redraws a word that is now before the visible pages, without posting again", () => {
    const group = loadChapter("<p>The quick brown fox</p>");
    group.addEnhanced(word("w1", "The quick ", "brown", " fox"));
    layoutAt({ left: -500 });
    group.requestLayout();
    expect(rectMessages().length).toBe(1);
    expect(document.querySelectorAll(".underline").length).toBe(1);
  });
});

describe("page numbers", () => {
  // A number alone at the top or bottom of the text is a printed page number, not a word to read:
  // it gets a zero rect so the app skips it.
  function isSkipped(body, before, highlight, after, top) {
    const group = loadChapter(body);
    layoutAt({ top });
    group.addEnhanced(word("n", before, highlight, after));
    return rectMessages()[0].rect.width === 0;
  }

  const atTop = 10;
  const atBottom = window.innerHeight - 20;
  const inTheMiddle = 300;

  test("an isolated number at the top is skipped", () => {
    expect(
      isSkipped(
        "<p>the end.</p><p>12</p><p>Next part</p>",
        "the end.\n",
        "12",
        "\nNext part",
        atTop
      )
    ).toBe(true);
    expect(loggedMessages()).toContain("PAGE NUMBER :: is isolated: 12");
  });

  test("an isolated number at the bottom is skipped", () => {
    expect(
      isSkipped("<p>the end.</p><p>12</p>", "the end.\n", "12", "", atBottom)
    ).toBe(true);
  });

  test("an isolated number in the middle of the page is read", () => {
    expect(
      isSkipped(
        "<p>the end.</p><p>12</p><p>Next part</p>",
        "the end.\n",
        "12",
        "\nNext part",
        inTheMiddle
      )
    ).toBe(false);
  });

  test('a number after a word ("Chapter 12") is read', () => {
    expect(
      isSkipped(
        "<p>Chapter 12</p><p>It was</p>",
        "Chapter ",
        "12",
        "\nIt was",
        atTop
      )
    ).toBe(false);
  });

  test('a number completing a time ("8:30") is read', () => {
    expect(isSkipped("<p>at 8:30 in</p>", "at 8:", "30", " in", atTop)).toBe(
      false
    );
  });

  test("a number inside a sentence is read", () => {
    expect(
      isSkipped("<p>she had 12 cats</p>", "she had ", "12", " cats", atTop)
    ).toBe(false);
  });

  test("a word that is not only digits is never treated as a page number", () => {
    expect(
      isSkipped(
        "<p>the end.</p><p>XII</p><p>Next part</p>",
        "the end.\n",
        "XII",
        "\nNext part",
        atTop
      )
    ).toBe(false);
  });
});

describe("plain decorations", () => {
  test("a non-enhanced decoration is drawn in the group container and posts its rect", () => {
    const group = loadChapter("<p>The quick brown fox</p>");
    group.add(word("s1", "The quick ", "brown", " fox"));
    expect(rectMessages()).toEqual([
      {
        id: "s1",
        group: "words",
        rect: nativeRect(rect),
        ocrLayout: false,
      },
    ]);
    expect(group.items.map((item) => item.enhanced)).toEqual([false]);
  });

  test("remove drops the decoration", () => {
    const group = loadChapter("<p>The quick brown fox</p>");
    group.add(word("s1", "The quick ", "brown", " fox"));
    group.remove("s1");
    expect(group.items).toEqual([]);
  });
});
