//
//  Copyright 2021 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

// Catch JS errors to log them in the app.

import { TextQuoteAnchor } from "./vendor/hypothesis/anchoring/types";
import { getCurrentSelection } from "./selection";
import { getClientRectsNoOverlap, toNativeRect } from "./rect";

/**
 * Least Recently Used Cache with a limit wraping a Map object
 * The LRUCache constructor takes a limit argument which specifies the maximum number of items the cache can hold.
 * The get method removes and re-adds an item to ensure it's marked as the most recently used.
 * The set method checks the size of the cache, and removes the least recently used item if necessary before adding the new item.
 * The clear method clears the cache.
 */
class LRUCache {
  constructor(limit = 100) {
    // Default limit of 100 items
    this.limit = limit;
    this.map = new Map();
  }

  get(key) {
    if (!this.map.has(key)) return undefined;

    // Remove and re-add to ensure this item is the most recently used
    const value = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key, value) {
    if (this.map.size >= this.limit) {
      // Remove the least recently used item
      const firstKey = this.map.keys().next().value;
      this.map.delete(firstKey);
    }
    this.map.set(key, value);
  }

  clear() {
    this.map.clear();
  }
}

window.addEventListener(
  "error",
  function (event) {
    webkit.messageHandlers.logError.postMessage({
      message: event.message,
      filename: event.filename,
      line: event.lineno,
    });
  },
  false
);

// Notify native code that the page has loaded.
window.addEventListener(
  "load",
  function () {
    const observer = new ResizeObserver(() => {
      appendVirtualColumnIfNeeded();
    });
    observer.observe(document.body);

    // on page load
    window.addEventListener("orientationchange", function () {
      orientationChanged();
      snapCurrentPosition();
    });
    orientationChanged();
  },
  false
);

/**
 * Having an odd number of columns when displaying two columns per screen causes snapping and page
 * turning issues. To fix this, we insert a blank virtual column at the end of the resource.
 */
function appendVirtualColumnIfNeeded() {
  const id = "readium-virtual-page";
  var virtualCol = document.getElementById(id);
  if (isScrollModeEnabled() || getColumnCountPerScreen() != 2) {
    virtualCol?.remove();
  } else {
    var documentWidth = document.scrollingElement.scrollWidth;
    var pageWidth = window.innerWidth;
    var colCount = documentWidth / pageWidth;
    var hasOddColCount = (Math.round(colCount * 2) / 2) % 1 > 0.1;
    if (hasOddColCount) {
      if (virtualCol) {
        virtualCol.remove();
      } else {
        virtualCol = document.createElement("div");
        virtualCol.setAttribute("id", id);
        virtualCol.style.breakBefore = "column";
        virtualCol.innerHTML = "&#8203;"; // zero-width space
        document.body.appendChild(virtualCol);
      }
    }
  }
}

var last_known_scrollX_position = 0;
var last_known_scrollY_position = 0;
var ticking = false;
var maxScreenX = 0;

// Position in range [0 - 1].
function update(position) {
  var positionString = position.toString();
  webkit.messageHandlers.progressionChanged.postMessage(positionString);
}

window.addEventListener("scroll", function () {
  last_known_scrollY_position =
    window.scrollY / document.scrollingElement.scrollHeight;
  // Using Math.abs because for RTL books, the value will be negative.
  last_known_scrollX_position = Math.abs(
    window.scrollX / document.scrollingElement.scrollWidth
  );

  // Window is hidden
  if (
    document.scrollingElement.scrollWidth === 0 ||
    document.scrollingElement.scrollHeight === 0
  ) {
    return;
  }

  if (!ticking) {
    window.requestAnimationFrame(function () {
      update(
        isScrollModeEnabled()
          ? last_known_scrollY_position
          : last_known_scrollX_position
      );
      ticking = false;
    });
  }
  ticking = true;
});

document.addEventListener(
  "selectionchange",
  debounce(50, function () {
    webkit.messageHandlers.selectionChanged.postMessage(getCurrentSelection());
  })
);

function orientationChanged() {
  maxScreenX =
    window.orientation === 0 || window.orientation == 180
      ? screen.width
      : screen.height;
}

export function getColumnCountPerScreen() {
  return parseInt(
    window
      .getComputedStyle(document.documentElement)
      .getPropertyValue("column-count")
  );
}

export function isScrollModeEnabled() {
  const style = document.documentElement.style;
  return (
    style.getPropertyValue("--USER__view").trim() == "readium-scroll-on" ||
    // FIXME: Will need to be removed in Readium 3.0, --USER__scroll was incorrect.
    style.getPropertyValue("--USER__scroll").trim() == "readium-scroll-on"
  );
}

// Scroll to the given TagId in document and snap.
export function scrollToId(id) {
  let element = document.getElementById(id);
  if (!element) {
    return false;
  }

  scrollToRect(element.getBoundingClientRect());
  return true;
}

// Position must be in the range [0 - 1], 0-100%.
export function scrollToPosition(position, dir) {
  console.log("ScrollToPosition");
  if (position < 0 || position > 1) {
    console.log("InvalidPosition");
    return;
  }

  if (isScrollModeEnabled()) {
    let offset = document.scrollingElement.scrollHeight * position;
    document.scrollingElement.scrollTop = offset;
    // window.scrollTo(0, offset);
  } else {
    var documentWidth = document.scrollingElement.scrollWidth;
    var factor = dir == "rtl" ? -1 : 1;
    let offset = documentWidth * position * factor;
    document.scrollingElement.scrollLeft = snapOffset(offset);
  }
}

// Scrolls to the first occurrence of the given text snippet.
//
// The expected text argument is a Locator Text object, as defined here:
// https://readium.org/architecture/models/locators/
export function scrollToText(text) {
  let range = rangeFromLocator({ text });
  if (!range) {
    return false;
  }
  return scrollToRange(range);
}

export function rectFromLocator(locator) {
  let range = rangeFromLocator(locator);
  if (!range) {
    return null;
  }
  return toNativeRect(range.getBoundingClientRect());
}

let rectsCache = new LRUCache(10);
export function clientRectFromLocator(locator, reset, cache) {
  const key = JSON.stringify(locator);
  let nativeRect = rectsCache.get(key);

  if (nativeRect !== undefined && reset === 0) {
    log("return cached rect");
    return nativeRect;
  }
  let range = rangeFromLocator(locator);
  if (!range) {
    return null;
  }
  const clientRects = getClientRectsNoOverlap(range, true);
  const rect = clientRects[0];
  nativeRect = toNativeRect(rect);

  if (cache === 1) {
    rectsCache.set(key, nativeRect);
  }

  return nativeRect;
}

export function calculateHorizontalPageRanges() {
  const rangeData = {};
  let node = document.body.firstChild;
  let currentPage = 0;
  let rangeIndex = 0;
  let pageWidth = window.innerWidth;

  // const pagesPerRange = 2;
  let currentTextLength = 0;
  const minCharactersPerRange = 1000;
  let previousElementRect = new DOMRect(0, 0, 0, 0);

  function processElement(element) {
    log("node name " + element.nodeName);
    log("<" + element.textContent + ">");

    let rect;

    let processText = false;
    if (element.nodeType === Node.TEXT_NODE) {
      if (/\S/.test(element.textContent)) {
        processText = true;
        let range = document.createRange();
        range.selectNode(element);
        rect = range.getBoundingClientRect();
      } else {
        log("node text does not have text");
        addTextToRange(element.textContent, rangeIndex);
      }
    } else if (
      element.nodeType === Node.ELEMENT_NODE &&
      element.textContent.length > 0
    ) {
      processText = true;
      rect = element.getBoundingClientRect();
    } else if (element.nodeName === "br") {
      log(`adding br as new line`);
      addTextToRange("\n", rangeIndex);
    }

    if (processText) {
      rect.x += window.scrollX;

      log("rect x: " + rect.x);
      log("rext width: " + rect.width);
      log("current page: " + currentPage);
      log("current text length: " + currentTextLength);
      log("current page x: " + currentPage * pageWidth);
      log("next page x: " + (currentPage + 1) * pageWidth);

      if (rect.x > (currentPage + 1) * pageWidth) {
        const additionalPages = Math.floor(rect.x / pageWidth - currentPage);
        currentPage = currentPage + additionalPages;
        log("increase current page: " + currentPage);

        log("previous rect x: " + previousElementRect.x);
        log("previous rect width: " + previousElementRect.width);

        // if previousElementRect.x + previousElementRect.width is more than curent page x+width, then we compare with next next page max x

        let maxX = previousElementRect.x + previousElementRect.width;
        if (maxX > (currentPage + 1) * pageWidth) {
          maxX = (currentPage + 1) * pageWidth + pageWidth;
        }
        if (currentTextLength >= minCharactersPerRange && maxX < rect.x) {
          rangeIndex++;
          // currentTextLength = 0;
          log("increase range index: " + rangeIndex);
          currentTextLength = element.textContent.length;
          addTextToRange(element.textContent, rangeIndex);
          previousElementRect = rect;
          return;
        }
      }

      if (
        currentTextLength >= minCharactersPerRange &&
        rect.x + rect.width > (currentPage + 1) * pageWidth
      ) {
        log("paragraph does not fit on current page");
        processTextContent(element, element.textContent);
      } else {
        // if (
        //   currentTextLength + element.textContent.length >
        //   minCharactersPerRange
        // ) {
        //   log("paragraph is too big; analyze words");
        //   processTextContent(element, element.textContent);
        // } else {
        log("add entire paragraph");
        currentTextLength += element.textContent.length;
        addTextToRange(element.textContent, rangeIndex);
        // }
      }

      previousElementRect = rect;
    }
  }

  function processTextContent(element, textContent) {
    // Split the text by spaces or dashes, and keep the delimiters
    let words = textContent.split(/(\s|[-–—―‒])/g).filter(Boolean); // Split on spaces or dashes, keeping them as separate tokens
    let removedText = "";
    let removedWord = "";
    let firstPoppedElement = true;
    let remainderDoesNotFitOnNextPage = false;

    let wordBoundingRect = new DOMRect(
      Number.MAX_VALUE, // we use the max possible value for 'x' to make sure it enters the 'while' iterator
      0,
      0,
      0
    );

    // Reduce the element text until it fits the page height
    while (
      wordBoundingRect.x + wordBoundingRect.width >
        (currentPage + 1) * pageWidth &&
      words.length > 0
    ) {
      removedWord = words.pop(); // Remove the last word or delimiter

      log("word: <" + removedWord + ">");

      if (removedWord === " ") {
        removedText = removedWord + removedText;
      } else {
        try {
          let anchor = new TextQuoteAnchor(element, removedWord, {
            prefix: words.join(""), // Join without adding any additional characters
            suffix: removedText.length > 0 ? removedText : "",
          });

          // log("anchor prefix: " + anchor.context.prefix);
          // log("anchor suffix: " + anchor.context.suffix);
          // log("anchor highlight: " + anchor.exact);

          wordBoundingRect = anchor.toRange().getBoundingClientRect();
          wordBoundingRect.x += window.scrollX;
          log("word rect x: " + wordBoundingRect.x);
          log("word rect width: " + wordBoundingRect.width);
          log("current page max x: " + (currentPage + 1) * pageWidth);

          if (
            wordBoundingRect.x + wordBoundingRect.width >
            (currentPage + 1) * pageWidth
          ) {
            removedText = removedWord + removedText;
          }

          if (firstPoppedElement) {
            if (wordBoundingRect.x > (currentPage + 2) * pageWidth) {
              log("text does not fit on the next page");
              remainderDoesNotFitOnNextPage = true;
            }
          }

          firstPoppedElement = false;
        } catch {
          log("could not find range for word");
          // if (removedWord === "") {
          //     removedText = removedText;
          // }
        }
      }
    }

    // If after removing all words it still doesn't fit, start on a new page
    if (
      words.length === 0 &&
      wordBoundingRect.x > (currentPage + 1) * pageWidth
    ) {
      // This should never happen!!!
      log("this should never happen");
      rangeIndex += 1;
      currentPage += 1; // Move to the next page
      //TODO the element must go through the regular processing in this case
      currentTextLength = textContent.length;
      addTextToRange(textContent, rangeIndex);
    } else {
      words.push(removedWord);

      addTextToRange(words.join(""), rangeIndex);
      currentPage += 1;
      rangeIndex += 1;

      // TODO do we need to also check the current text length here????
      if (remainderDoesNotFitOnNextPage) {
        log("remainderDoesNotFitOnNextPage");
        // processTextContent(element, removedText);
      }
      // else {
      currentTextLength = removedText.length;
      addTextToRange(removedText, rangeIndex);
      // }
    }
  }

  function addTextToRange(text, range) {
    const existingText = rangeData[range.toString()];
    if (existingText !== undefined) {
      const newText = existingText + text;
      rangeData[range.toString()] = newText;
    } else {
      rangeData[range.toString()] = text;
    }

    log("adding text: <" + text + ">");
    log("to range index: " + range);
  }

  function processNode(node) {
    // log("process node <" + node.textContent + ">");
    log(`process node with name : ${node.nodeName} and type: ${node.nodeType}`);
    const keys = Object.keys(rangeData);

    if (node.nodeName === "p" && keys.length > 0) {
      const lastKey = keys[keys.length - 1];
      const lastItem = rangeData[lastKey];
      if (lastItem.endsWith(`\n`) === false) {
        log(`appending new line before paragraph`);
        addTextToRange("\n", rangeIndex);
      }
    }

    if (node.childNodes.length > 1) {
      let child = node.firstChild;
      while (child) {
        // log("<         1         >");
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

  return rangeData;
}

function scrollToRange(range) {
  return scrollToRect(range.getBoundingClientRect());
}

function scrollToRect(rect) {
  if (isScrollModeEnabled()) {
    document.scrollingElement.scrollTop = rect.top + window.scrollY;
  } else {
    document.scrollingElement.scrollLeft = snapOffset(
      rect.left + window.scrollX
    );
  }

  return true;
}

// Returns false if the page is already at the left-most scroll offset.
export function scrollLeft(dir) {
  var isRTL = dir == "rtl";
  var documentWidth = document.scrollingElement.scrollWidth;
  var pageWidth = window.innerWidth;
  var offset = window.scrollX - pageWidth;
  var minOffset = isRTL ? -(documentWidth - pageWidth) : 0;
  return scrollToOffset(Math.max(offset, minOffset));
}

// Returns false if the page is already at the right-most scroll offset.
export function scrollRight(dir) {
  var isRTL = dir == "rtl";
  var documentWidth = document.scrollingElement.scrollWidth;
  var pageWidth = window.innerWidth;
  var offset = window.scrollX + pageWidth;
  var maxOffset = isRTL ? 0 : documentWidth - pageWidth;
  return scrollToOffset(Math.min(offset, maxOffset));
}

// Scrolls to the given left offset.
// Returns false if the page scroll position is already close enough to the given offset.
function scrollToOffset(offset) {
  var currentOffset = window.scrollX;
  var pageWidth = window.innerWidth;
  document.scrollingElement.scrollLeft = offset;
  // In some case the scrollX cannot reach the position respecting to innerWidth
  var diff = Math.abs(currentOffset - offset) / pageWidth;
  return diff > 0.01;
}

// Snap the offset to the screen width (page width).
function snapOffset(offset) {
  var value = offset + 1;

  return value - (value % maxScreenX);
}

function snapCurrentPosition() {
  if (isScrollModeEnabled()) {
    return;
  }
  var currentOffset = window.scrollX;
  var currentOffsetSnapped = snapOffset(currentOffset + 1);

  document.scrollingElement.scrollLeft = currentOffsetSnapped;
}

// Cache the higher level css elements range for faster calculating the word by word dom ranges
let elementRangeCache = new LRUCache(10); // Key: cssSelector, Value: entire element range

// Caches the css element range
function cacheElementRange(cssSelector) {
  const element = document.querySelector(cssSelector);
  if (element) {
    const range = document.createRange();
    range.selectNodeContents(element);
    elementRangeCache.set(cssSelector, range);
  }
}

// Returns a range from a locator; it first searches for the higher level css element in the cache
function rangeFromCachedLocator(locator) {
  const cssSelector = locator.locations.cssSelector;
  const entireRange = elementRangeCache.get(cssSelector);
  if (!entireRange) {
    cacheElementRange(cssSelector);
    return rangeFromCachedLocator(locator);
  }

  const entireText = entireRange.toString();
  let startIndex = 0;
  let foundIndex = -1;

  while (startIndex < entireText.length) {
    const highlightIndex = entireText.indexOf(
      locator.text.highlight,
      startIndex
    );
    if (highlightIndex === -1) {
      break; // No more occurrences of highlight text
    }

    const beforeText = locator.text.before
      ? entireText.slice(
          Math.max(0, highlightIndex - locator.text.before.length),
          highlightIndex
        )
      : "";
    const afterText = locator.text.after
      ? entireText.slice(
          highlightIndex + locator.text.highlight.length,
          highlightIndex +
            locator.text.highlight.length +
            locator.text.after.length
        )
      : "";

    const beforeTextMatches =
      !locator.text.before || locator.text.before.endsWith(beforeText);
    const afterTextMatches =
      !locator.text.after || locator.text.after.startsWith(afterText);

    if (beforeTextMatches && afterTextMatches) {
      // Highlight text from locator was found
      foundIndex = highlightIndex;
      break;
    }

    // Update startIndex for next iteration to search for next occurrence of highlight text
    startIndex = highlightIndex + 1;
  }

  if (foundIndex === -1) {
    throw new Error("Locator range could not be calculated");
  }

  const highlightStartIndex = foundIndex;
  const highlightEndIndex = foundIndex + locator.text.highlight.length;

  const subRange = document.createRange();
  let count = 0;
  let node;
  const nodeIterator = document.createNodeIterator(
    entireRange.commonAncestorContainer, // This should be a Document or DocumentFragment node
    NodeFilter.SHOW_TEXT
  );

  for (node = nodeIterator.nextNode(); node; node = nodeIterator.nextNode()) {
    const nodeEndIndex = count + node.nodeValue.length;
    if (nodeEndIndex > startIndex) {
      break;
    }
    count = nodeEndIndex;
  }

  subRange.setStart(node, highlightStartIndex - count);
  subRange.setEnd(node, highlightEndIndex - count);

  return subRange;
}

export function rangeFromLocator(locator) {
  try {
    let locations = locator.locations;
    let text = locator.text;
    if (text && text.highlight) {
      var root;
      if (locations && locations.cssSelector) {
        try {
          const range = rangeFromCachedLocator(locator);
          return range;
        } catch {
          log("failed getting the range from css selector");
          // root = document.querySelector(locations.cssSelector);
        }
      }
      if (!root) {
        root = document.body;
      }

      let anchor = new TextQuoteAnchor(root, text.highlight, {
        prefix: text.before,
        suffix: text.after,
      });

      return anchor.toRange();
    }

    if (locations) {
      var element = null;

      if (!element && locations.cssSelector) {
        element = document.querySelector(locations.cssSelector);
      }

      if (!element && locations.fragments) {
        for (const htmlId of locations.fragments) {
          element = document.getElementById(htmlId);
          if (element) {
            break;
          }
        }
      }

      if (element) {
        let range = document.createRange();
        range.setStartBefore(element);
        range.setEndAfter(element);
        return range;
      }
    }
  } catch (e) {
    logError(e);
  }

  return null;
}

/// User Settings.

export function setCSSProperties(properties) {
  for (const name in properties) {
    setProperty(name, properties[name]);
  }
}

// For setting user setting.
export function setProperty(key, value) {
  if (value === null) {
    removeProperty(key);
  } else {
    var root = document.documentElement;
    // The `!important` annotation is added with `setProperty()` because if
    // it's part of the `value`, it will be ignored by the Web View.
    root.style.setProperty(key, value, "important");
  }
}

// For removing user setting.
export function removeProperty(key) {
  var root = document.documentElement;

  root.style.removeProperty(key);
}

/// Toolkit

function debounce(delay, func) {
  var timeout;
  return function () {
    var self = this;
    var args = arguments;
    function callback() {
      func.apply(self, args);
      timeout = null;
    }
    clearTimeout(timeout);
    timeout = setTimeout(callback, delay);
  };
}

export function log() {
  var message = Array.prototype.slice.call(arguments).join(" ");
  webkit.messageHandlers.log.postMessage(message);
}

export function logErrorMessage(msg) {
  logError(new Error(msg));
}

export function logError(e) {
  webkit.messageHandlers.logError.postMessage({
    message: e.message,
  });
}
