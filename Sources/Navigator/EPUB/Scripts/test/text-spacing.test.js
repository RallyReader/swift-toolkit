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
