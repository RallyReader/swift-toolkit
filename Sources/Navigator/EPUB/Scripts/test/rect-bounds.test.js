//
//  Copyright 2026 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

// The rect the app gets for a decorated word (RR-9599): the union of the boxes the highlight draws, without the
// zero-width rects WebKit adds at a line's edge next to a <br>. The WebKit side is covered by the app's
// ReadiumScriptsTests. Run with `pnpm test` from Sources/Navigator/EPUB/Scripts.

import { unionOfDrawnRects } from "../src/rect";

function rect(left, top, width, height) {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  };
}

describe("unionOfDrawnRects", () => {
  test("a word after a kept newline: the empty rect on the line above is not counted (iOS 17 and 18)", () => {
    // "EMOTIONAL" in a white-space: pre box, as WebKit 18 reports its range.
    const rects = [rect(409, 136, 0, 60), rect(103, 193, 306, 60)];
    expect(unionOfDrawnRects(rects)).toMatchObject({
      left: 103,
      top: 193,
      width: 306,
      height: 60,
    });
  });

  test("a word before a <br>: the empty rect at the next line's start is not counted", () => {
    // "YOU" in collapsing text, its range ending where the next line starts.
    const rects = [rect(264, 136, 113, 60), rect(103, 193, 0, 60)];
    expect(unionOfDrawnRects(rects)).toMatchObject({
      left: 264,
      top: 136,
      width: 113,
      height: 60,
    });
  });

  test("a word split over two lines keeps both", () => {
    const rects = [rect(500, 100, 80, 40), rect(20, 150, 60, 40)];
    expect(unionOfDrawnRects(rects)).toMatchObject({
      left: 20,
      top: 100,
      right: 580,
      bottom: 190,
    });
  });

  test("a hairline is dropped as the highlight drops it", () => {
    expect(
      unionOfDrawnRects([rect(10, 10, 0.05, 60), rect(30, 10, 20, 20)])
    ).toMatchObject({ left: 30, width: 20 });
  });

  test("nothing drawn: null, so the caller keeps the plain bounding rect", () => {
    expect(unionOfDrawnRects([])).toBeNull();
    expect(unionOfDrawnRects([rect(10, 10, 0, 60)])).toBeNull();
  });
});
