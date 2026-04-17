//
//  Copyright 2021 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

import { handleDecorationClickEvent } from "./decorator";
import { adjustPointToViewport } from "./rect";
import { findNearestInteractiveElement } from "./dom";
import { getCurrentSelection } from "./selection";

window.addEventListener("DOMContentLoaded", function () {
  // If we don't set the CSS cursor property to pointer, then the click events are not triggered pre-iOS 13.
  document.body.style.cursor = "pointer";

  document.addEventListener("click", onClick, false);

  // On Mac (iOS app running on Mac), right-clicking on a word does not
  // automatically select it like iOS long-press does. This handler
  // selects the word under the cursor on right-click so that
  // selectionDidChange fires before the context menu appears.
  // The selection messages are posted synchronously here because the
  // normal selectionchange listeners are debounced and would fire
  // after the context menu is already built.
  document.addEventListener("contextmenu", function (event) {
    const selection = window.getSelection();
    if (selection && selection.isCollapsed) {
      // No text is currently selected – select the word at the click point.
      const range = document.caretRangeFromPoint(event.clientX, event.clientY);
      if (range) {
        selection.removeAllRanges();
        selection.addRange(range);
        selection.modify("move", "backward", "word");
        selection.modify("extend", "forward", "word");

        // Post selection to Swift immediately so it arrives before
        // the context menu is presented.
        const currentSelection = getCurrentSelection();
        webkit.messageHandlers.selectionChanged.postMessage(currentSelection);
      }
    }
  });
});

function onClick(event) {
  if (!getSelection().isCollapsed) {
    // There's an on-going selection, the tap will dismiss it so we don't forward it.
    return;
  }

  let point = adjustPointToViewport({ x: event.clientX, y: event.clientY });
  let clickEvent = {
    defaultPrevented: event.defaultPrevented,
    x: point.x,
    y: point.y,
    targetElement: event.target.outerHTML,
    interactiveElement: findNearestInteractiveElement(event.target),
  };

  if (handleDecorationClickEvent(event, clickEvent)) {
    return;
  }

  // Send the tap data over the JS bridge even if it's been handled
  // within the webview, so that it can be preserved and used
  // by the WKNavigationDelegate if needed.
  webkit.messageHandlers.tap.postMessage(clickEvent);

  // We don't want to disable the default WebView behavior as it breaks some features without bringing any value.
  // event.stopPropagation();
  // event.preventDefault();
}
