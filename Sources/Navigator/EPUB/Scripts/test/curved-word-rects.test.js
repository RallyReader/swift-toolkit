//
//  Copyright 2026 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

// Rally (RR-9728): a word whose letters the book lays out one by one ("I Play", 9781626725126: a rotated <p> per
// letter along a curve) is underlined once per line, not once per letter with lines above and through it.
//
// jsdom has no layout, so the stubs below play WebKit: a range in one letter's text node measures as that letter's
// box; a range over several letters measures as every letter's box plus the border box of each <p> wholly inside it
// (a band 20 px high from the letter to the page's right edge), as WebKit reports. The whitespace between blocks is
// not drawn: no box, unless its element is listed in `drawnGaps` (a space the page shows). The real WebKit side is covered by
// the app's ReadiumScriptsTests. Run with `pnpm test` from Sources/Navigator/EPUB/Scripts.

const {
  getClientRectsNoOverlap,
  rangeBoundingRect,
  separatelyLaidOutWordRects,
  unionByLine,
} = require("../src/rect");

function box(left, top, width, height) {
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

/** Each letter's box, by its element's id. */
let letterBoxes = {};
/** Each letter element's border box. */
let bandBoxes = {};
/** Elements whose whitespace is drawn, by id. */
let drawnGaps = new Set();

function measure(range) {
  if (
    range.startContainer === range.endContainer &&
    range.startContainer.nodeType === Node.TEXT_NODE
  ) {
    const id = range.startContainer.parentElement.id;
    if (!/\S/.test(range.toString())) {
      return drawnGaps.has(id) ? [box(0, 0, 8, 30)] : [];
    }
    if (letterBoxes[id]) {
      return [letterBoxes[id]];
    }
    // Ordinary text: 10 px a character on one line.
    return [
      box(
        range.startOffset * 10,
        0,
        (range.endOffset - range.startOffset) * 10,
        30
      ),
    ];
  }
  const rects = [];
  for (const id of Object.keys(letterBoxes)) {
    const element = document.getElementById(id);
    if (element && range.intersectsNode(element.firstChild)) {
      rects.push(letterBoxes[id]);
      if (
        bandBoxes[id] &&
        range.isPointInRange(element, 0) &&
        range.isPointInRange(element, element.childNodes.length)
      ) {
        rects.push(bandBoxes[id]);
      }
    }
  }
  return rects;
}

beforeEach(() => {
  letterBoxes = {};
  bandBoxes = {};
  drawnGaps = new Set();
  Range.prototype.getClientRects = function () {
    return measure(this);
  };
  Range.prototype.getBoundingClientRect = function () {
    const rects = measure(this);
    const left = Math.min(...rects.map((r) => r.left));
    const top = Math.min(...rects.map((r) => r.top));
    const right = Math.max(...rects.map((r) => r.right));
    const bottom = Math.max(...rects.map((r) => r.bottom));
    return box(left, top, right - left, bottom - top);
  };
});

/** "dance" built like 9781626725126 p.7: a tilted <p> per letter, each at its own height. */
function bouncingWord() {
  document.body.innerHTML = `<div id="word">
<p id="d" style="transform:rotate(-3deg)">d</p>
<p id="a" style="transform:rotate(5deg)">a</p>
<p id="n" style="transform:rotate(17deg)">n</p>
<p id="c" style="transform:rotate(-18deg)">c</p>
<p id="e" style="transform:rotate(-18deg)">e</p>
</div>`;
  letterBoxes = {
    d: box(300, 100, 50, 80),
    a: box(364, 90, 50, 80),
    n: box(416, 110, 55, 80),
    c: box(470, 80, 55, 80),
    e: box(524, 75, 50, 80),
  };
  bandBoxes = {
    d: box(300, 135, 700, 20),
    a: box(364, 119, 636, 20),
    n: box(416, 125, 584, 20),
    c: box(470, 76, 530, 20),
    e: box(524, 48, 476, 20),
  };
  const range = document.createRange();
  range.setStart(document.getElementById("d").firstChild, 0);
  range.setEnd(document.getElementById("e").firstChild, 1);
  return range;
}

describe("a word laid out one letter at a time", () => {
  test("is underlined once: one rect over its letters, without the elements' bands", () => {
    const rects = getClientRectsNoOverlap(bouncingWord(), true);
    expect(rects).toHaveLength(1);
    expect(rects[0]).toMatchObject({
      left: 300,
      top: 75,
      right: 574,
      bottom: 190,
    });
  });

  test("its bounding rect, which the app is told, stops at its last letter", () => {
    expect(rangeBoundingRect(bouncingWord())).toMatchObject({
      left: 300,
      top: 75,
      right: 574,
      bottom: 190,
    });
  });

  test("broken over two lines, it has a rect on each", () => {
    const range = bouncingWord();
    letterBoxes.n = box(20, 300, 55, 80);
    letterBoxes.c = box(80, 290, 55, 80);
    letterBoxes.e = box(134, 305, 50, 80);
    const rects = separatelyLaidOutWordRects(range);
    expect(rects).toHaveLength(2);
    expect(rects[0]).toMatchObject({
      left: 300,
      top: 90,
      right: 414,
      bottom: 180,
    });
    expect(rects[1]).toMatchObject({
      left: 20,
      top: 290,
      right: 184,
      bottom: 385,
    });
  });

  test("an SVG glyph per letter is measured the same way", () => {
    // jsdom's innerHTML makes HTML elements of SVG tags.
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    for (const [index, letter] of ["R", "u"].entries()) {
      if (index > 0) {
        svg.append("\n");
      }
      const text = document.createElementNS(svgNS, "text");
      text.id = letter;
      text.textContent = letter;
      svg.append(text);
    }
    document.body.replaceChildren(svg);
    letterBoxes = { R: box(100, 50, 40, 60), u: box(138, 58, 36, 50) };
    const range = document.createRange();
    range.setStart(document.getElementById("R").firstChild, 0);
    range.setEnd(document.getElementById("u").firstChild, 1);
    expect(separatelyLaidOutWordRects(range)).toEqual([
      expect.objectContaining({ left: 100, top: 50, right: 174, bottom: 110 }),
    ]);
  });
});

describe("any other range keeps its rects", () => {
  test("a word in one text node", () => {
    document.body.innerHTML = `<p id="p">The cat sat</p>`;
    const range = document.createRange();
    const text = document.getElementById("p").firstChild;
    range.setStart(text, 4);
    range.setEnd(text, 7);
    expect(separatelyLaidOutWordRects(range)).toBeNull();
    expect(getClientRectsNoOverlap(range, true)).toEqual([
      expect.objectContaining({ left: 40, width: 30, top: 0, height: 30 }),
    ]);
  });

  test("a word split by an inline span (a styled first letter)", () => {
    document.body.innerHTML = `<p id="p"><span id="first">T</span>he cat</p>`;
    const range = document.createRange();
    range.setStart(document.getElementById("first").firstChild, 0);
    range.setEnd(document.getElementById("p").lastChild, 2);
    expect(separatelyLaidOutWordRects(range)).toBeNull();
  });

  test("several words over letter blocks", () => {
    document.body.innerHTML = `<div><p id="a">to</p><p id="b">be or</p></div>`;
    const range = document.createRange();
    range.setStart(document.getElementById("a").firstChild, 0);
    range.setEnd(document.getElementById("b").firstChild, 5);
    expect(separatelyLaidOutWordRects(range)).toBeNull();
  });

  test("a phrase one word per block", () => {
    document.body.innerHTML = `<div><p id="a">big</p>\n<p id="b">dog</p></div>`;
    letterBoxes = { a: box(0, 0, 30, 30), b: box(40, 0, 30, 30) };
    const range = document.createRange();
    range.setStart(document.getElementById("a").firstChild, 0);
    range.setEnd(document.getElementById("b").firstChild, 3);
    expect(separatelyLaidOutWordRects(range)).toBeNull();
  });

  test("two short words with a space drawn between them", () => {
    document.body.innerHTML = `<div id="line"><span id="a" style="display:inline-block">to</span> <span id="b" style="display:inline-block">be</span></div>`;
    letterBoxes = { a: box(0, 0, 20, 30), b: box(28, 0, 20, 30) };
    drawnGaps = new Set(["line"]);
    const range = document.createRange();
    range.setStart(document.getElementById("a").firstChild, 0);
    range.setEnd(document.getElementById("b").firstChild, 2);
    expect(separatelyLaidOutWordRects(range)).toBeNull();
  });

  test("OCR overlays, a word each", () => {
    document.body.innerHTML = `<div class="ocr-container"><div id="a" class="text-overlay" style="position:absolute">to</div><div id="b" class="text-overlay" style="position:absolute">be</div></div>`;
    letterBoxes = { a: box(100, 400, 38, 40), b: box(138, 400, 38, 40) };
    const range = document.createRange();
    range.setStart(document.getElementById("a").firstChild, 0);
    range.setEnd(document.getElementById("b").firstChild, 2);
    expect(separatelyLaidOutWordRects(range)).toBeNull();
  });
});

describe("unionByLine", () => {
  test("a drop cap stays apart from the rest of its word, as before", () => {
    const lines = unionByLine([box(0, 0, 60, 120), box(62, 0, 30, 30)]);
    expect(lines).toHaveLength(2);
  });

  test("in vertical writing, letters stacked down a column make one line", () => {
    const lines = unionByLine(
      [box(100, 0, 30, 30), box(102, 30, 30, 30), box(98, 60, 30, 30)],
      true
    );
    expect(lines).toEqual([
      expect.objectContaining({ left: 98, top: 0, right: 132, bottom: 90 }),
    ]);
  });

  test("letters stepping up and down a curve make one line", () => {
    const lines = unionByLine([
      box(0, 40, 30, 60),
      box(28, 20, 30, 60),
      box(56, 0, 30, 60),
      box(84, 20, 30, 60),
    ]);
    expect(lines).toEqual([
      expect.objectContaining({ left: 0, top: 0, right: 114, bottom: 100 }),
    ]);
  });
});
