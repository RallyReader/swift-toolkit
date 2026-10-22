//
//  Copyright 2026 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

// Scenarios for separating words drawn as separate fragments (RR-6094).
// Run with `pnpm test` from Sources/Navigator/EPUB/Scripts.
//
// Every row is a pair of DOM-adjacent text pieces with nothing between them,
// with the values decorator.js measures in WebKit: the box of the last
// character of `previous` and of the first character of `next`, the angle the
// text is drawn at and its drawn font size. Unless noted, rows come from
// "The STEAM Team: Simple Science Explained" (9781465477583), a fixed layout
// converted from PDF. Add a row before changing the heuristics.

import {
  isOnSameLine,
  needsSpaceBetween,
  toTextFrame,
} from "../src/text-spacing";

const piece = (text, [top, bottom, left, right], angle = 0, fontSize = 0) => ({
  text,
  rect: { top, bottom, left, right },
  angle,
  fontSize,
});

const VERTICAL = -Math.PI / 2;

const separate = [
  {
    name: "drop cap word, then the next line (p.7: 'A' 'rt' | 'is all')",
    previous: piece("rt", [1681.6, 1729.9, 481.3, 503.8]),
    next: piece("is a", [1747.9, 1785.5, 296.8, 304.8]),
  },
  {
    name: "heading in a <div>, then the paragraph below it (p.4: 'Introduction' | 'This')",
    previous: piece("duction", [493.7, 658.9, 1150.8, 1261.1]),
    next: piece("This", [718.2, 782.4, 196.2, 221.8]),
  },
  {
    name: "end of a block, then a callout higher on the page (p.7: 'things.' | 'We’ll')",
    previous: piece("ings.", [1829.3, 1866.8, 642.8, 651.7]),
    next: piece("We’l", [147.6, 201, 895.3, 927.4]),
  },
  {
    name: "heading near the top, then a line starting further left (p.28: 'Mammals' | 'Mammals have')",
    previous: piece("Mammals", [994.9, 1022.9, 302, 314]),
    next: piece("Mammals have", [1030.2, 1058.2, 143.8, 162.5]),
  },
  {
    name: "word space drawn as a margin, not a space character (p.11: 'largest' | 'planet')",
    previous: piece("largest", [1293.9, 1321.9, 471.6, 479.4]),
    next: piece("planet i", [1293.9, 1321.9, 487.4, 498.8]),
  },
  {
    name: "label drawn left of the previous one on the same line (p.46: 'Right' | 'Left')",
    previous: piece("Right", [506.1, 534.1, 493.2, 501.7]),
    next: piece("Left", [506.1, 534.1, 135.4, 150.8]),
  },
  {
    name: "curved title, then the curved paragraph under it (p.14: 'Earth' | 'plants')",
    previous: piece("h", [722.1, 868.5, 556.3, 742.5], -1.3461, 165.3),
    next: piece("p", [683.9, 725.5, 673, 733.8], -1.2803, 48.3),
  },
  {
    name: "vertical title, then the vertical paragraph next to it (p.44: 'body' | 'An adult')",
    previous: piece("body", [1454, 1561.9, 181, 346.2], VERTICAL, 165.3),
    next: piece("An adult hum", [1825.4, 1859.3, 361.6, 417.1], VERTICAL, 48.3),
  },
  {
    name: "drop cap that is a word on its own, then a word space (synthetic: 'A' 'long')",
    previous: piece("A", [431.2, 542.2, 746, 810.5], 0, 111),
    next: piece("long", [436.6, 451.4, 821, 830], 0, 14.8),
  },
  {
    name: "rotated caption next to regular text",
    previous: piece("caption", [100, 128, 100, 110], VERTICAL, 28),
    next: piece("Text", [100, 128, 112, 125], 0, 28),
  },
];

const joined = [
  {
    name: "drop cap and the rest of its word (p.7: 'A' 'rt')",
    previous: piece("A", [1542.5, 1733.2, 296.8, 449.3], 0, 190.7),
    next: piece("rt", [1681.6, 1729.9, 455, 481.3], 0, 48.3),
  },
  {
    name: "floated drop cap with a right margin (9780374392840 p.3: 'B' 'onjour!')",
    previous: piece("B", [431.2, 542.2, 746, 810.5], 0, 111),
    next: piece("onjour!", [436.6, 451.4, 816, 820], 0, 14.8),
  },
  {
    name: "word split by a kerning span (p.4: 'Intro' 'duction')",
    previous: piece("Intro", [493.7, 658.9, 537.3, 631.7]),
    next: piece("duction", [493.7, 658.9, 631, 734.7]),
  },
  {
    name: "negative kerning overlapping the previous letter (p.4: 'it’' 's')",
    previous: piece("it’", [718.2, 782.4, 1074.9, 1090.4]),
    next: piece("s", [718.2, 782.4, 1084.8, 1106.3]),
  },
  {
    name: "widest kerning gap inside a word (p.28: 'Ver' 'tebra')",
    previous: piece("Ver", [1088.8, 1137.1, 1045.1, 1068.6]),
    next: piece("tebra", [1088.8, 1137.1, 1071.5, 1092.5]),
  },
  {
    name: "punctuation after a word (p.24: 'weather' '.')",
    previous: piece("weather", [594.3, 649.7, 726.3, 743.3]),
    next: piece(".", [594.3, 649.7, 738.4, 752.4]),
  },
  {
    name: "vertical text split by a kerning span (p.44: 'syste' 'ms')",
    previous: piece("of syste", [394.8, 405.2, 377.9, 405.9], VERTICAL, 28),
    next: piece("ms. Th", [376.6, 394.6, 377.9, 405.9], VERTICAL, 28),
  },
  {
    name: "letters of a curved paragraph, each rotated a bit more (p.14: 'g' 'h')",
    previous: piece("g", [643.2, 685.5, 624.7, 685.7], -1.2636, 48.3),
    next: piece("h", [617.8, 660.4, 633.4, 694.2], -1.2239, 48.3),
  },
];

const alreadySeparated = [
  {
    name: "previous piece ends with a space",
    previous: piece("brilliant ", [1829.3, 1866.8, 500, 520]),
    next: piece("new", [1829.3, 1866.8, 900, 920]),
  },
  {
    name: "next piece starts with a space (p.7: 'brilliant' ' new th')",
    previous: piece("rilliant", [1829.3, 1866.8, 500, 520]),
    next: piece(" new th", [1829.3, 1866.8, 900, 920]),
  },
  {
    name: "a piece that is not rendered",
    previous: { text: "hidden", rect: null, angle: 0, fontSize: 0 },
    next: piece("Text", [100, 128, 0, 10]),
  },
];

describe("needsSpaceBetween", () => {
  for (const { name, previous, next } of separate) {
    test(`separates: ${name}`, () => {
      expect(needsSpaceBetween(previous, next)).toBe(true);
    });
  }
  for (const { name, previous, next } of joined) {
    test(`joins: ${name}`, () => {
      expect(needsSpaceBetween(previous, next)).toBe(false);
    });
  }
  for (const { name, previous, next } of alreadySeparated) {
    test(`leaves alone: ${name}`, () => {
      expect(needsSpaceBetween(previous, next)).toBe(false);
    });
  }
});

describe("isOnSameLine", () => {
  test("drop cap overlapping the line it starts", () => {
    expect(
      isOnSameLine(
        { top: 1542.5, bottom: 1733.2, left: 296.8, right: 449.3 },
        { top: 1681.6, bottom: 1729.9, left: 455, right: 481.3 }
      )
    ).toBe(true);
  });
  test("consecutive lines", () => {
    expect(
      isOnSameLine(
        { top: 994.9, bottom: 1022.9, left: 302, right: 314 },
        { top: 1030.2, bottom: 1058.2, left: 143.8, right: 162.5 }
      )
    ).toBe(false);
  });
});

describe("toTextFrame", () => {
  test("leaves regular text as is", () => {
    const rect = { top: 1, bottom: 2, left: 3, right: 4 };
    expect(toTextFrame(rect, 0)).toBe(rect);
  });
  test("lays text drawn bottom to top along x", () => {
    // Two characters of vertical text, the second one above the first.
    const first = toTextFrame(
      { top: 394.8, bottom: 405.2, left: 377.9, right: 405.9 },
      VERTICAL
    );
    const second = toTextFrame(
      { top: 376.6, bottom: 394.6, left: 377.9, right: 405.9 },
      VERTICAL
    );
    expect(second.left >= first.right - 0.5).toBe(true);
    expect(Math.abs(first.top - second.top) < 0.001).toBe(true);
  });
});
