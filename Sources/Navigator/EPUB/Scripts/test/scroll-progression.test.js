//
//  Copyright 2026 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

// RR-9540: a paginated resource scrolled to its end (`scrollToPosition(1)`, where the navigator preloads
// the resource before the one shown) was scrolled a page past its last page, and its first visible
// progression read 1, the next resource's start: a one-page cover turned back to read "Page 1", "3%".
// jsdom lays nothing out, so the page width, the document's width and the scroll offset are faked.

// The page's load handler watches the body's size; jsdom has no ResizeObserver, and the load event
// fires while a test waits for an animation frame.
global.ResizeObserver = class {
  observe() {}
};

const { scrollToPosition } = require("../src/utils");

const pageWidth = 390;
let pages = 1;
let scrollX = 0;
let direction = "ltr";

beforeEach(() => {
  global.readium = { isFixedLayout: false };
  window.innerWidth = pageWidth;
  pages = 1;
  scrollX = 0;
  direction = "ltr";
  jest.spyOn(window, "getComputedStyle").mockReturnValue({
    getPropertyValue: (name) =>
      ({ direction, "column-count": "1", "writing-mode": "horizontal-tb" }[
        name
      ] ?? ""),
  });
  Object.defineProperty(document.documentElement, "scrollWidth", {
    configurable: true,
    get: () => pages * pageWidth,
  });
  Object.defineProperty(document.documentElement, "scrollHeight", {
    configurable: true,
    get: () => 800,
  });
  Object.defineProperty(window, "scrollX", {
    configurable: true,
    get: () => scrollX,
  });
  document.documentElement.scrollTo = jest.fn();
});

afterEach(() => {
  jest.restoreAllMocks();
});

/** The left offsets `scrollToPosition` scrolled to. */
function scrolledTo() {
  return document.documentElement.scrollTo.mock.calls.map(
    (call) => call[0].left
  );
}

/** Fires a scroll at `offset` and returns the progressions reported to the navigator. */
async function progressionsAt(offset) {
  scrollX = offset;
  window.dispatchEvent(new Event("scroll"));
  await new Promise((resolve) => window.requestAnimationFrame(resolve));
  return postedMessages("progressionChanged").pop();
}

describe("scrollToPosition", () => {
  test("the end of a one-page resource is its only page, not the width past it", () => {
    pages = 1;
    scrollToPosition(1, "ltr", false);
    expect(scrolledTo()).toEqual([0]);
  });

  test("the end of a longer resource is its last page", () => {
    pages = 3;
    scrollToPosition(1, "ltr", false);
    expect(scrolledTo()).toEqual([2 * pageWidth]);
  });

  test("a position inside snaps to the page showing it", () => {
    pages = 4;
    scrollToPosition(0, "ltr", false);
    scrollToPosition(0.5, "ltr", false);
    scrollToPosition(0.6, "ltr", false);
    expect(scrolledTo()).toEqual([0, 2 * pageWidth, 2 * pageWidth]);
  });

  test("right to left, the end is the last page, to the left", () => {
    pages = 3;
    scrollToPosition(1, "rtl", false);
    scrollToPosition(0.5, "rtl", false);
    expect(scrolledTo()).toEqual([-2 * pageWidth, -pageWidth]);
  });
});

describe("the progressions reported on scroll", () => {
  test("a one-page resource reported a page past its end starts at 0", async () => {
    pages = 1;
    expect(await progressionsAt(pageWidth)).toEqual({ first: 0, last: 1 });
  });

  test("a longer resource reported past its end shows its last page", async () => {
    pages = 3;
    expect(await progressionsAt(3 * pageWidth)).toEqual({
      first: 2 / 3,
      last: 1,
    });
  });

  test("an offset inside the resource is reported as it is", async () => {
    pages = 3;
    expect(await progressionsAt(pageWidth)).toEqual({
      first: 1 / 3,
      last: 2 / 3,
    });
  });

  test("right to left, an offset past the end shows the last page", async () => {
    pages = 3;
    direction = "rtl";
    expect(await progressionsAt(-3 * pageWidth)).toEqual({
      first: 2 / 3,
      last: 1,
    });
  });
});
