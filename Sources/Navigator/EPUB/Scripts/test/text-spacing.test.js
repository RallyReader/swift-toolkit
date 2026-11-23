//
//  Copyright 2026 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

// Characterization tests for `processSpansForTextSpacing` (decorator.js), which `registerTemplates`
// runs on every chapter. It rewrites the DOM so that `document.body.textContent` matches the text the
// app's Swift `Parser` extracts: every `start`/`end` hint sent with a decoration is an offset into that
// text. These tests pin today's behaviour, including the surprising parts (marked "today"); a change to
// any of them changes where read-aloud highlights land.

function registerTemplates(body) {
  document.body.innerHTML = body;
  // A new page loads the scripts again: the text is prepared once per page.
  jest.resetModules();
  require("../src/decorator").registerTemplates({});
  return document.body.textContent;
}

describe("HTML entities", () => {
  test("&amp;, &lt; and &gt; stay escaped in the markup, so the text preparation still runs (RR-9067)", () => {
    expect(
      registerTemplates("<p>Tom &amp; Jerry &lt;3 &gt;</p><p>two</p>")
    ).toBe("Tom & Jerry <3 >\ntwo");
  });

  test("a non-breaking space stays a U+00A0 character (the &nbsp; mapping never matches XML serialization)", () => {
    expect(registerTemplates("<p>a b</p>")).toBe("a b");
  });

  test("curly quotes and dashes are kept as characters", () => {
    expect(registerTemplates("<p>‘it’s’ “so” – —</p>")).toBe("‘it’s’ “so” – —");
  });
});

describe("ligatures", () => {
  test.each([
    ["ﬀ", "ff"],
    ["ﬁ", "fi"],
    ["ﬂ", "fl"],
    ["ﬃ", "ffi"],
    ["ﬄ", "ffl"],
    ["ﬅ", "st"],
    ["ﬆ", "st"],
    ["Ĳ", "IJ"],
    ["ĳ", "ij"],
    ["Œ", "OE"],
    ["œ", "oe"],
  ])("%s becomes %s", (ligature, letters) => {
    expect(registerTemplates(`<p>a${ligature}b</p>`)).toBe(`a${letters}b`);
  });
});

describe("line breaks", () => {
  test("a newline is inserted after every <br/>", () => {
    expect(registerTemplates("<p>one<br/>two</p>")).toBe("one\ntwo");
    expect(document.querySelectorAll("br")).toHaveLength(1);
  });

  test("registering the templates again adds no second newline (RR-9685)", () => {
    document.body.innerHTML = "<p>one<br/>two</p><p>three</p>";
    const decorator = require("../src/decorator");
    decorator.registerTemplates({});
    decorator.registerTemplates({});
    expect(document.body.textContent).toBe("one\ntwo\nthree");
  });

  test("a <br> with attributes gets its newline too", () => {
    expect(registerTemplates('<p>one<br class="x"/>two</p>')).toBe("one\ntwo");
  });

  test("consecutive <br> get one newline each", () => {
    expect(registerTemplates("<p>one<br/><br/>two</p>")).toBe("one\n\ntwo");
  });

  test("a <br> before a <div> or <p> gets one newline, not one more for the block", () => {
    expect(registerTemplates("<div>one<br/><div>two</div></div>")).toBe(
      "one\ntwo"
    );
    expect(registerTemplates("<div>one<br/><p>two</p></div>")).toBe("one\ntwo");
  });

  test("the newline joins the text of the next line, as the innerHTML rewrite left it", () => {
    registerTemplates("<p>one<br/>two</p>");
    expect(document.querySelector("br").nextSibling.nodeValue).toBe("\ntwo");
  });

  test("where newlines are drawn, the newline replaces the <br>, so the line breaks once", () => {
    // jsdom doesn't inherit white-space, so the style is on the <br> itself. ReadiumScriptsTests
    // covers pre text boxes in WebKit.
    expect(
      registerTemplates('<p>one<br style="white-space: pre"/>two</p>')
    ).toBe("one\ntwo");
    expect(document.querySelectorAll("br")).toHaveLength(0);
  });

  test("a newline is inserted before a <p> or <div> that does not follow one", () => {
    expect(registerTemplates("<p>one</p><p>two</p><div>three</div>")).toBe(
      "one\ntwo\nthree"
    );
  });

  test("no second newline is inserted when one is already there", () => {
    expect(registerTemplates("<p>one</p>\n<p>two</p>")).toBe("one\ntwo");
  });

  test("other block elements get no newline", () => {
    expect(registerTemplates("<h1>Title</h1><section>Text</section>")).toBe(
      "TitleText"
    );
  });
});

describe("fragment spacing (RR-6094)", () => {
  // PDF conversions draw every text fragment as its own positioned element. A zero-size space is
  // inserted where two DOM-adjacent fragments are drawn apart; the decision itself is covered with
  // measured values in text-geometry-spacing.test.js. jsdom has no layout, so each element's text is
  // drawn at its `data-box` ("top bottom left right").
  let getClientRects;
  beforeEach(() => {
    getClientRects = Range.prototype.getClientRects;
    Range.prototype.getClientRects = function () {
      const box = this.startContainer.parentElement?.dataset.box;
      if (!box) {
        return [];
      }
      const [top, bottom, left, right] = box.split(" ").map(Number);
      return [
        { top, bottom, left, right, width: right - left, height: bottom - top },
      ];
    };
  });
  afterEach(() => {
    Range.prototype.getClientRects = getClientRects;
  });

  const fragment = (text, box) => `<span data-box="${box}">${text}</span>`;

  test("fragments of one word, kerned on one line, stay together", () => {
    expect(
      registerTemplates(
        `<div>${fragment("A", "0 20 0 10")}${fragment(
          "rt",
          "0 20 11 25"
        )}</div>`
      )
    ).toBe("Art");
  });

  test("a fragment after a word-size gap on the same line starts a new word", () => {
    expect(
      registerTemplates(
        `<div>${fragment("Art", "0 20 0 25")}${fragment(
          "is",
          "0 20 33 45"
        )}</div>`
      )
    ).toBe("Art is");
  });

  test("a fragment on the next line starts a new word", () => {
    expect(
      registerTemplates(
        `<div>${fragment("end", "0 20 300 330")}${fragment(
          "start",
          "30 50 0 40"
        )}</div>`
      )
    ).toBe("end start");
  });

  test("the space is a zero-size element outside the next word's element", () => {
    registerTemplates(
      `<div><span>${fragment("end", "0 20 300 330")}</span><span>${fragment(
        "start",
        "30 50 0 40"
      )}</span></div>`
    );
    const space = document.querySelector("div").children[1];
    expect(space.textContent).toBe(" ");
    expect(space.style.fontSize).toBe("0px");
    expect(space.nextElementSibling.textContent).toBe("start");
  });

  test("text that is not drawn gets no space", () => {
    expect(
      registerTemplates('<p id="p"><span>one</span><span>two</span></p>')
    ).toBe("onetwo");
  });
});

describe("glyphs split by whitespace the page does not draw (RR-6140)", () => {
  // Curved and bouncing words drawn one glyph per element, with a newline between the elements in
  // the markup: SVG <text> elements (9781338747836) or <p> elements (9781626725126). jsdom has no
  // layout, so each element's text is drawn at its `data-box` ("top bottom left right"), and text
  // without one (the whitespace between the elements) is not drawn.
  let getClientRects;
  beforeEach(() => {
    getClientRects = Range.prototype.getClientRects;
    Range.prototype.getClientRects = function () {
      const box = this.startContainer.parentElement?.dataset?.box;
      if (!box) {
        return [];
      }
      const [top, bottom, left, right] = box.split(" ").map(Number);
      return [
        { top, bottom, left, right, width: right - left, height: bottom - top },
      ];
    };
  });
  afterEach(() => {
    Range.prototype.getClientRects = getClientRects;
  });

  const block = (text, box) => `<p data-box="${box}">${text}</p>`;
  const glyph = (text, box) => `<text data-box="${box}">${text}</text>`;
  const svg = (content) =>
    `<svg xmlns="http://www.w3.org/2000/svg" xml:space="preserve">${content}</svg>`;

  test("letters in blocks of their own, drawn as one word, read as one word", () => {
    expect(
      registerTemplates(
        `<div>${block("r", "488 586 208 251")}\n${block(
          "u",
          "491 591 244 301"
        )}\n${block("n", "490 592 289 351")}</div>`
      ).trim()
    ).toBe("run");
  });

  test("two-letter pieces drawn as one word read as one word", () => {
    expect(
      registerTemplates(
        `<div>${block("ju", "570 665 406 496")}\n${block(
          "m",
          "568 672 490 581"
        )}\n${block("p", "587 695 555 639")}</div>`
      ).trim()
    ).toBe("jump");
  });

  test("SVG letters read as words, split where a space is drawn", () => {
    expect(
      registerTemplates(
        svg(
          `\n${glyph("g", "0 30 0 15")}\n${glyph("o", "0 30 15 30")}\n${glyph(
            " ",
            "0 30 30 38"
          )}\n${glyph("u", "0 30 38 53")}\n${glyph("p", "0 30 53 68")}\n`
        )
      ).trim()
    ).toBe("go\n \nup");
  });

  test("SVG letters split by more than one undrawn whitespace node read as one word (RR-9729)", () => {
    // 9781465411020 p.8: the first letter of the upper "ribbit!" is the only one in a <g>, so the
    // newline inside the group and the one after it both separate "r" from "i". Boxes measured in
    // WebKit on that page.
    expect(
      registerTemplates(
        svg(
          `<g>\n\t\n\t\t${glyph("r", "545 600 107 163")}\n</g>\n${glyph(
            "i",
            "560 614 124 175"
          )}\n${glyph("b", "569 634 138 196")}\n${glyph(
            "b",
            "583 649 165 217"
          )}\n${glyph("i", "595 655 195 229")}\n${glyph(
            "t",
            "600 661 212 244"
          )}\n${glyph("!", "604 665 231 258")}\n`
        )
      ).trim()
    ).toBe("ribbit!");
  });

  test("letters with a drawn space among the whitespace between them stay apart", () => {
    expect(
      registerTemplates(
        svg(
          `${glyph("g", "0 30 0 15")}\n<g>${glyph(" ", "0 30 15 23")}</g>\n${glyph(
            "o",
            "0 30 23 38"
          )}`
        )
      )
    ).toBe("g\n \no");
  });

  test("a space drawn as an SVG text element of its own separates words even with no width", () => {
    // 9781338747836's curved title draws its word spaces as `<text> </text>`, which WebKit gives
    // no width; "Rumble" and "tumble" must stay two words.
    expect(
      registerTemplates(
        svg(
          `${glyph("e", "0 30 15 30")}\n${glyph(" ", "0 30 30 30")}\n${glyph(
            "t",
            "0 30 31 40"
          )}`
        )
      )
    ).toBe("e\n \nt");
  });

  test("SVG letters on the next line start a new word", () => {
    expect(
      registerTemplates(
        svg(
          `${glyph("o", "0 30 268 283")}\n${glyph(
            ".",
            "0 30 283 290"
          )}\n${glyph("D", "40 64 17 35")}\n${glyph("a", "40 64 36 48")}`
        )
      )
    ).toBe("o.\nDa");
  });

  test("letters with a word gap between them stay apart", () => {
    expect(
      registerTemplates(
        `<div>${block("a", "0 100 0 50")}\n${block("I", "0 100 80 100")}</div>`
      )
    ).toBe("\na\nI");
  });

  test("whole words in blocks of their own stay apart, however close", () => {
    expect(
      registerTemplates(
        `<div>${block("Big", "0 100 0 150")}\n${block(
          "and",
          "0 100 150 300"
        )}</div>`
      )
    ).toBe("\nBig\nand");
  });

  test("short words in OCR overlays stay apart, however close", () => {
    const overlay = (text, box) =>
      `<div class="text-overlay" data-box="${box}">${text}</div>`;
    expect(
      registerTemplates(
        `<div class="ocr-container">${overlay("to", "0 100 0 60")}\n${overlay(
          "be",
          "0 100 30 90"
        )}</div>`
      )
    ).toBe("\nto\nbe");
  });

  test("letters separated by a <br> stay apart", () => {
    expect(
      registerTemplates(
        `<div><span data-box="0 100 0 50">a</span><br/><span data-box="0 100 50 100">b</span></div>`
      )
    ).toBe("a\nb");
  });

  test("letters separated by a <br> and a newline stay apart", () => {
    expect(
      registerTemplates(
        `<div><span data-box="0 100 0 50">a</span><br/>\n<span data-box="0 100 50 100">b</span></div>`
      )
    ).toBe("a\n\nb");
  });

  test("whitespace that is drawn stays", () => {
    expect(
      registerTemplates(
        `<div data-box="0 100 0 100"><span data-box="0 100 0 50">a</span> <span data-box="0 100 50 100">b</span></div>`
      )
    ).toBe("a b");
  });

  test("whitespace in text that keeps its newlines stays", () => {
    expect(
      registerTemplates(
        `<div style="white-space: pre"><span data-box="0 100 0 50">a</span>\n<span data-box="0 100 50 100">b</span></div>`
      )
    ).toBe("a\nb");
  });
});

describe("the navigator's virtual columns (utils.js)", () => {
  // The end of 9780061858109 chapter 5 (an XHTML page: no whitespace after
  // the last </div> in the body).
  const chapterEnd =
    '<div class="chapter"><div class="body"><p>“Then what are we waiting for?” said Zeke.</p>\n</div></div>';

  // As `appendVirtualColumnIfNeeded` adds one on a two-column screen with an
  // odd column count. jsdom lays nothing out, so it is added by hand.
  function appendVirtualColumn() {
    const column = document.createElement("div");
    column.setAttribute("id", "readium-virtual-page");
    column.classList.add("readium-virtual-column");
    column.style.breakBefore = "column";
    column.innerHTML = "&#8203;";
    document.body.appendChild(column);
  }

  test("the text is the same whether the column was added before or after the text preparation", () => {
    document.body.innerHTML = chapterEnd;
    require("../src/decorator").registerTemplates({});
    appendVirtualColumn();
    const columnAfter = document.body.textContent;

    // A second page: it loads the scripts again (the text is prepared once
    // per page, RR-9685).
    jest.resetModules();
    document.body.innerHTML = chapterEnd;
    appendVirtualColumn();
    require("../src/decorator").registerTemplates({});
    const columnBefore = document.body.textContent;

    // It used to end in "\n\n\u200B" when the column was already there: the
    // <div>/<p> rewrite put a newline before it (the iPad golden's flake).
    expect(columnBefore).toBe(columnAfter);
    expect(columnBefore.endsWith("said Zeke.\n\u200B")).toBe(true);
  });

  test("the columns stay at the end of the body, in order", () => {
    document.body.innerHTML = "<p>one</p><p>two</p>";
    appendVirtualColumn();
    const second = document.createElement("div");
    second.classList.add("readium-virtual-column");
    second.innerHTML = "&#8203;";
    document.body.appendChild(second);

    require("../src/decorator").registerTemplates({});

    const columns = document.querySelectorAll(".readium-virtual-column");
    expect(columns.length).toBe(2);
    expect(columns[0].id).toBe("readium-virtual-page");
    expect(document.body.lastElementChild).toBe(columns[1]);
    expect(document.body.textContent).toBe("one\ntwo\u200B\u200B");
  });
});

describe("getHtmlBodyTextContent", () => {
  test("returns the body text after the rewrite", () => {
    const text = registerTemplates("<p>one<br/>two</p><p>ﬁve</p>");
    expect(require("../src/utils").getHtmlBodyTextContent()).toBe(text);
    expect(text).toBe("one\ntwo\nfive");
  });
});

describe("registerTemplates", () => {
  test("adds one stylesheet with the templates' styles", () => {
    document.body.innerHTML = "<p>text</p>";
    require("../src/decorator").registerTemplates({
      a: { element: "<div/>", stylesheet: ".a { color: red; }" },
      b: { element: "<div/>", stylesheet: ".b { color: blue; }" },
      c: { element: "<div/>" },
    });
    const styles = Array.from(document.head.querySelectorAll("style")).map(
      (style) => style.textContent
    );
    expect(styles[0]).toBe(".a { color: red; }\n.b { color: blue; }\n");
    expect(styles.some((style) => style.includes(".visible-area"))).toBe(true);
    expect(styles.some((style) => style.includes("pointer-events: none"))).toBe(
      true
    );
  });
});
