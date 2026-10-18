//
//  Copyright 2026 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

// Shared setup for the JS unit tests (jest + jsdom).
//
// The tests load the real modules from `src/` (never a copy) into an XHTML document, like the EPUB
// chapters the navigator loads: `processSpansForTextSpacing` rewrites `body.innerHTML`, and its regexes
// depend on the XML serialization (`<br />`, raw U+00A0, `&amp;`).
//
// Every module talks to the app through `webkit.messageHandlers.<name>.postMessage`. Each test gets a
// fresh recorder for every handler name, read back with `postedMessages(name)`.

// jsdom gaps (WebKit has these).
if (!("scrollingElement" in document)) {
  Object.defineProperty(document, "scrollingElement", {
    get: () => document.documentElement,
  });
}

beforeEach(() => {
  const handlers = {};
  global.webkit = {
    messageHandlers: new Proxy(handlers, {
      get(target, name) {
        if (!target[name]) {
          target[name] = { postMessage: jest.fn() };
        }
        return target[name];
      },
    }),
  };
  document.head.innerHTML = "<title>chapter</title>";
  document.body.innerHTML = "";
  jest.resetModules();
});

/** The messages posted to `webkit.messageHandlers[name]` during the test, in order. */
global.postedMessages = (name) =>
  webkit.messageHandlers[name].postMessage.mock.calls.map((call) => call[0]);

/** Every string passed to `log()` during the test. */
global.loggedMessages = () => postedMessages("log");
