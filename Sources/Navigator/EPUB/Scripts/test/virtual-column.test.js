//
//  Copyright 2026 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

// `appendVirtualColumnIfNeeded` (utils.js): two columns per screen need an even column count. jsdom
// lays nothing out, so the document's width is faked: `columns` real columns, and each virtual column
// adds one only after the first `absorbed` ones (a full-page image overflowing into a column of its
// own takes the first virtual column without growing).

const { appendVirtualColumnIfNeeded } = require("../src/utils");

const pageWidth = 1080; // two 540 pt columns
let columns = 0;
let absorbed = 0;

function virtualColumns() {
  return document.querySelectorAll(".readium-virtual-column").length;
}

beforeEach(() => {
  document.body.innerHTML = "<p>Text</p>";
  window.innerWidth = pageWidth;
  jest.spyOn(window, "getComputedStyle").mockReturnValue({
    getPropertyValue: (name) => (name == "column-count" ? "2" : ""),
  });
  Object.defineProperty(document.documentElement, "scrollWidth", {
    configurable: true,
    get: () =>
      ((columns + Math.max(0, virtualColumns() - absorbed)) * pageWidth) / 2,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

test("an even count gets no virtual column", () => {
  columns = 8;
  absorbed = 0;
  appendVirtualColumnIfNeeded();
  expect(virtualColumns()).toBe(0);
});

test("an odd count gets one", () => {
  columns = 7;
  absorbed = 0;
  appendVirtualColumnIfNeeded();
  expect(virtualColumns()).toBe(1);
  expect(document.getElementById("readium-virtual-page")).not.toBeNull();
});

test("calling it again changes nothing (it used to remove the column)", () => {
  columns = 7;
  absorbed = 0;
  appendVirtualColumnIfNeeded();
  appendVirtualColumnIfNeeded();
  appendVirtualColumnIfNeeded();
  expect(virtualColumns()).toBe(1);
  expect(document.documentElement.scrollWidth / pageWidth).toBe(4);
});

test("a column taken by an overflowing image gets a second virtual column", () => {
  columns = 9;
  absorbed = 1;
  appendVirtualColumnIfNeeded();
  expect(virtualColumns()).toBe(2);
  expect(document.documentElement.scrollWidth / pageWidth).toBe(5);
  appendVirtualColumnIfNeeded();
  expect(virtualColumns()).toBe(2);
});

test("one column per screen gets none, and loses any left over", () => {
  columns = 7;
  absorbed = 0;
  appendVirtualColumnIfNeeded();
  window.getComputedStyle.mockReturnValue({
    getPropertyValue: (name) => (name == "column-count" ? "1" : ""),
  });
  appendVirtualColumnIfNeeded();
  expect(virtualColumns()).toBe(0);
});
