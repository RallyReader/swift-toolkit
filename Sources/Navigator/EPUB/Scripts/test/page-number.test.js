//
//  Copyright 2026 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

// Scenarios for skipping printed page numbers during read aloud.
// Run with `pnpm test` from Sources/Navigator/EPUB/Scripts.
//
// Every book structure we special-case gets a row here, with the values
// decorator.js would see for the word: the text before/after it in the
// resource (as extracted by the Swift text extractor), where it is drawn and
// what its element contains. Add a row before changing the heuristics.

import {
  continuesOnTheSameLine,
  isAtTopOrBottom,
  isDOMIsolated,
  isPageNumber,
  shouldSkipPageNumber,
} from "../src/page-number";

// Page text area, as measured by getTextContentBounds() (viewport fallback).
const bounds = { minY: 0, maxY: 1000, measured: false };
const TOP = 20;
const MIDDLE = 500;
const BOTTOM = 960;

const skipped = [
  {
    name: "fixed layout: page number first in the DOM, drawn at the bottom (DK Readers, 9780744073003 p.6)",
    text: "4",
    before: "\n\n",
    after: " Many animals live in the ocean.",
    top: BOTTOM,
    parentText: "4",
  },
  {
    name: "fixed layout: page with only the page number on it",
    text: "5",
    before: "\n\n",
    after: "",
    top: BOTTOM,
    parentText: "5",
  },
  {
    name: "fixed layout: page number last in the DOM, after a sentence",
    text: "30",
    before: "You played like  an ocean animal. ",
    after: "",
    top: BOTTOM,
    parentText: "30",
  },
  {
    name: "fixed layout: page number followed by a numbered list (9780744073003 p.34)",
    text: "32",
    before: "\n\n",
    after: " 1. The wind pushes it  2. Nautilus",
    top: BOTTOM,
    parentText: "32",
  },
  {
    name: "fixed layout: page number drawn at the top",
    text: "7",
    before: "\n\n",
    after: " Dragons live in caves.",
    top: TOP,
    parentText: "7",
  },
  {
    name: "reflowable: page number paragraph between two paragraphs",
    text: "12",
    before: "and they all went home.\n",
    after: "\nThe next morning",
    top: BOTTOM,
    parentText: "12",
  },
  {
    name: "OCR layout: page number word under the last line",
    text: "14",
    before: "the\nend.\n",
    after: "",
    top: BOTTOM,
    parentText: "14",
    isInOCRLayout: true,
  },
];

const read = [
  {
    name: "chapter heading in one element: Chapter 1",
    text: "1",
    before: "\n\nChapter ",
    after: "\nThe Beginning",
    top: TOP,
    parentText: "Chapter 1",
  },
  {
    name: "chapter heading split in positioned elements: Chapter | 1",
    text: "1",
    before: "\n\nChapter ",
    after: " The Beginning",
    top: TOP,
    parentText: "1",
  },
  {
    name: "Part 2 heading at the bottom of the page",
    text: "2",
    before: "the end of the first part.\nPart ",
    after: "",
    top: BOTTOM,
    parentText: "2",
  },
  {
    name: "time 8:30 on the last line",
    text: "30",
    before: "The bus came at 8:",
    after: " sharp.",
    top: BOTTOM,
    parentText: "The bus came at 8:30 sharp.",
  },
  {
    name: "time 8:30 in an OCR layout, one word per element",
    text: "30",
    before: "The\nbus\ncame\nat\n8:",
    after: "\nsharp.",
    top: BOTTOM,
    parentText: "30",
    isInOCRLayout: true,
  },
  {
    name: "number inside a sentence on the last line",
    text: "7",
    before: "He was ",
    after: " years old.",
    top: BOTTOM,
    parentText: "He was 7 years old.",
  },
  {
    name: "number ending a sentence on the last line",
    text: "10",
    before: "I counted to ",
    after: ".",
    top: BOTTOM,
    parentText: "I counted to 10.",
  },
  {
    name: "isolated number in the middle of the page (diagram label)",
    text: "3",
    before: "\n",
    after: "\n",
    top: MIDDLE,
    parentText: "3",
  },
  {
    name: "ingredient quantity on the last line: 1 large egg (RR-9067, 9781950785117)",
    text: "1",
    before: "\n\t\t\n\n\t\t\t\n\u00bc teaspoon baking soda\n\t\t\t\n",
    after: " large egg\n\t\t\t\nCooking spray",
    top: BOTTOM,
    parentText: "1 ",
    followedOnSameLine: true,
  },
  {
    name: "sentence starting with a number on the last line: 3 little pigs",
    text: "3",
    before: "\n\n",
    after: " little pigs went home.",
    top: BOTTOM,
    parentText: "3 little pigs went home.",
    followedOnSameLine: true,
  },
  {
    name: "page number glued to the next word by the extractor (4Many)",
    text: "4Many",
    before: "\n\n",
    after: " animals live in the ocean.",
    top: BOTTOM,
    parentText: "4",
  },
];

describe("shouldSkipPageNumber", () => {
  describe("skips page numbers", () => {
    for (const scenario of skipped) {
      test(scenario.name, () => {
        expect(shouldSkipPageNumber({ ...scenario, bounds })).toBe(true);
      });
    }
  });

  describe("reads numbers that are not page numbers", () => {
    for (const scenario of read) {
      test(scenario.name, () => {
        expect(shouldSkipPageNumber({ ...scenario, bounds })).toBe(false);
      });
    }
  });
});

describe("isPageNumber", () => {
  test("digits only", () => {
    expect(isPageNumber("12")).toBe(true);
    expect(isPageNumber(" 12\n")).toBe(true);
  });

  test("anything else", () => {
    for (const text of ["", "12a", "4Many", "1.", "8:30", "xii", "1 2"]) {
      expect(isPageNumber(text)).toBe(false);
    }
  });
});

describe("isAtTopOrBottom", () => {
  test("viewport fallback uses a 15% band", () => {
    expect(isAtTopOrBottom(149, bounds)).toBe(true);
    expect(isAtTopOrBottom(151, bounds)).toBe(false);
    expect(isAtTopOrBottom(851, bounds)).toBe(true);
  });

  test("measured text bounds use a 5% band", () => {
    const measured = { minY: 100, maxY: 1100, measured: true };
    expect(isAtTopOrBottom(140, measured)).toBe(true);
    expect(isAtTopOrBottom(200, measured)).toBe(false);
    expect(isAtTopOrBottom(1060, measured)).toBe(true);
  });

  test("empty text area", () => {
    expect(isAtTopOrBottom(0, { minY: 0, maxY: 0 })).toBe(false);
  });
});

describe("isDOMIsolated", () => {
  test("element with only the number", () => {
    expect(isDOMIsolated({ text: "12", parentText: " 12 ", isInOCRLayout: false })).toBe(true);
  });

  test("element with a sentence", () => {
    expect(isDOMIsolated({
        text: "12",
        parentText: "I am 12 years old.",
        isInOCRLayout: false,
      })).toBe(false);
  });

  test("never in OCR layouts", () => {
    expect(isDOMIsolated({ text: "12", parentText: "12", isInOCRLayout: true })).toBe(false);
  });
});

describe("continuesOnTheSameLine", () => {
  const word = { top: 100, bottom: 120, left: 10, right: 20, height: 20 };
  const at = (left, top) => ({
    top,
    bottom: top + 20,
    left,
    right: left + 10,
    height: 20,
  });

  test("next word a space away on the same line", () => {
    expect(continuesOnTheSameLine(word, at(25, 100))).toBe(true);
  });

  test("next word on another line", () => {
    expect(continuesOnTheSameLine(word, at(10, 130))).toBe(false);
    expect(continuesOnTheSameLine(word, at(25, 900))).toBe(false);
  });

  test("next word far away on the same line (running header)", () => {
    expect(continuesOnTheSameLine(word, at(300, 100))).toBe(false);
  });

  test("next word before the number (wrapped line, right-to-left)", () => {
    expect(continuesOnTheSameLine(word, at(0, 100))).toBe(false);
  });

  test("nothing after the number", () => {
    expect(continuesOnTheSameLine(word, null)).toBe(false);
  });
});
