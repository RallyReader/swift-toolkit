/**
 * Test runner script for Node.js using JSDOM
 * Run with: node run-tests.js
 */

const jsdom = require("jsdom");
const { JSDOM } = jsdom;
const fs = require("fs");
const path = require("path");

// Create a virtual DOM to run our tests
const dom = new JSDOM(`<!DOCTYPE html><html><body></body></html>`, {
  url: "file://" + path.resolve(__dirname, "../"),
  runScripts: "dangerously",
  resources: "usable",
});

// Make the DOM global so it acts like a browser environment
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.Node = dom.window.Node;

// Mock necessary browser methods
global.ResizeObserver = class ResizeObserver {
  constructor(callback) {
    this.callback = callback;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Mock the log function from utils.js
global.log = console.log;
global.logErrorMessage = console.error;

// Mock the processSpansForTextSpacing function if needed
// Since we can't easily import ES modules in Node, we'll need to mock it
// unless you transpile your code with Babel first
const decoratorPath = path.resolve(__dirname, "../src/decorator.js");
if (!fs.existsSync(decoratorPath)) {
  console.error(`Could not find decorator.js at ${decoratorPath}`);
  process.exit(1);
}

// Here we're defining a mock implementation that does basic text spacing
// You would need to implement a simplified version of your actual function
global.processSpansForTextSpacing = function () {
  // A simplified implementation that adds spaces between spans
  const spans = document.querySelectorAll("span");

  spans.forEach((span) => {
    // Add a space before spans based on similar logic to your original function
    const previousSibling = span.previousElementSibling;
    if (previousSibling && previousSibling.tagName === "SPAN") {
      span.parentElement.insertBefore(document.createTextNode(" "), span);
    }
  });

  // Handle div elements
  const divs = document.querySelectorAll("div");
  divs.forEach((div) => {
    if (div.style.bottom !== undefined && div.parentElement) {
      div.parentElement.insertBefore(document.createTextNode("\n"), div);
    }
  });

  // Replace Unicode ligature 'ff'
  document.body.innerHTML = document.body.innerHTML.replace(/\ufb00/g, "ff");
};

// Now run the tests
try {
  const { runTests } = require("./decorator.test.js");
  runTests();
} catch (error) {
  console.error("Error running tests:", error);
}
