//
//  Copyright 2026 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

// Where a word in display type is drawn (RR-9369, ported from the Android
// fork's RR-9367). Run with `pnpm test` from Sources/Navigator/EPUB/Scripts.
//
// The values are measured in WebKit on "E is for Elephant" (9780744043068),
// page002.xhtml: a 2000px "e" scaled 5.76 times beside " is for elephant"
// scaled 1.376 times, both in the book's f0 face. The page itself is checked
// in WebKit by the app's ReadiumScriptsTests ("RR-9369 …").

import {
  displayTypeBodyHeight,
  inkFittedRect,
  isOneLine,
  isUprightTurn,
  neighbourCharacterIndex,
  renderedText,
} from "../src/display-type";

const F0 = { fontAscent: 1540, fontDescent: 460 };
const LETTER_E = {
  rect: { left: 109.6, top: -84.9, width: 335, height: 699.6 },
  metrics: { ...F0, inkAscent: 937.5, inkDescent: 31.25 },
};
const LETTER_E_SCALE = 699.6 / 2000;
const LETTER_E_BASELINE = LETTER_E.rect.top + F0.fontAscent * LETTER_E_SCALE;
const LETTER_E_INK_TOP = LETTER_E_BASELINE - 937.5 * LETTER_E_SCALE;
const LETTER_E_INK_BOTTOM = LETTER_E_BASELINE + 31.25 * LETTER_E_SCALE;
const LETTER_E_FONT_BOTTOM = LETTER_E.rect.top + LETTER_E.rect.height;
const IS_FOR_HEIGHT = 167.1;

const heights = (...values) => values.map((value) => () => value);

describe("displayTypeBodyHeight", () => {
  test("takes a letter four times the height of the text beside it as display type", () => {
    expect(displayTypeBodyHeight(699.6, heights(null, IS_FOR_HEIGHT))).toBe(
      IS_FOR_HEIGHT
    );
  });

  test("measures the room around display type against its tallest neighbour", () => {
    expect(displayTypeBodyHeight(699.6, heights(62.1, IS_FOR_HEIGHT))).toBe(
      IS_FOR_HEIGHT
    );
  });

  test("does not take a word as display type when one neighbour is as tall", () => {
    expect(displayTypeBodyHeight(699.6, heights(IS_FOR_HEIGHT, 699.6))).toBe(
      null
    );
  });

  test("does not take a default h1, twice its body's size, as display type", () => {
    expect(displayTypeBodyHeight(45, heights(22))).toBe(null);
  });

  test("does not take a word with no measured neighbour as display type", () => {
    expect(displayTypeBodyHeight(699.6, heights(null, 0))).toBe(null);
  });

  test("stops asking for neighbours once one rules display type out", () => {
    const asked = [];
    const neighbours = [
      () => {
        asked.push("before");
        return 167.1;
      },
      () => {
        asked.push("after");
        return 20;
      },
    ];

    expect(displayTypeBodyHeight(167.1, neighbours)).toBe(null);
    expect(asked).toEqual(["before"]);
  });
});

describe("neighbourCharacterIndex", () => {
  test("finds the next character past the spaces after a word", () => {
    expect(neighbourCharacterIndex("is  for", 2, true)).toBe(4);
  });

  test("finds the last character before the spaces ahead of a word", () => {
    expect(neighbourCharacterIndex("is  for", 4, false)).toBe(1);
  });

  test("finds no neighbour inside a node that holds only the word", () => {
    expect(neighbourCharacterIndex("e ", 1, true)).toBe(-1);
    expect(neighbourCharacterIndex(" e", 1, false)).toBe(-1);
  });
});

describe("renderedText", () => {
  test("measures a letter set in capitals as the capital it shows", () => {
    expect(renderedText("e", "uppercase")).toBe("E");
  });

  test("capitalizes the first letter of each word", () => {
    expect(renderedText("is for elephant", "capitalize")).toBe(
      "Is For Elephant"
    );
  });

  test("leaves text without a transform as it is", () => {
    expect(renderedText("Elephant", "none")).toBe("Elephant");
  });
});

describe("inkFittedRect", () => {
  const fitted = inkFittedRect(LETTER_E.rect, LETTER_E.metrics, IS_FOR_HEIGHT);

  test("puts the bottom of a display letter just under its glyph, not at its font's descent", () => {
    expect(fitted.bottom).toBeGreaterThan(LETTER_E_INK_BOTTOM);
    expect(fitted.bottom).toBeLessThan(LETTER_E_INK_BOTTOM + IS_FOR_HEIGHT / 2);
    expect(fitted.bottom).toBeLessThan(LETTER_E_FONT_BOTTOM - 100);
  });

  test("keeps the top of a display letter on the page above its glyph", () => {
    expect(fitted.top).toBeGreaterThan(0);
    expect(fitted.top).toBeLessThan(LETTER_E_INK_TOP);
  });

  test("keeps the rect's horizontal extent", () => {
    expect(fitted.left).toBe(109.6);
    expect(fitted.width).toBe(335);
    expect(fitted.right).toBe(444.6);
    expect(fitted.height).toBeCloseTo(fitted.bottom - fitted.top, 9);
  });

  test("never grows the rect past the font's own ascent and descent", () => {
    const deepInk = { ...F0, inkAscent: 1900, inkDescent: 900 };

    const grown = inkFittedRect(LETTER_E.rect, deepInk, IS_FOR_HEIGHT);

    expect(grown.top).toBe(LETTER_E.rect.top);
    expect(grown.bottom).toBeCloseTo(LETTER_E_FONT_BOTTOM, 9);
  });

  test("gives up on metrics that do not describe the rect", () => {
    const none = { fontAscent: 0, fontDescent: 0, inkAscent: 0, inkDescent: 0 };
    expect(inkFittedRect(LETTER_E.rect, none, 167)).toBe(null);
  });
});

describe("isOneLine", () => {
  test("takes boxes side by side on a line as one line", () => {
    expect(
      isOneLine([
        { top: 0, bottom: 700 },
        { top: 10, bottom: 690 },
      ])
    ).toBe(true);
  });

  test("does not take a word that wraps onto the next line as one line", () => {
    expect(
      isOneLine([
        { top: 0, bottom: 700 },
        { top: 700, bottom: 1400 },
      ])
    ).toBe(false);
  });

  test("does not take no boxes as a line", () => {
    expect(isOneLine([])).toBe(false);
  });
});

describe("isUprightTurn", () => {
  test("takes unturned text as upright", () => {
    expect(isUprightTurn({ cos: 1, sin: 0 })).toBe(true);
  });

  test("takes text turned a few degrees as upright", () => {
    const angle = (4 * Math.PI) / 180;
    expect(isUprightTurn({ cos: Math.cos(angle), sin: Math.sin(angle) })).toBe(
      true
    );
  });

  test("does not take lettering turned on a curve, or upside down, as upright", () => {
    const angle = (17 * Math.PI) / 180;
    expect(isUprightTurn({ cos: Math.cos(angle), sin: Math.sin(angle) })).toBe(
      false
    );
    expect(isUprightTurn({ cos: -1, sin: 0 })).toBe(false);
  });
});
