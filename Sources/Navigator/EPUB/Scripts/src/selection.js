//
//  Copyright 2021 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

import { log as logNative, logError } from "./utils";
import { toNativeRect } from "./rect";
import { TextRange } from "./vendor/hypothesis/anchoring/text-range";

// Polyfill for iOS 12
import matchAll from "string.prototype.matchall";
matchAll.shim();

const debug = true;

export function getCurrentSelection() {
  if (!readium.link) {
    return null;
  }
  const href = readium.link.href;
  if (!href) {
    return null;
  }
  const text = getCurrentSelectionText();
  if (!text) {
    return null;
  }
  const rect = getSelectionRect();
  return { href, text, rect };
}

function getSelectionRect() {
  try {
    let sel = window.getSelection();
    if (!sel) {
      return;
    }
    let range = sel.getRangeAt(0);

    return toNativeRect(range.getBoundingClientRect());
  } catch (e) {
    logError(e);
    return null;
  }
}

function getCurrentSelectionText() {
  const selection = window.getSelection();
  if (!selection) {
    return undefined;
  }
  if (selection.isCollapsed) {
    return undefined;
  }
  let highlight = selection.toString();

  log(`selection highlight: ${highlight}`);
  let cleanHighlight = highlight
    .trim()
    .replace(/\n/g, " ")
    .replace(/\s\s+/g, " ");

  log(`selection clean highlight: ${cleanHighlight}`);

  if (cleanHighlight.length === 0) {
    return undefined;
  }
  if (!selection.anchorNode || !selection.focusNode) {
    return undefined;
  }

  const range =
    selection.rangeCount === 1
      ? selection.getRangeAt(0)
      : createOrderedRange(
          selection.anchorNode,
          selection.anchorOffset,
          selection.focusNode,
          selection.focusOffset
        );
  if (!range || range.collapsed) {
    log("$$$$$$$$$$$$$$$$$ CANNOT GET NON-COLLAPSED SELECTION RANGE?!");
    return undefined;
  }

  return getTextFrom(highlight, range);
}

export function getTextFrom(highlight, range) {
  // Generate the text by traversing the document and replacing <br> with \n
  let node = document.body.firstChild;
  let fullText = "";

  function processElement(element) {
    if (element.nodeType === Node.TEXT_NODE) {
      fullText += element.textContent;
    } else if (element.nodeName === "br") {
      fullText += "\n";
    }
  }

  function processNode(node) {
    if (node.nodeName === "p") {
      if (!/\s$/.test(fullText)) {
        log(`appending new line before paragraph`);
        fullText += "\n";
      }
    }

    if (node.childNodes.length > 0) {
      let child = node.firstChild;
      while (child) {
        processNode(child);
        child = child.nextSibling;
      }
    } else {
      processElement(node);
    }
  }

  while (node) {
    processNode(node);
    node = node.nextSibling;
  }

  log(`full text: ${fullText}`);

  // Now calculate offsets in the new fullText, including newline characters
  const originalText = document.body.textContent;

  // Adjust range start and end offsets by counting characters that were altered in the new text
  let rangeStartOffset = 0;
  let rangeEndOffset = 0;
  let originalStart = TextRange.fromRange(range).relativeTo(document.body).start
    .offset;
  let originalEnd = TextRange.fromRange(range).relativeTo(document.body).end
    .offset;

  // Traverse original text and fullText at the same time to find the correct offsets
  for (
    let i = 0, j = 0;
    i < originalText.length && j < fullText.length;
    i++, j++
  ) {
    // Match characters between original and fullText
    if (originalText[i] !== fullText[j]) {
      if (fullText[j] === "\n") {
        // Skip newline added in fullText for <br> in original HTML
        i--; // stay at the same position in originalText
      } else if (originalText[i] === "\n") {
        j--; // skip newline in originalText
      }
    }

    // Set the start and end offsets when we reach the selection start and end in the original text
    if (i === originalStart) {
      rangeStartOffset = j;
    }
    if (i === originalEnd) {
      rangeEndOffset = j;
      break;
    }
  }

  const snippetLength = 200;

  // Compute the text before the highlight
  let before = fullText.slice(
    Math.max(0, rangeStartOffset - snippetLength),
    rangeStartOffset
  );
  let firstWordStart = before.search(/\P{L}\p{L}/gu);
  if (firstWordStart !== -1) {
    before = before.slice(firstWordStart + 1);
  }

  // Compute the text after the highlight
  let after = fullText.slice(
    rangeEndOffset,
    Math.min(fullText.length, rangeEndOffset + snippetLength)
  );
  let lastWordEnd = Array.from(after.matchAll(/\p{L}\P{L}/gu)).pop();
  if (lastWordEnd !== undefined && lastWordEnd.index > 1) {
    after = after.slice(0, lastWordEnd.index + 1);
  }

  log(`before: ${before}`);
  log(`highlight: ${highlight}`);
  log(`after: ${after}`);

  // Return the correctly synchronized highlight, before, and after
  return { highlight, before, after };
}

function createOrderedRange(startNode, startOffset, endNode, endOffset) {
  const range = new Range();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  if (!range.collapsed) {
    return range;
  }
  log(">>> createOrderedRange COLLAPSED ... RANGE REVERSE?");
  const rangeReverse = new Range();
  rangeReverse.setStart(endNode, endOffset);
  rangeReverse.setEnd(startNode, startOffset);
  if (!rangeReverse.collapsed) {
    log(">>> createOrderedRange RANGE REVERSE OK.");
    return range;
  }
  log(">>> createOrderedRange RANGE REVERSE ALSO COLLAPSED?!");
  return undefined;
}

export function convertRangeInfo(document, rangeInfo) {
  const startElement = document.querySelector(
    rangeInfo.startContainerElementCssSelector
  );
  if (!startElement) {
    log("^^^ convertRangeInfo NO START ELEMENT CSS SELECTOR?!");
    return undefined;
  }
  let startContainer = startElement;
  if (rangeInfo.startContainerChildTextNodeIndex >= 0) {
    if (
      rangeInfo.startContainerChildTextNodeIndex >=
      startElement.childNodes.length
    ) {
      log(
        "^^^ convertRangeInfo rangeInfo.startContainerChildTextNodeIndex >= startElement.childNodes.length?!"
      );
      return undefined;
    }
    startContainer =
      startElement.childNodes[rangeInfo.startContainerChildTextNodeIndex];
    if (startContainer.nodeType !== Node.TEXT_NODE) {
      log("^^^ convertRangeInfo startContainer.nodeType !== Node.TEXT_NODE?!");
      return undefined;
    }
  }
  const endElement = document.querySelector(
    rangeInfo.endContainerElementCssSelector
  );
  if (!endElement) {
    log("^^^ convertRangeInfo NO END ELEMENT CSS SELECTOR?!");
    return undefined;
  }
  let endContainer = endElement;
  if (rangeInfo.endContainerChildTextNodeIndex >= 0) {
    if (
      rangeInfo.endContainerChildTextNodeIndex >= endElement.childNodes.length
    ) {
      log(
        "^^^ convertRangeInfo rangeInfo.endContainerChildTextNodeIndex >= endElement.childNodes.length?!"
      );
      return undefined;
    }
    endContainer =
      endElement.childNodes[rangeInfo.endContainerChildTextNodeIndex];
    if (endContainer.nodeType !== Node.TEXT_NODE) {
      log("^^^ convertRangeInfo endContainer.nodeType !== Node.TEXT_NODE?!");
      return undefined;
    }
  }
  return createOrderedRange(
    startContainer,
    rangeInfo.startOffset,
    endContainer,
    rangeInfo.endOffset
  );
}

export function location2RangeInfo(location) {
  const locations = location.locations;
  const domRange = locations.domRange;
  const start = domRange.start;
  const end = domRange.end;

  return {
    endContainerChildTextNodeIndex: end.textNodeIndex,
    endContainerElementCssSelector: end.cssSelector,
    endOffset: end.offset,
    startContainerChildTextNodeIndex: start.textNodeIndex,
    startContainerElementCssSelector: start.cssSelector,
    startOffset: start.offset,
  };
}

function log() {
  if (debug) {
    logNative.apply(null, arguments);
  }
}
