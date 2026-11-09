//
//  Copyright 2026 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

// How a <br> gets its "\n" in the page text (`separateLineBreaks` in decorator.js), from the computed
// style of the <br>. A "\n" that is drawn replaces the <br>; one that collapses goes after it. The
// WebKit side, with real stylesheets and inheritance, is covered by the app's ReadiumScriptsTests.
// Run with `pnpm test` from Sources/Navigator/EPUB/Scripts.

import { keepsNewlines } from "../src/line-breaks";

describe("white-space-collapse, where the engine has it (WebKit since iOS 17.4)", () => {
  test.each([
    // white-space: pre and pre-wrap.
    ["preserve", true],
    // white-space: pre-line.
    ["preserve-breaks", true],
    // white-space: break-spaces.
    ["break-spaces", true],
    // white-space: normal and nowrap.
    ["collapse", false],
    // Newlines become spaces.
    ["preserve-spaces", false],
  ])("%s keeps newlines: %s", (whiteSpaceCollapse, expected) => {
    // white-space is the shorthand: it doesn't decide once the longhand is there.
    expect(keepsNewlines({ whiteSpace: "normal", whiteSpaceCollapse })).toBe(
      expected
    );
  });
});

describe("white-space alone, in older engines", () => {
  test.each([
    ["pre", true],
    ["pre-wrap", true],
    ["pre-line", true],
    ["break-spaces", true],
    ["normal", false],
    ["nowrap", false],
  ])("%s keeps newlines: %s", (whiteSpace, expected) => {
    expect(keepsNewlines({ whiteSpace, whiteSpaceCollapse: undefined })).toBe(
      expected
    );
    expect(keepsNewlines({ whiteSpace, whiteSpaceCollapse: "" })).toBe(
      expected
    );
  });
});
