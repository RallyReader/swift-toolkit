//
//  Copyright 2021 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

import {
  getClientRectsNoOverlap,
  rectContainsPoint,
  toNativeRect,
} from "./rect";
import {
  log,
  logErrorMessage,
  rangeFromLocator,
  getOCRCorrectedRect,
  getAllOCRCorrectedRects,
} from "./utils";

// Polyfill for iOS 13.3
import { ResizeObserver as ResizeObserverPolyfill } from "@juggle/resize-observer";
const ResizeObserver = window.ResizeObserver || ResizeObserverPolyfill;

let styles = new Map();
let groups = new Map();
var lastGroupId = 0;

/**
 * Registers a list of additional supported Decoration Templates.
 *
 * Each template object is indexed by the style ID.
 */
export function registerTemplates(newStyles) {
  var stylesheet = "";

  for (const [id, style] of Object.entries(newStyles)) {
    styles.set(id, style);
    if (style.stylesheet) {
      stylesheet += style.stylesheet + "\n";
    }
  }

  if (stylesheet) {
    let styleElement = document.createElement("style");
    styleElement.innerHTML = stylesheet;
    document.getElementsByTagName("head")[0].appendChild(styleElement);
  }

  // Append our containment style for the visible area
  let containStyle = document.createElement("style");
  containStyle.innerHTML = `
    .visible-area {
      contain: layout paint style;
      position: absolute;
      width: 100%;
      height: 100%;
      top: 0px;
      }
  `;
  document.head.appendChild(containStyle);

  // let containerStyle = document.createElement("style");
  // containerStyle.innerHTML = `
  //   .my-general-container {
  //   background-color: rgba(255, 0, 0, 0.3);
  //   }
  // `;
  // document.head.appendChild(containerStyle);

  let imgStyle = document.createElement("style");
  imgStyle.innerHTML = `
    img {
        pointer-events: none;
    }
  `;
  document.head.appendChild(imgStyle);

  log(`Document html content: ${document.innerHTML}`);

  // Process span elements to ensure proper text spacing and handle HTML entities
  processSpansForTextSpacing();
  // log(`Document body text content AFTER: ${document.body.textContent}`);

  // log(
  //   `DID REGISTER TEMPLATES for ${
  //     document.location.href || document.title || "document"
  //   }`
  // );
}

/**
 * Processes spans in the document to ensure proper spacing between text segments.
 * This prevents words from being incorrectly stitched together when extracting text.
 */
function processSpansForTextSpacing() {
  // Create a mapping of HTML entities to their character equivalents
  const entityMap = {
    "&rsquo;": "'", // right single quote
    "&lsquo;": "'", // left single quote
    "&rdquo;": '"', // right double quote
    "&ldquo;": '"', // left double quote
    "&ndash;": "–", // en dash
    "&mdash;": "—", // em dash
    "&nbsp;": " ", // non-breaking space
    "&amp;": "&", // ampersand
    "&lt;": "<", // less than
    "&gt;": ">", // greater than
  };

  // Handle HTML entities - decode them properly
  const entityPattern = new RegExp(Object.keys(entityMap).join("|"), "gi");
  document.body.innerHTML = document.body.innerHTML.replace(
    entityPattern,
    (match) => entityMap[match.toLowerCase()]
  );

  // Create a mapping of Unicode ligatures to their regular character equivalents
  const ligatureMap = {
    "\uFB00": "ff", // ﬀ -> ff
    "\uFB01": "fi", // ﬁ -> fi
    "\uFB02": "fl", // ﬂ -> fl
    "\uFB03": "ffi", // ﬃ -> ffi
    "\uFB04": "ffl", // ﬄ -> ffl
    "\uFB05": "st", // ﬅ -> st
    "\uFB06": "st", // ﬆ -> st
    "\u0132": "IJ", // Ĳ -> IJ
    "\u0133": "ij", // ĳ -> ij
    "\u0152": "OE", // Œ -> OE
    "\u0153": "oe", // œ -> oe
  };

  // Replace all ligatures in one pass using a function
  const ligaturePattern = new RegExp(Object.keys(ligatureMap).join("|"), "g");
  document.body.innerHTML = document.body.innerHTML.replace(
    ligaturePattern,
    (match) => ligatureMap[match]
  );

  // Continue with the rest of the function
  document.body.innerHTML = document.body.innerHTML.replace(
    /<br\s*\/>/g,
    "$&\n"
  );
  document.body.innerHTML = document.body.innerHTML.replace(
    /([^\n])<(div|p)/g,
    "$1\n<$2"
  );

  // Get all spans in the document
  const nodes = document.querySelectorAll("span");

  // Group spans by parent element to analyze siblings
  const nodesByParent = {};
  for (const node of nodes) {
    // if (node.nodeName === "div") {
    //   if (node.style.bottom === undefined) {
    //     node.parentElement.insertBefore(document.createTextNode("\n"), node);
    //     continue;
    //   }
    // }
    const parentKey = node.parentElement
      ? node.parentElement.tagName +
        "_" +
        (node.parentElement.id || Math.random())
      : "orphan";
    if (!nodesByParent[parentKey]) {
      nodesByParent[parentKey] = [];
    }
    nodesByParent[parentKey].push(node);
    // log(`add node: ${node.textContent} to parent: ${parentKey}`);
  }

  // First pass: Process spans and mark those that need spacing
  for (const parentKey in nodesByParent) {
    const siblingSpans = nodesByParent[parentKey].slice();

    // // Sort spans by their vertical position (bottom value)
    // siblingSpans.sort((a, b) => {
    //   const aBottom = parseFloat(a.style.bottom || "0");
    //   const bBottom = parseFloat(b.style.bottom || "0");
    //   return bBottom - aBottom; // Sort from top to bottom (larger bottom value is higher)
    // });

    // if (siblingSpans.length === 1) {
    //   const span = siblingSpans[0];
    //   if (span.nodeName === "div") {
    //     span.parentElement.insertBefore(document.createTextNode("\n"), span);
    //   } else {
    //     // if (span.style.hasAttribute("word-spacing")) {
    //     //   span.parentElement.insertBefore(document.createTextNode(" "), span);
    //     // }
    //   }
    // }

    // Analyze bottom distances between adjacent siblings
    for (let i = 1; i < siblingSpans.length; i++) {
      const currentSpan = siblingSpans[i];
      const previousSpan = siblingSpans[i - 1];

      const currentBottom = parseFloat(currentSpan.style.bottom || "0");
      const previousBottom = parseFloat(previousSpan.style.bottom || "0");
      const currentLeft = parseFloat(currentSpan.style.left || "0");
      const previousLeft = parseFloat(previousSpan.style.left || "0");

      // Calculate vertical distance between spans
      const bottomDifference =
        previousBottom < currentBottom
          ? previousBottom / currentBottom
          : currentBottom / previousBottom;

      const leftDifference =
        previousLeft < currentLeft
          ? previousLeft / currentLeft
          : currentLeft / previousLeft;

      //   log(
      //     `previous span: ${previousSpan.textContent} | current span: ${currentSpan.textContent} | bottom difference: ${bottomDifference} | left difference: ${leftDifference}`
      //   );

      // If there's a significant vertical gap, mark for spacing
      if (
        bottomDifference < 0.87 ||
        leftDifference > 0.99 ||
        leftDifference < 0.1
      ) {
        // log(`adding spacing before: ${currentSpan.textContent}`);
        currentSpan.setAttribute("data-needs-spacing", "true");
      }
    }
  }

  // Second pass: Insert spaces where needed, but before the span elements instead of inside them
  for (const span of document.querySelectorAll(
    'span[data-needs-spacing="true"]'
  )) {
    // Insert a space before the span element (not inside it)
    if (span.parentElement) {
      span.parentElement.insertBefore(document.createTextNode(" "), span);
      // log(`inserted space before span: ${span.textContent}`);
    } else {
      //   logErrorMessage(
      //     `Failed to insert space before span: ${span.textContent}`
      //   );
    }

    // Remove the marker attribute
    span.removeAttribute("data-needs-spacing");
  }
}

/**
 * Returns an instance of DecorationGroup for the given group name.
 */
export function getDecorations(groupName) {
  var group = groups.get(groupName);
  if (!group) {
    let id = "r2-decoration-" + lastGroupId++;
    group = DecorationGroup(id, groupName);
    groups.set(groupName, group);
  }
  return group;
}

/**
 * Handles click events on a Decoration.
 * Returns whether a decoration matched this event.
 */
export function handleDecorationClickEvent(event, clickEvent) {
  if (groups.size === 0) {
    return false;
  }

  function findTarget() {
    for (const [group, groupContent] of groups) {
      if (!groupContent.isActivable()) {
        continue;
      }

      for (const item of groupContent.items.reverse()) {
        if (!item.clickableElements) {
          continue;
        }
        for (const element of item.clickableElements) {
          let rect = element.getBoundingClientRect().toJSON();
          if (rectContainsPoint(rect, event.clientX, event.clientY, 1)) {
            return { group, item, element, rect };
          }
        }
      }
    }
  }

  let target = findTarget();
  if (!target) {
    return false;
  }
  webkit.messageHandlers.decorationActivated.postMessage({
    id: target.item.decoration.id,
    group: target.group,
    rect: toNativeRect(target.item.range.getBoundingClientRect()),
    click: clickEvent,
  });
  return true;
}

/**
 * Creates a DecorationGroup object from a unique HTML ID and its name.
 */
export function DecorationGroup(groupId, groupName) {
  var items = [];
  var lastItemId = 0;
  var container = null;
  var activable = false;
  var visibleContainers = [];

  function isActivable() {
    return activable;
  }

  function setActivable() {
    activable = true;
  }

  /**
   * Adds a new decoration to the group.
   */
  function add(decoration) {
    let id = groupId + "-" + lastItemId++;

    let range = rangeFromLocator(decoration.locator);
    if (!range) {
      log("Can't locate DOM range for decoration", decoration);
      return;
    }

    let item = { id, decoration, range, enhanced: false };
    items.push(item);
    layout(item, true);
  }

  function addEnhanced(decoration) {
    let id = groupId + "-" + lastItemId++;

    let range = rangeFromLocator(decoration.locator);
    if (!range) {
      log("Can't locate DOM range for decoration", decoration);
      return;
    }

    let item = { id, decoration, range, enhanced: true };
    items.push(item);
    layoutEnhanced(item, true);
  }

  /**
   * Removes the decoration with given ID from the group.
   */
  function remove(decorationId) {
    let index = items.findIndex((i) => i.decoration.id === decorationId);
    if (index === -1) {
      return;
    }

    let item = items[index];
    items.splice(index, 1);
    item.clickableElements = null;
    if (item.container) {
      item.container.remove();
      item.container = null;
    }
  }

  /**
   * Notifies that the given decoration was modified and needs to be updated.
   */
  function update(decoration) {
    remove(decoration.id);
    add(decoration);
  }

  /**
   * Removes all decorations from this group.
   */
  function clear() {
    clearContainer();
    items.length = 0;
  }

  function clearAllEnhanced() {
    log(`clearAllEnhanced`);
    visibleContainers.forEach((container) => {
      log(`clearing container: ${container.id}`);
      container.remove();
      container = null;
    });

    visibleContainers.length = 0;
  }

  function clearEnhanced(decorationId) {
    // Iterate over each item in the items array
    log(`trying to clear decorsation: ${decorationId}`);
    items.forEach((item) => {
      // Check if the item's decoration id matches the one we want to remove
      if (item.decoration.id === decorationId && item.container) {
        item.container.remove();
      }
    });

    // Optionally, remove the item from the items array if you want to stop tracking it
    items = items.filter((item) => item.decoration.id !== decorationId);
  }

  /**
   * Recreates the decoration elements.
   *
   * To be called after reflowing the resource, for example.
   */
  function requestLayout() {
    clearContainer();
    clearAllEnhanced();
    cachedTextContentBounds = null;
    items.forEach((item) => {
      // A failure on a single item must not abort the whole relayout,
      // otherwise every decoration cleared above stays gone.
      try {
        if (item.enhanced) {
          layoutEnhanced(item, false, true);
        } else {
          layout(item, false);
        }
      } catch (error) {
        logErrorMessage(
          `Error laying out decoration ${item.id}: ${error.message}`
        );
      }
    });
  }

  /**
   * Layouts a single Decoration item.
   */
  function layout(item, postMessage) {
    let groupContainer = requireContainer();

    let style = styles.get(item.decoration.style);
    if (!style) {
      logErrorMessage(`Unknown decoration style: ${item.decoration.style}`);
      return;
    }

    let itemContainer = document.createElement("div");
    itemContainer.setAttribute("id", item.id);
    itemContainer.setAttribute("data-style", item.decoration.style);
    itemContainer.style.setProperty("pointer-events", "none");

    let viewportWidth = window.innerWidth;
    let columnCount = parseInt(
      getComputedStyle(document.documentElement).getPropertyValue(
        "column-count"
      )
    );
    let pageWidth = viewportWidth / (columnCount || 1);
    let scrollingElement = document.scrollingElement;
    let xOffset = scrollingElement.scrollLeft;
    let yOffset = scrollingElement.scrollTop;

    function positionElement(element, rect, boundingRect) {
      element.style.position = "absolute";

      log(`layout style width: ${style.width}`);
      log(`layout element style width: ${element.style.width}`);
      log(`layout rect width: ${rect.width}`);
      log(`layout rect left: ${rect.left}`);

      if (style.width === "wrap") {
        element.style.width = `${rect.width}px`;
        element.style.height = `${rect.height}px`;
        element.style.left = `${rect.left + xOffset}px`;
        element.style.top = `${rect.top + yOffset}px`;
      } else if (style.width === "viewport") {
        element.style.width = `${viewportWidth}px`;
        element.style.height = `${rect.height}px`;
        let left = Math.floor(rect.left / viewportWidth) * viewportWidth;
        element.style.left = `${left + xOffset}px`;
        element.style.top = `${rect.top + yOffset}px`;
      } else if (style.width === "bounds") {
        element.style.width = `${boundingRect.width}px`;
        element.style.height = `${rect.height}px`;
        element.style.left = `${boundingRect.left + xOffset}px`;
        element.style.top = `${rect.top + yOffset}px`;
      } else if (style.width === "page") {
        element.style.width = `${pageWidth}px`;
        element.style.height = `${rect.height}px`;
        let left = Math.floor(rect.left / pageWidth) * pageWidth;
        element.style.left = `${left + xOffset}px`;
        element.style.top = `${rect.top + yOffset}px`;
      }
    }

    let boundingRect = item.range.getBoundingClientRect();

    let elementTemplate;
    try {
      let template = document.createElement("template");
      template.innerHTML = item.decoration.element.trim();
      elementTemplate = template.content.firstElementChild;
    } catch (error) {
      logErrorMessage(
        `Invalid decoration element "${item.decoration.element}": ${error.message}`
      );
      return;
    }

    if (style.layout === "boxes") {
      let doNotMergeHorizontallyAlignedRects = true;
      let clientRects = getClientRectsNoOverlap(
        item.range,
        doNotMergeHorizontallyAlignedRects
      );

      clientRects = clientRects.sort((r1, r2) => {
        if (r1.top < r2.top) {
          return -1;
        } else if (r1.top > r2.top) {
          return 1;
        } else {
          return 0;
        }
      });

      for (let clientRect of clientRects) {
        const line = elementTemplate.cloneNode(true);
        line.style.setProperty("pointer-events", "none");
        positionElement(line, clientRect, boundingRect);
        itemContainer.append(line);
      }
    } else if (style.layout === "bounds") {
      const bounds = elementTemplate.cloneNode(true);
      bounds.style.setProperty("pointer-events", "none");
      positionElement(bounds, boundingRect, boundingRect);

      itemContainer.append(bounds);
    }

    groupContainer.append(itemContainer);
    item.container = itemContainer;
    item.clickableElements = Array.from(
      itemContainer.querySelectorAll("[data-activable='1']")
    );
    if (item.clickableElements.length === 0) {
      item.clickableElements = Array.from(itemContainer.children);
    }

    if (postMessage) {
      webkit.messageHandlers.decorationRect.postMessage({
        id: item.decoration.id,
        group: groupName,
        rect: toNativeRect(boundingRect),
        ocrLayout: false,
      });
    }
  }

  let cachedTextContentBounds = null;

  // Computes the vertical extent (minY/maxY) of all text content on the
  // page so we can check whether an element is at the top/bottom of the
  // actual text area rather than the viewport.
  function getTextContentBounds() {
    if (cachedTextContentBounds) return cachedTextContentBounds;

    let minY = Infinity;
    let maxY = -Infinity;

    // OCR layouts: every word is in its own .text-overlay element
    let textElements = document.querySelectorAll(".text-overlay");

    if (textElements.length === 0) {
      // Regular fixed-layout: text frames inside the text layer
      textElements = document.querySelectorAll(
        '#text-layer [class*="textframe"], #main-content [class*="textframe"]'
      );
    }

    for (const el of textElements) {
      const rect = el.getBoundingClientRect();
      if (rect.height > 0 && rect.width > 0) {
        minY = Math.min(minY, rect.top);
        maxY = Math.max(maxY, rect.bottom);
      }
    }

    if (minY === Infinity || maxY === -Infinity) {
      cachedTextContentBounds = {
        minY: 0,
        maxY: window.innerHeight,
        measured: false,
      };
    } else {
      cachedTextContentBounds = { minY, maxY, measured: true };
    }

    return cachedTextContentBounds;
  }

  function isPageNumber(text) {
    const trimmedText = text.trim();
    // Only return true for strings that consist entirely of digits
    return /^\d+$/.test(trimmedText);
  }

  function layoutEnhanced(item, postMessage, isRelayout = false) {
    let style = styles.get(item.decoration.style);
    if (!style) {
      logErrorMessage(`Unknown decoration style: ${item.decoration.style}`);
      return;
    }

    // Get the bounding rect for the decoration
    let boundingRect = item.range.getBoundingClientRect();

    // Calculate which page (container) this decoration belongs to based on its left position
    let viewportWidth = window.innerWidth;
    let pageIndex = 0;

    function postMessageWithInvalidRect() {
      logErrorMessage(`fallback to invalid rect`);
      if (postMessage) {
        webkit.messageHandlers.decorationRect.postMessage({
          id: item.decoration.id,
          group: groupName,
          rect: { left: 0, top: 0, width: 0, height: 0 },
          ocrLayout: false,
        });
      }
    }

    try {
      log(
        `bounding rect: {left: ${boundingRect.left}, top: ${boundingRect.top}, width: ${boundingRect.width}, height: ${boundingRect.height} for: ${item.range}}`
      );
      // Skip the visibility filter when relaying out existing decorations:
      // after the spread is scrolled to the reading position, decorations on
      // previous pages legitimately have negative client rects. They were
      // already validated when first added, so they must be redrawn.
      const documentLeft = boundingRect.left + window.scrollX;
      const documentTop =
        boundingRect.top + document.scrollingElement.scrollTop;
      if (
        !isRelayout &&
        item.decoration.userInfo.shoulNotBeIgnored !== true &&
        (documentLeft + boundingRect.width < 0 ||
          documentTop + boundingRect.height < 0)
      ) {
        postMessageWithInvalidRect();
        return;
      }

      pageIndex = Math.max(
        0,
        Math.floor((boundingRect.left + window.scrollX) / viewportWidth)
      );
    } catch (error) {
      logErrorMessage(`Error calculating page index: ${error.message}`);
      postMessageWithInvalidRect();
      return;
    }

    // Start timing the isolated page number check
    const startTime = performance.now();

    const text = item.decoration.locator.text.highlight;
    if (text && isPageNumber(text)) {
      log(`PAGE NUMBER :: page number detected: ${text}`);

      // Check position relative to the actual text content area, not the
      // viewport — handles pages where text is in a smaller centered section.
      // Use a tight threshold when we measured real text bounds (OCR/fixed),
      // and a more generous one when falling back to the viewport (regular books).
      const textBounds = getTextContentBounds();
      const textHeight = textBounds.maxY - textBounds.minY;
      const relativeTop = boundingRect.top - textBounds.minY;
      const posThreshold = textBounds.measured ? 0.05 : 0.15;
      const isAtTopOrBottom =
        textHeight > 0
          ? relativeTop < textHeight * posThreshold ||
            relativeTop > textHeight * (1 - posThreshold)
          : false;

      if (isAtTopOrBottom) {
        log(`PAGE NUMBER :: is at top or bottom: ${text}`);

        const before = item.decoration.locator.text.before || "";
        const after = item.decoration.locator.text.after || "";

        // IMPROVEMENT 2: Check for punctuation + whitespace pattern before page number
        // This catches cases like "whole sleepover." followed by the page number
        const beforeEndsWithPunctuationAndWhitespace = /[.!?;:]\s*$/.test(
          before
        );

        // IMPROVEMENT 3: Check for multiple newlines or significant whitespace
        const beforeHasMultipleNewlines = /\n\s*\n/.test(before);
        const beforeEndsWithSignificantWhitespace = /\s{2,}$/.test(before);

        // NEW IMPROVEMENT: Check what comes immediately before the number (after the last newline)
        // If it's a word like "Chapter", "Section", "Part", etc., it's not a page number
        const lastNewlineIndex = before.lastIndexOf("\n");
        const immediateTextBefore =
          lastNewlineIndex !== -1
            ? before.substring(lastNewlineIndex + 1)
            : before;
        const beforeEndsWithWordAndSpace = /[a-zA-Z]\s+$/.test(
          immediateTextBefore
        );

        // Check if the preceding text connects to this number via a
        // digit + connecting character (e.g., "8:" → "30" = time "8:30").
        // We collapse all whitespace to handle OCR layouts where each word
        // is in its own element separated by newlines.
        const beforeContentCollapsed = before.replace(/\s+/g, " ").trim();
        const beforeConnectsToNumber = /\d[:-]$/.test(beforeContentCollapsed);

        // Check if 'before' ends in newline, is empty, or has no alphanumeric characters
        const beforeIsEmpty = before.length === 0;
        const beforeEndsInNewline = before.endsWith("\n");
        const beforeHasNoAlphanumeric = !/[a-zA-Z0-9]/.test(before);

        // Check if 'after' begins with newline, is empty, or has no alphanumeric characters
        const afterIsEmpty = after.length === 0;
        const afterBeginsWithNewline = after.startsWith("\n");
        const afterHasNoAlphanumeric = !/[a-zA-Z0-9]/.test(after);
        // IMPROVEMENT 6: Check if 'after' begins with significant whitespace (space added by processSpansForTextSpacing)
        const afterBeginsWithWhitespace = /^\s/.test(after);

        // IMPROVEMENT 4: DOM structure check - is the page number in its own isolated element?
        let isDOMIsolated = false;
        try {
          let startNode = item.range.startContainer;
          if (startNode.nodeType === Node.TEXT_NODE) {
            startNode = startNode.parentElement;
          }

          // Check if this element only contains the page number (no other significant content)
          const parentText = startNode.textContent.trim();
          const isOnlyPageNumber = parentText === text.trim();

          // Check if parent has very little content (just the page number)
          const parentHasMinimalContent = parentText.length <= 5;

          // In OCR-style layouts (text-overlay divs inside ocr-container),
          // every word is in its own element, so DOM isolation is not meaningful.
          const isInOCRLayout =
            !!startNode.closest(".ocr-container") ||
            startNode.classList.contains("text-overlay");

          isDOMIsolated =
            !isInOCRLayout && (isOnlyPageNumber || parentHasMinimalContent);

          log(
            `PAGE NUMBER :: DOM isolation check - parentText: "${parentText}", isOnlyPageNumber: ${isOnlyPageNumber}, isInOCRLayout: ${isInOCRLayout}, isDOMIsolated: ${isDOMIsolated}`
          );
        } catch (error) {
          log(`PAGE NUMBER :: DOM isolation check failed: ${error.message}`);
        }

        // Original isolation check (keeping existing behavior)
        const isIsolatedPageNumber =
          (beforeIsEmpty || beforeEndsInNewline || beforeHasNoAlphanumeric) &&
          (afterIsEmpty ||
            afterBeginsWithNewline ||
            afterHasNoAlphanumeric ||
            afterBeginsWithWhitespace);

        // IMPROVEMENT 5: Enhanced isolation check with additional patterns
        // CRITICAL: Exclude numbers that immediately follow words (like "Chapter 1")
        const isIsolatedWithEnhancements =
          !beforeEndsWithWordAndSpace && // Exclude if preceded by word like "Chapter "
          !beforeConnectsToNumber && // Exclude if part of compound like "8:30"
          (isIsolatedPageNumber || // Keep original logic
            (isDOMIsolated &&
              (afterIsEmpty ||
                afterBeginsWithNewline ||
                afterHasNoAlphanumeric ||
                afterBeginsWithWhitespace)) || // DOM + after check
            (beforeEndsWithPunctuationAndWhitespace &&
              isDOMIsolated &&
              afterIsEmpty) || // Punctuation + DOM + end of content
            (beforeHasMultipleNewlines &&
              (afterIsEmpty ||
                afterBeginsWithNewline ||
                afterBeginsWithWhitespace)) || // Multiple newlines before
            (beforeEndsWithSignificantWhitespace &&
              isDOMIsolated &&
              afterIsEmpty)); // Significant whitespace + DOM + end of content

        // Calculate elapsed time
        const endTime = performance.now();
        const elapsedTime = endTime - startTime;
        log(
          `PAGE NUMBER :: isolation check took ${elapsedTime.toFixed(
            3
          )} ms for: ${text}`
        );

        log(`PAGE NUMBER :: before: "${before}"`);
        log(
          `PAGE NUMBER :: before is empty: ${beforeIsEmpty} | before ends in newline: ${beforeEndsInNewline} | before has no alphanumeric: ${beforeHasNoAlphanumeric}`
        );
        log(
          `PAGE NUMBER :: before ends with punctuation+whitespace: ${beforeEndsWithPunctuationAndWhitespace} | has multiple newlines: ${beforeHasMultipleNewlines} | ends with significant whitespace: ${beforeEndsWithSignificantWhitespace}`
        );
        log(
          `PAGE NUMBER :: immediate text before: "${immediateTextBefore}" | ends with word+space: ${beforeEndsWithWordAndSpace}`
        );
        log(
          `PAGE NUMBER :: collapsed before: "${beforeContentCollapsed}" | connects to number: ${beforeConnectsToNumber}`
        );

        log(`PAGE NUMBER :: after: "${after}"`);
        log(
          `PAGE NUMBER :: after is empty: ${afterIsEmpty} | after begins with newline: ${afterBeginsWithNewline} | after has no alphanumeric: ${afterHasNoAlphanumeric} | after begins with whitespace: ${afterBeginsWithWhitespace}`
        );

        log(
          `PAGE NUMBER :: original isolated: ${isIsolatedPageNumber} | with enhancements: ${isIsolatedWithEnhancements}`
        );

        if (isIsolatedWithEnhancements) {
          log(`PAGE NUMBER :: is isolated: ${text}`);
          postMessageWithInvalidRect();
          return;
        }
      }
    }

    let visibleAreaResponse = applyContainmentToArea(pageIndex); // Get or create the container for this page
    let visibleArea = visibleAreaResponse.visibleArea;
    let newArea = visibleAreaResponse.new;

    if (newArea) {
      log(`new area`);
      visibleContainers.push(visibleArea);
    }

    // Create the decoration element
    let itemContainer = document.createElement("div");
    itemContainer.setAttribute("id", item.id);
    itemContainer.setAttribute("data-style", item.decoration.style);
    itemContainer.style.setProperty("pointer-events", "none");

    // Adjust the position of the decoration relative to the container (page)
    // let xOffset =
    //   boundingRect.left - pageIndex * viewportWidth + window.scrollX; // Relative position within the page
    let xOffset = window.scrollX - pageIndex * viewportWidth;
    // let yOffset = boundingRect.top + window.scrollY;

    let scrollingElement = document.scrollingElement;
    let yOffset = scrollingElement.scrollTop;

    // log(`visible area :: bounding rect left: ${boundingRect.left}`);
    // log(`visible area :: page index: ${pageIndex}`);
    // log(`visible area :: viewport width: ${viewportWidth}`);
    // log(`visible area :: window screen x: ${window.scrollX}`);

    log(`yoffset: ${yOffset}`);

    // const computedStyle = window.getComputedStyle(item.range);
    // log(`computed style width: ${computedStyle.width}`);
    // log(`computed style height: ${computedStyle.height}`);

    // Try to get OCR-corrected rect for positioning
    const ocrRect = getOCRCorrectedRect(item.range);
    let ocrLayout = false;
    let computedLeft = undefined;
    let computedTop = undefined;
    let computedWidth = undefined;
    let computedHeight = undefined;
    let rotationAngle = undefined;

    if (ocrRect) {
      ocrLayout = true;
      computedLeft = ocrRect.left;
      computedTop = ocrRect.top;
      computedWidth = `${ocrRect.width}px`;
      computedHeight = `${ocrRect.height}px`;

      rotationAngle = ocrRect.rotation;
    } else {
      log("No OCR layout detected for this range.");
    }

    // Position the decoration element inside the page container
    function positionElement(
      element,
      rect,
      boundingRect,
      useOverlayPosition = false
    ) {
      // For OCR layouts, use fixed positioning to match viewport-relative coordinates
      // For regular layouts, use absolute positioning
      element.style.position = useOverlayPosition ? "fixed" : "absolute";
      log(`style width: ${style.width}`);
      log(`element style width: ${element.style.width}`);
      log(`rect width: ${rect.width}`);
      log(`rect left: ${rect.left}`);
      log(`applying computed width: ${computedWidth}`);

      // Use computed position from text-overlay only if explicitly requested and available
      // For boxes layout with multiple rects, we should use individual rect positions
      let leftPos =
        useOverlayPosition && computedLeft !== undefined
          ? computedLeft
          : rect.left;
      let topPos =
        useOverlayPosition && computedTop !== undefined
          ? computedTop
          : rect.top;

      log(
        `Using position - left: ${leftPos}, top: ${topPos} (useOverlayPosition: ${useOverlayPosition})`
      );

      log(
        "Debug positioning - yOffset:",
        yOffset,
        "leftPos:",
        leftPos,
        "topPos:",
        topPos
      );

      // For fixed positioning (OCR with overlay position), don't add offsets
      // For absolute positioning (normal content), add offsets
      let finalXOffset = useOverlayPosition ? 0 : xOffset;
      let finalYOffset = useOverlayPosition ? 0 : yOffset;

      if (style.width === "wrap") {
        if (
          useOverlayPosition &&
          computedWidth !== undefined &&
          computedHeight !== undefined
        ) {
          element.style.width = `${computedWidth}`;
          element.style.height = `${computedHeight}`;
        } else {
          element.style.width = `${rect.width}px`;
          element.style.height = `${rect.height}px`;
        }

        element.style.left = `${leftPos + finalXOffset}px`;
        element.style.top = `${topPos + finalYOffset}px`;
        log(
          `Set element position - left: ${leftPos + finalXOffset}px, top: ${
            topPos + finalYOffset
          }px`
        );
      } else if (style.width === "viewport") {
        element.style.width = `${viewportWidth}px`;
        element.style.height = `${rect.height}px`;
        element.style.left = `${finalXOffset}px`;
        element.style.top = `${topPos + finalYOffset}px`;
        log(
          `Set element position - left: ${finalXOffset}px, top: ${
            topPos + finalYOffset
          }px`
        );
      } else if (style.width === "bounds") {
        element.style.width = `${boundingRect.width}px`;
        element.style.height = `${rect.height}px`;
        element.style.left = `${boundingRect.left + finalXOffset}px`;
        element.style.top = `${topPos + finalYOffset}px`;
        log(
          `Set element position - left: ${
            boundingRect.left + finalXOffset
          }px, top: ${topPos + finalYOffset}px`
        );
      } else if (style.width === "page") {
        element.style.width = `${viewportWidth}px`;
        element.style.height = `${rect.height}px`;
        element.style.left = `${finalXOffset}px`;
        element.style.top = `${topPos + finalYOffset}px`;
        log(
          `Set element position - left: ${finalXOffset}px, top: ${
            topPos + finalYOffset
          }px`
        );
      }

      if (rotationAngle !== undefined) {
        // Determine whether the element already has a transform or an animation
        // that redefines `transform` in its keyframes. We need the element in
        // the live document for class-based styles to be computable.
        document.body.appendChild(element);
        const computed = window.getComputedStyle(element);
        const hasExistingTransform =
          element.style.transform !== "" || computed.animationName !== "none";
        document.body.removeChild(element);

        if (hasExistingTransform) {
          // Wrap: outer div holds position + rotation so the inner element's
          // animation keyframes (which redefine `transform`) cannot interfere.
          const wrapper = document.createElement("div");
          wrapper.style.position = element.style.position;
          wrapper.style.left = element.style.left;
          wrapper.style.top = element.style.top;
          wrapper.style.width = element.style.width;
          wrapper.style.height = element.style.height;
          wrapper.style.transform = `rotate(${rotationAngle}deg)`;
          wrapper.style.transformOrigin = "center";
          wrapper.style.setProperty("pointer-events", "none");
          log(`Applied rotation via wrapper: ${rotationAngle}deg`);

          element.style.position = "static";
          element.style.left = "";
          element.style.top = "";
          element.style.width = "100%";
          element.style.height = "100%";

          wrapper.append(element);
          return wrapper;
        } else {
          element.style.transform = `rotate(${rotationAngle}deg)`;
          element.style.transformOrigin = "center";
          log(`Applied rotation: ${rotationAngle}deg`);
        }
      }
      return element;
    }

    let elementTemplate;
    try {
      let template = document.createElement("template");
      template.innerHTML = item.decoration.element.trim();
      elementTemplate = template.content.firstElementChild;
    } catch (error) {
      logErrorMessage(
        `Invalid decoration element "${item.decoration.element}": ${error.message}`
      );
      return;
    }

    log(`style layout: ${style.layout}`);
    try {
      if (style.layout === "boxes") {
        let doNotMergeHorizontallyAlignedRects = true;
        let clientRects = getClientRectsNoOverlap(
          item.range,
          doNotMergeHorizontallyAlignedRects
        );

        clientRects = clientRects.sort((r1, r2) => {
          if (r1.top < r2.top) {
            return -1;
          } else if (r1.top > r2.top) {
            return 1;
          } else {
            return 0;
          }
        });

        log(`client rects: ${clientRects.length} for ${item.range}`);

        if (ocrLayout && clientRects.length > 1) {
          // Multi-rect OCR: get the corrected rect for each text-overlay
          let ocrRects = getAllOCRCorrectedRects(item.range);
          if (ocrRects && ocrRects.length > 0) {
            for (let ocrRectItem of ocrRects) {
              computedLeft = ocrRectItem.left;
              computedTop = ocrRectItem.top;
              computedWidth = `${ocrRectItem.width}px`;
              computedHeight = `${ocrRectItem.height}px`;
              rotationAngle = ocrRectItem.rotation;

              const line = elementTemplate.cloneNode(true);
              line.style.setProperty("pointer-events", "none");
              itemContainer.append(
                positionElement(line, ocrRectItem, boundingRect, true)
              );
            }
          } else {
            for (let clientRect of clientRects) {
              const line = elementTemplate.cloneNode(true);
              line.style.setProperty("pointer-events", "none");
              itemContainer.append(
                positionElement(line, clientRect, boundingRect, false)
              );
            }
          }
        } else {
          let useOverlay = clientRects.length === 1 && ocrLayout;

          for (let clientRect of clientRects) {
            const line = elementTemplate.cloneNode(true);
            line.style.setProperty("pointer-events", "none");
            itemContainer.append(
              positionElement(line, clientRect, boundingRect, useOverlay)
            );
          }
        }
      } else if (style.layout === "bounds") {
        const bounds = elementTemplate.cloneNode(true);
        bounds.style.setProperty("pointer-events", "none");
        // Use overlay position for bounds layout when available
        itemContainer.append(
          positionElement(bounds, boundingRect, boundingRect, ocrLayout)
        );
      }
    } catch (error) {
      logErrorMessage(`Error calculating position: ${error.message}`);
      if (postMessage) {
        webkit.messageHandlers.decorationRect.postMessage({
          id: item.decoration.id,
          group: groupName,
          rect: null,
          ocrLayout: false,
        });
      }
      return;
    }

    // Add the decoration to the corresponding visible area container (page)
    visibleArea.append(itemContainer);
    item.container = itemContainer;

    if (postMessage) {
      webkit.messageHandlers.decorationRect.postMessage({
        id: item.decoration.id,
        group: groupName,
        rect: toNativeRect(boundingRect),
        ocrLayout: ocrLayout,
      });
    }
  }

  /**
   * Returns the group container element, after making sure it exists.
   */
  function requireContainer() {
    if (!container) {
      container = document.createElement("div");
      container.classList.add("my-general-container");
      container.setAttribute("id", groupId);
      container.setAttribute("data-group", groupName);
      container.style.setProperty("pointer-events", "none");

      requestAnimationFrame(function () {
        if (container != null) {
          document.body.append(container);
        }
      });
    }
    return container;
  }

  function applyContainmentToArea(pageIndex) {
    let viewportWidth = window.innerWidth;
    let visibleAreaLeft = pageIndex * viewportWidth; // Each page is one viewport width in size
    let visibleAreaId = `visible-area-${pageIndex}`;

    let newArea = false;
    let visibleArea = null;

    for (const container of visibleContainers) {
      if (container.id === visibleAreaId) {
        visibleArea = container;
        log(`using container from array: ${container.id}`);
        break;
      }
    }

    if (!visibleArea) {
      // Check if the visible area for this page already exists
      visibleArea = document.querySelector(`#${visibleAreaId}`);

      if (!visibleArea) {
        // Create a new container for the visible area (this page)
        visibleArea = document.createElement("div");
        visibleArea.classList.add("visible-area");
        visibleArea.setAttribute("id", visibleAreaId);
        visibleArea.style.position = "absolute";
        visibleArea.style.left = `${visibleAreaLeft}px`;
        visibleArea.style.top = `0px !important`; //`${yOffset}px`;
        visibleArea.style.marginTop = `0px`;
        visibleArea.style.width = `${viewportWidth}px`;
        visibleArea.style.height = `${window.innerHeight}px`;
        visibleArea.style.pointerEvents = "none"; // Allow interactions to pass through
        visibleArea.style.zIndex = "999"; // Make sure it's above the content but below any UI
        document.body.appendChild(visibleArea);

        newArea = true;
      }
    }

    return { visibleArea: visibleArea, new: newArea };
  }

  /**
   * Removes the group container.
   */
  function clearContainer() {
    if (container) {
      container.remove();
      container = null;
    }
  }

  return {
    add,
    addEnhanced,
    remove,
    update,
    clear,
    clearEnhanced,
    clearAllEnhanced,
    items,
    requestLayout,
    isActivable,
    setActivable,
  };
}

window.addEventListener(
  "load",
  function () {
    // Will relayout all the decorations when the document body is resized.
    const body = document.body;
    var lastSize = { width: 0, height: 0 };
    const observer = new ResizeObserver(() => {
      if (
        lastSize.width === body.clientWidth &&
        lastSize.height === body.clientHeight
      ) {
        return;
      }
      lastSize = {
        width: body.clientWidth,
        height: body.clientHeight,
      };

      groups.forEach(function (group) {
        group.requestLayout();
      });
    });
    observer.observe(body);
  },
  false
);
