//
//  Copyright 2026 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

// Hidden text laid out on the lines of the text printed under it (RR-9323,
// `layHiddenTextOnItsLines` in decorator.js). The WebKit side, with the book's
// stylesheet and WebKit's default font, is covered by the app's
// ReadiumScriptsTests. Run with `pnpm test` from Sources/Navigator/EPUB/Scripts.

import {
  MAX_FONT_OVERFLOW,
  drawsNoText,
  hiddenLinesLayout,
  isTransparent,
  lineExtent,
} from "../src/hidden-text";

describe("which text draws nothing", () => {
  const black = "rgb(0, 0, 0)";

  test("opacity 0 on the text's element ('Good Night, Escargot': p { opacity: 0 })", () => {
    expect(
      drawsNoText({
        opacities: ["0", "1", "1"],
        color: black,
        textFillColor: black,
      })
    ).toBe(true);
  });

  test("opacity 0 on an element around it", () => {
    expect(
      drawsNoText({
        opacities: ["1", "1", "0"],
        color: black,
        textFillColor: black,
      })
    ).toBe(true);
  });

  test("transparent text ('.hidden-trigger { color: transparent }')", () => {
    const transparent = "rgba(0, 0, 0, 0)";
    expect(
      drawsNoText({
        opacities: ["1"],
        color: transparent,
        textFillColor: transparent,
      })
    ).toBe(true);
  });

  test("transparent glyphs over a coloured text", () => {
    expect(
      drawsNoText({
        opacities: ["1"],
        color: black,
        textFillColor: "rgba(0, 0, 0, 0)",
      })
    ).toBe(true);
  });

  test.each([
    ["shown text", ["1", "1"], black, black],
    ["faded text", ["0.01"], black, black],
    [
      "half-transparent text",
      ["1"],
      "rgba(0, 0, 0, 0.5)",
      "rgba(0, 0, 0, 0.5)",
    ],
    ["no text fill color (older engines)", ["1"], black, undefined],
  ])("%s shows", (_, opacities, color, textFillColor) => {
    expect(drawsNoText({ opacities, color, textFillColor })).toBe(false);
  });

  test.each([
    ["transparent", true],
    ["rgba(0, 0, 0, 0)", true],
    ["rgba(255, 255, 255, 0)", true],
    ["rgb(0 0 0 / 0)", true],
    ["rgba(0, 0, 0, 0.2)", false],
    ["rgb(0, 0, 0)", false],
    ["currentcolor", false],
    ["", false],
  ])("%s is transparent: %s", (color, expected) => {
    expect(isTransparent(color)).toBe(expected);
  });
});

describe("how the hidden lines are laid out, once kept from wrapping", () => {
  test("a line that fits its box stays as it is", () => {
    expect(hiddenLinesLayout({ widest: 400, available: 427 })).toEqual({
      nowrap: true,
      scale: 1,
    });
    expect(hiddenLinesLayout({ widest: 427, available: 427 })).toEqual({
      nowrap: true,
      scale: 1,
    });
  });

  test("a box as wide as its text fits it (9781338281408 p.37: 'Ring!<br/>Ring!', a positioned <p> with no width)", () => {
    expect(hiddenLinesLayout({ widest: 28.6, available: 28.3 })).toEqual({
      nowrap: true,
      scale: 1,
    });
  });

  test("a line a little wider than its box is narrowed to fit (Escargot p.4, WebKit's default serif)", () => {
    // "Now that you’re here, we can have a soirée pyjama!" in a 427 px box.
    const { nowrap, scale } = hiddenLinesLayout({
      widest: 460,
      available: 427,
    });
    expect(nowrap).toBe(true);
    expect(scale).toBeCloseTo(427 / 460, 6);
  });

  test("up to the limit a wider font is taken for", () => {
    const widest = 427 * MAX_FONT_OVERFLOW;
    expect(hiddenLinesLayout({ widest, available: 427 }).nowrap).toBe(true);
  });

  test("a line much wider than its box wraps as the book has it: it is meant to", () => {
    const widest = 427 * MAX_FONT_OVERFLOW + 1;
    expect(hiddenLinesLayout({ widest, available: 427 })).toEqual({
      nowrap: false,
      scale: 1,
    });
  });

  test.each([
    ["nothing measured", 0, 427],
    ["no box", 400, 0],
    ["not measurable", NaN, 427],
  ])("%s: left as it is", (_, widest, available) => {
    expect(hiddenLinesLayout({ widest, available })).toEqual({
      nowrap: false,
      scale: 1,
    });
  });
});

describe("how far the lines reach, against their box", () => {
  test("lines that end inside their box reach its width at most", () => {
    expect(
      lineExtent({
        textLeft: 85,
        textRight: 497,
        boxLeft: 85,
        boxRight: 512,
        direction: "ltr",
      })
    ).toEqual({ widest: 412, available: 427 });
  });

  test("a line that runs past the box's right edge (Escargot p.4)", () => {
    expect(
      lineExtent({
        textLeft: 85,
        textRight: 545,
        boxLeft: 85,
        boxRight: 512,
        direction: "ltr",
      })
    ).toEqual({ widest: 460, available: 427 });
  });

  test("a line set before the start edge is not a line too long (9781338281408 p.37: text-indent -6px)", () => {
    const extent = lineExtent({
      textLeft: 637,
      textRight: 671.5,
      boxLeft: 643,
      boxRight: 671.5,
      direction: "ltr",
    });
    expect(extent).toEqual({ widest: 28.5, available: 28.5 });
    expect(hiddenLinesLayout(extent)).toEqual({ nowrap: true, scale: 1 });
  });

  test("right-to-left lines reach from the right edge", () => {
    expect(
      lineExtent({
        textLeft: 40,
        textRight: 300,
        boxLeft: 50,
        boxRight: 300,
        direction: "rtl",
      })
    ).toEqual({ widest: 260, available: 250 });
  });
});
