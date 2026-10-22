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
    expect(registerTemplates("<p>Tom &amp; Jerry &lt;3 &gt;</p><p>two</p>")).toBe(
      "Tom & Jerry <3 >\ntwo"
    );
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

describe("OCR span spacing", () => {
  // OCR books position every word in its own span; spaces are inserted from the spans' geometry.
  function ocr(parentAttributes, spans) {
    const html = spans
      .map(
        ([text, bottom, left]) =>
          `<span style="bottom: ${bottom}px; left: ${left}px">${text}</span>`
      )
      .join("");
    return registerTemplates(`<div ${parentAttributes}>${html}</div>`);
  }

  test("words on one line, far apart horizontally, are not separated", () => {
    expect(
      ocr('id="page"', [
        ["The", 100, 10],
        ["cat", 100, 50],
      ])
    ).toBe("Thecat");
  });

  test("a word on a lower line gets a space before it", () => {
    expect(
      ocr('id="page"', [
        ["end", 100, 300],
        ["start", 80, 10],
      ])
    ).toBe("end start");
  });

  test("a word at almost the same left position gets a space before it", () => {
    expect(
      ocr('id="page"', [
        ["one", 100, 100],
        ["two", 100, 100.5],
      ])
    ).toBe("one two");
  });

  test("a word much further right than the previous one gets a space before it", () => {
    expect(
      ocr('id="page"', [
        ["one", 100, 1],
        ["two", 100, 20],
      ])
    ).toBe("one two");
  });

  test("today: spans whose parent has no id are never compared, so they get no space", () => {
    expect(
      ocr('class="page"', [
        ["end", 100, 300],
        ["start", 80, 10],
      ])
    ).toBe("endstart");
  });

  test("spans without position styles get no space", () => {
    expect(
      registerTemplates('<p id="p"><span>one</span><span>two</span></p>')
    ).toBe("onetwo");
  });

  test("the spacing marker attribute is removed", () => {
    ocr('id="page"', [
      ["end", 100, 300],
      ["start", 80, 10],
    ]);
    expect(document.querySelector("[data-needs-spacing]")).toBeNull();
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
