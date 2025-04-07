//
//  Copyright 2023 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

// Try to import the real function, but fall back to our mock if it fails
function processSpansForTextSpacing() {
  // Get all spans in the document
  document.body.innerHTML = document.body.innerHTML.replace(
    /<br\s*\/>/g,
    "$&\n"
  );
  // ADD BODY
  document.body.innerHTML = document.body.innerHTML.replace(
    /([^\n])<(div|p)/g,
    "$1\n<$2"
  );

  // Replace Unicode ligature 'ff' (U+FB00) with regular 'ff'
  document.body.innerHTML = document.body.innerHTML.replace(/\ufb00/g, "ff");

  const nodes = document.querySelectorAll("span, div");

  // Group spans by parent element to analyze siblings
  const nodesByParent = {};
  for (const node of nodes) {
    if (node.nodeName === "div") {
      if (node.style.bottom === undefined) {
        node.parentElement.insertBefore(document.createTextNode("\n"), node);
        continue;
      }
    }
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

    if (siblingSpans.length === 1) {
      const span = siblingSpans[0];
      if (span.nodeName === "div") {
        span.parentElement.insertBefore(document.createTextNode("\n"), span);
      } else {
        // if (span.style.hasAttribute("word-spacing")) {
        //   span.parentElement.insertBefore(document.createTextNode(" "), span);
        // }
      }
    }

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
 * Count the number of words in a string
 * @param {string} text - The text to count words in
 * @returns {number} - Number of words
 */
function countWords(text) {
  // Trim the text and split by whitespace (spaces, tabs, newlines)
  return text
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0).length;
}

// Define test cases
const testCases = [
  {
    name: "E is for elephant 1",
    html: `<div xmlns="http://www.w3.org/1999/xhtml" id="Page" class="PageContainer" style="position:absolute;top:0px;left:0px;width:1762.39px;height:1762.39px;"><div id="ImageContainer002_00"><img width="1762" height="1762" alt="background image" style="position:absolute" src="images/bg002_00.jpg" /></div><div id="TextContainer2"><div class="s1 t0 o0" style="left:1805.44px;bottom:18902.1px;"><span class="s1 f0 fs0 l0" style="bottom:0px;color:rgb(28,28,26);">e</span></div><div class="s1 t1 o0" style="left:7323.39px;bottom:22518.7px;"><span class="s1 f0 fs0 l0" style="bottom:0px;letter-spacing:-7.1px;color:rgb(80,80,80);"><span style="word-spacing:0px;"> </span>is<span style="word-spacing:0px;"> </span>for<span style="word-spacing:0px;"> </span></span></div><div class="s1 t1 o0" style="left:14508.9px;bottom:22518.7px;"><span class="s1 f1 fs0 l0" style="bottom:0px;color:rgb(80,80,80);">elephant</span></div><span class="s1 f0 fs1 l0" style="left:10268.2px;bottom:19521.9px;color:rgb(123,123,123);">Asian<span style="word-spacing:0px;"> </span>elephant</span></div></div>`,
    expected: 6,
  },
  {
    name: "Meet the team 1",
    html: `<body style="margin:0;background-color:#808080;width:1556.82px;height:1989.27px;"><div id="Page" class="PageContainer" style="position:absolute;top:0px;left:0px;width:1556.82px;height:1989.27px;"><div id="ImageContainer006_00"><img width="1557" height="1989" alt="background image" style="position:absolute" src="images/bg006_00.jpg"/></div><div id="TextContainer6"><span class="s1 f12 fs4 l0" style="left:1891.67px;bottom:1019.76px;color:rgb(28,28,26);">6</span><div class="s1 t2 o0" style="left:2358.43px;bottom:45566.2px;"><span class="s1 f12 fs0 l0" style="bottom:0px;letter-spacing:-7.9px;color:rgb(110,110,110);">Meet<span style="word-spacing:0px;"> </span>the</span></div><div class="s1 t1 o0" style="left:2358.43px;bottom:41394.2px;"><span class="s1 f12 fs0 l0" style="bottom:0px;letter-spacing:3.8px;color:rgb(110,110,110);">STEAM<span style="word-spacing:0px;"> </span>Te<span style="letter-spacing:18.2px;margin-left:-43.2px;">am</span></span></div><span class="s1 f13 fs5 l2" style="left:2358.43px;bottom:39608.6px;color:rgb(28,28,26);">The<span style="word-spacing:0px;"> </span>STEAM<span style="word-spacing:0px;"> </span>T<span style="letter-spacing:0.0px;margin-left:-121.8px;">e</span><span style="letter-spacing:0.9px;margin-left:0.0px;">am<span style="word-spacing:0px;"> </span>is<span style="word-spacing:0px;"> </span>made<span style="word-spacing:0px;"> </span>up<span style="word-spacing:0px;"> </span>of<span style="word-spacing:0px;"> </span>different<span style="word-spacing:0px;"> </span><span style="word-spacing:0px;"> </span></span></span><span class="s1 f13 fs5 l2" style="left:2358.43px;bottom:38136px;letter-spacing:-0.0px;color:rgb(28,28,26);">subjects<span style="word-spacing:0px;"> </span>that<span style="word-spacing:0px;"> </span>work<span style="word-spacing:0px;"> </span>together<span style="word-spacing:0px;"> </span>to<span style="word-spacing:0px;"> </span>show<span style="word-spacing:0px;"> </span>you<span style="word-spacing:0px;"> </span>how<span style="word-spacing:0px;"> </span><span style="word-spacing:0px;"> </span></span><span class="s1 f13 fs5 l2" style="left:2358.43px;bottom:36663.4px;color:rgb(28,28,26);">the<span style="word-spacing:0px;"> </span>world<span style="word-spacing:0px;"> </span>works.</span><div class="s1 t3 o0" style="left:2948.03px;bottom:5485.82px;"><span class="s1 f12 fs0 l0" style="bottom:0px;color:rgb(28,28,26);">S</span></div><span class="s1 f12 fs5 l0" style="left:5782.95px;bottom:6277.89px;letter-spacing:-2.6px;word-spacing:15.8px;color:rgb(28,28,26);">cience</span><span class="s1 f13 fs3 l2" style="left:2948.03px;bottom:5118.2px;letter-spacing:-9.3px;color:rgb(28,28,26);">is<span style="word-spacing:0px;"> </span>a<span style="letter-spacing:-5.2px;margin-left:-2.8px;">ll<span style="word-spacing:0px;"> </span>abo</span><span style="letter-spacing:-9.0px;margin-left:-2.3px;">ut<span style="word-spacing:0px;"> </span>ask</span><span style="letter-spacing:-7.7px;margin-left:-4.1px;">ing<span style="word-spacing:0px;"> </span>q</span><span style="letter-spacing:-12.9px;margin-left:-2.0px;">uestions</span><span style="letter-spacing:0.0px;margin-left:12.9px;"><span style="word-spacing:0px;"> </span></span></span><span class="s1 f13 fs3 l2" style="left:2948.03px;bottom:4094.01px;letter-spacing:-10.9px;color:rgb(28,28,26);">and<span style="word-spacing:0px;"> </span>dis<span style="letter-spacing:-13.9px;margin-left:2.8px;">coverin</span><span style="letter-spacing:-5.7px;margin-left:5.6px;">g<span style="word-spacing:0px;"> </span>the<span style="word-spacing:0px;"> </span>ans</span><span style="letter-spacing:-9.1px;margin-left:-7.1px;">wers<span style="word-spacing:0px;"> </span></span></span><span class="s1 f13 fs3 l2" style="left:2948.03px;bottom:3069.82px;letter-spacing:-6.7px;color:rgb(28,28,26);">to<span style="word-spacing:0px;"> </span>explai<span style="letter-spacing:-6.2px;margin-left:-15.7px;">n<span style="word-spacing:0px;"> </span>how</span><span style="letter-spacing:-9.6px;margin-left:6.2px;"><span style="word-spacing:0px;"> </span>thi</span><span style="letter-spacing:-6.0px;margin-left:-12.8px;">ngs<span style="word-spacing:0px;"> </span>w</span><span style="letter-spacing:-11.4px;margin-left:-10.0px;">ork.</span></span><div class="s1 t3 o0" style="left:14682.2px;bottom:5485.82px;"><span class="s1 f12 fs0 l0" style="bottom:0px;color:rgb(28,28,26);">T</span></div><span class="s1 f12 fs5 l0" style="left:17798.8px;bottom:6277.89px;letter-spacing:-1.7px;word-spacing:12.2px;color:rgb(28,28,26);">echnolog<span style="letter-spacing:0.0px;margin-left:43.0px;">y</span></span><span class="s1 f13 fs3 l2" style="left:14682.2px;bottom:5118.2px;letter-spacing:-7.3px;color:rgb(28,28,26);">uses<span style="word-spacing:0px;"> </span>sc<span style="letter-spacing:-7.9px;margin-left:-9.7px;">ience<span style="word-spacing:0px;"> </span></span><span style="letter-spacing:-4.4px;margin-left:7.9px;">to<span style="word-spacing:0px;"> </span>crea</span><span style="letter-spacing:-3.6px;margin-left:-4.3px;">te<span style="word-spacing:0px;"> </span>new<span style="word-spacing:0px;"> </span></span></span><span class="s1 f13 fs3 l2" style="left:14682.2px;bottom:4094.01px;letter-spacing:-12.7px;color:rgb(28,28,26);">machin<span style="letter-spacing:-4.3px;margin-left:3.9px;">es<span style="word-spacing:0px;"> </span>and<span style="word-spacing:0px;"> </span>mor</span><span style="letter-spacing:-0.6px;margin-left:-12.6px;">e<span style="word-spacing:0px;"> </span>eff</span><span style="letter-spacing:-10.0px;margin-left:1.6px;">ective</span><span style="letter-spacing:0.0px;margin-left:10.0px;"><span style="word-spacing:0px;"> </span></span></span><span class="s1 f13 fs3 l2" style="left:14682.2px;bottom:3069.82px;letter-spacing:-6.8px;color:rgb(28,28,26);">ways<span style="word-spacing:0px;"> </span>o<span style="letter-spacing:-5.2px;margin-left:-7.5px;">f<span style="word-spacing:0px;"> </span>doi</span><span style="letter-spacing:-3.3px;margin-left:-17.1px;">ng<span style="word-spacing:0px;"> </span>th</span><span style="letter-spacing:-18.2px;margin-left:-20.6px;">ings.</span></span><div class="s1 t3 o0" style="left:26004.2px;bottom:5485.82px;"><span class="s1 f12 fs0 l0" style="bottom:0px;color:rgb(28,28,26);">E</span></div><span class="s1 f12 fs5 l0" style="left:29518px;bottom:6277.89px;letter-spacing:7.4px;word-spacing:-6.1px;color:rgb(28,28,26);">nginee<span style="letter-spacing:19.1px;margin-left:-6.8px;">ring</span></span><span class="s1 f13 fs3 l2" style="left:26004.2px;bottom:5118.2px;letter-spacing:-9.3px;color:rgb(28,28,26);">is<span style="word-spacing:0px;"> </span>a<span style="letter-spacing:-5.2px;margin-left:-2.8px;">ll<span style="word-spacing:0px;"> </span>abo</span><span style="letter-spacing:-9.2px;margin-left:-2.3px;">ut<span style="word-spacing:0px;"> </span>fin</span><span style="letter-spacing:-9.9px;margin-left:0.3px;">ding<span style="word-spacing:0px;"> </span>a</span><span style="letter-spacing:-7.2px;margin-left:-0.4px;">nd<span style="word-spacing:0px;"> </span>desi</span><span style="letter-spacing:-13.0px;margin-left:-11.1px;">gning<span style="word-spacing:0px;"> </span></span></span><span class="s1 f13 fs3 l2" style="left:26004.2px;bottom:4094.01px;letter-spacing:-12.7px;color:rgb(28,28,26);">solutions<span style="letter-spacing:-5.2px;margin-left:12.7px;"><span style="word-spacing:0px;"> </span>to<span style="word-spacing:0px;"> </span>pro</span><span style="letter-spacing:-9.7px;margin-left:1.7px;">blems</span><span style="letter-spacing:-36.4px;margin-left:-59.6px;">—us</span><span style="letter-spacing:-10.2px;margin-left:12.6px;">ing<span style="word-spacing:0px;"> </span></span></span><span class="s1 f13 fs3 l2" style="left:26004.2px;bottom:3069.82px;letter-spacing:-10.8px;color:rgb(28,28,26);">science<span style="letter-spacing:0.0px;margin-left:-31.4px;">,<span style="word-spacing:0px;"> </span></span><span style="letter-spacing:-5.2px;margin-left:0.0px;">technology</span><span style="letter-spacing:0.0px;margin-left:-95.3px;">,</span><span style="letter-spacing:-4.9px;margin-left:0.0px;"><span style="word-spacing:0px;"> </span>and<span style="word-spacing:0px;"> </span>math</span><span style="letter-spacing:0.0px;margin-left:-27.8px;">.</span></span></div></div></body>`,
    expected: 67,
  },
  {
    name: "Meet the team 2",
    html: `<body style="margin:0;background-color:#808080;width:1556.82px;height:1989.27px;"><div id="Page" class="PageContainer" style="position:absolute;top:0px;left:0px;width:1556.82px;height:1989.27px;"><div id="ImageContainer007_00"><img width="1557" height="1989" alt="background image" style="position:absolute" src="images/bg007_00.jpg"/></div><div id="TextContainer7"><span class="s1 f14 fs4 l0" style="left:36703.1px;bottom:1197.17px;color:rgb(28,28,26);">7</span><div class="s1 t3 o0" style="left:18084px;bottom:6452.16px;"><span class="s1 f14 fs0 l0" style="bottom:0px;color:rgb(28,28,26);">M</span></div><span class="s1 f14 fs5 l0" style="left:23270.7px;bottom:6534.59px;letter-spacing:-5.6px;word-spacing:25.5px;color:rgb(28,28,26);">ath</span><span class="s1 f15 fs3 l1" style="left:18084px;bottom:5134.14px;letter-spacing:-9.3px;color:rgb(28,28,26);">is a<span style="letter-spacing:-6.2px;margin-left:2.0px;">bout nu</span><span style="letter-spacing:-14.5px;margin-left:-5.1px;">mbers,</span><span style="letter-spacing:-0.0px;margin-left:14.5px;">  </span></span><span class="s1 f15 fs3 l1" style="left:18084px;bottom:4109.95px;letter-spacing:-4.9px;word-spacing:1.7px;color:rgb(28,28,26);">patterns<span style="letter-spacing:0.0px;margin-left:-36.6px;">, </span><span style="letter-spacing:-6.4px;margin-left:-1.7px;">and </span></span><span class="s1 f15 fs3 l1" style="left:22847.9px;bottom:4109.95px;color:rgb(28,28,26);"> </span><span class="s1 f15 fs3 l1" style="left:18084px;bottom:3085.76px;letter-spacing:-10.8px;word-spacing:8.3px;color:rgb(28,28,26);">problem-<span style="letter-spacing:-6.3px;margin-left:-21.5px;">solv</span><span style="letter-spacing:-14.6px;margin-left:-6.1px;">ing. </span></span><div class="s1 t3 o0" style="left:7469.89px;bottom:6452.16px;"><span class="s1 f14 fs0 l0" style="bottom:0px;color:rgb(28,28,26);">A</span></div><span class="s1 f14 fs5 l0" style="left:11452.8px;bottom:6534.59px;letter-spacing:30.4px;word-spacing:-30.4px;color:rgb(28,28,26);">rt</span><span class="s1 f15 fs3 l1" style="left:7469.89px;bottom:5134.14px;letter-spacing:-9.4px;color:rgb(28,28,26);">is a<span style="letter-spacing:-5.2px;margin-left:-2.7px;">ll abo</span><span style="letter-spacing:-8.9px;margin-left:-2.3px;">ut us</span><span style="letter-spacing:-10.3px;margin-left:-15.0px;">ing </span><span style="letter-spacing:-10.4px;margin-left:10.3px;">your </span></span><span class="s1 f15 fs3 l1" style="left:7469.89px;bottom:4109.95px;letter-spacing:-14.5px;color:rgb(28,28,26);">imagin<span style="letter-spacing:-8.0px;margin-left:5.7px;">ation an</span><span style="letter-spacing:2.6px;margin-left:-0.8px;">d sty</span><span style="letter-spacing:-2.5px;margin-left:-7.9px;">le to </span></span><span class="s1 f15 fs3 l1" style="left:7469.89px;bottom:3085.76px;letter-spacing:-4.8px;color:rgb(28,28,26);">create b<span style="letter-spacing:-17.6px;margin-left:-5.3px;">rilliant</span><span style="letter-spacing:-4.1px;margin-left:17.6px;"> new th</span><span style="letter-spacing:-18.2px;margin-left:-19.7px;">ings.</span></span><span class="s1 f16 fs6 l0" style="left:22536.4px;bottom:45020.3px;letter-spacing:12.8px;color:rgb(28,28,26);">We’l<span style="letter-spacing:28.7px;margin-left:-17.3px;">l be</span><span style="letter-spacing:18.1px;margin-left:-8.6px;"> here to</span><span style="letter-spacing:0.0px;margin-left:-18.1px;"> </span></span><span class="s1 f16 fs6 l0" style="left:23158.7px;bottom:43644px;letter-spacing:13.1px;color:rgb(28,28,26);">help yo<span style="letter-spacing:18.6px;margin-left:7.0px;">u with </span></span><span class="s1 f16 fs6 l0" style="left:23682.8px;bottom:42267.8px;letter-spacing:13.7px;word-spacing:14.8px;color:rgb(28,28,26);">handy ti<span style="letter-spacing:24.7px;margin-left:-8.3px;">ps!</span></span></div></div></body>`,
    expected: 31,
  },
  //   {
  //     name: "Meet the team 3",
  //     html: `
  //     <body style="margin:0;background-color:#808080;width:1556.82px;height:1989.27px;">
  // <div id="Page" class="PageContainer" style="position:absolute;top:0px;left:0px;width:1556.82px;height:1989.27px;"><div id="ImageContainer010_00"><img width="1557" height="1989" alt="background image" style="position:absolute" src="images/bg010_00.jpg"/></div><div id="TextContainer10"><div class="s1 t2 o0" style="left:3764.41px;bottom:45570.8px;"><span class="s1 f22 fs0 l0" style="bottom:0px;letter-spacing:-13.0px;word-spacing:32.0px;color:rgb(110,110,110);">The sol<span style="letter-spacing:29.8px;margin-left:24.0px;">ar</span></span></div><div class="s1 t1 o0" style="left:3764.41px;bottom:41398.7px;"><span class="s1 f22 fs0 l0" style="bottom:0px;letter-spacing:-26.5px;word-spacing:42.0px;color:rgb(110,110,110);">system</span></div><span class="s1 f23 fs5 l2" style="left:3764.41px;bottom:39613.1px;letter-spacing:0.0px;color:rgb(28,28,26);">The solar system is made up of our nearest  </span><span class="s1 f23 fs5 l2" style="left:3764.41px;bottom:38140.5px;color:rgb(28,28,26);">star<span style="letter-spacing:0.0px;margin-left:-121.6px;">, the sun, and ever</span><span style="letter-spacing:0.0px;margin-left:48.4px;">ything that orbits, or </span></span><span class="s1 f23 fs5 l2" style="left:3764.41px;bottom:36668px;color:rgb(28,28,26);">travels around, it. This include planets, moons, </span><span class="s1 f23 fs5 l2" style="left:3764.41px;bottom:35195.4px;color:rgb(28,28,26);">comets, asteroids, smaller rocks, and dust.</span><span class="s1 f22 fs5 l0" style="left:2358.71px;bottom:24223.4px;letter-spacing:9.5px;word-spacing:1.2px;color:rgb(28,28,26);">Our star</span><span class="s1 f23 fs3 l2" style="left:2358.43px;bottom:23065.5px;letter-spacing:-7.1px;color:rgb(28,28,26);">The sun <span style="letter-spacing:-9.3px;margin-left:7.1px;">is a</span><span style="letter-spacing:-5.9px;margin-left:9.3px;"> medi</span><span style="letter-spacing:-18.1px;margin-left:-18.3px;">um-</span></span><span class="s1 f23 fs3 l2" style="left:2358.43px;bottom:22041.3px;letter-spacing:-13.8px;color:rgb(28,28,26);">sized<span style="letter-spacing:-8.1px;margin-left:13.8px;"> star</span><span style="letter-spacing:0.0px;margin-left:-82.0px;">.</span><span style="letter-spacing:-6.2px;margin-left:0.0px;"> The su</span><span style="letter-spacing:-42.5px;margin-left:-6.4px;">n’</span><span style="letter-spacing:0.0px;margin-left:-44.8px;">s</span><span style="letter-spacing:0.0px;margin-left:0.0px;"> </span></span><span class="s1 f23 fs3 l2" style="left:2358.43px;bottom:21017.2px;letter-spacing:-6.8px;color:rgb(28,28,26);">powerf<span style="letter-spacing:-4.6px;margin-left:6.8px;">ul for</span><span style="letter-spacing:-5.4px;margin-left:-16.2px;">ce of</span><span style="letter-spacing:0.0px;margin-left:5.4px;">  </span></span><span class="s1 f23 fs3 l2" style="left:2358.43px;bottom:19993px;letter-spacing:-13.2px;color:rgb(28,28,26);">gravit<span style="letter-spacing:-2.9px;margin-left:40.1px;">y pu</span><span style="letter-spacing:-9.8px;margin-left:-11.2px;">lls o</span><span style="letter-spacing:-2.7px;margin-left:3.4px;">n the </span></span><span class="s1 f23 fs3 l2" style="left:2358.43px;bottom:18968.8px;letter-spacing:-12.7px;color:rgb(28,28,26);">planets,<span style="letter-spacing:-7.9px;margin-left:12.7px;"> kee</span><span style="letter-spacing:-12.2px;margin-left:7.9px;">ping </span><span style="letter-spacing:-3.1px;margin-left:12.2px;">them  </span></span><span class="s1 f23 fs3 l2" style="left:2358.43px;bottom:17944.6px;letter-spacing:-13.4px;word-spacing:22.5px;color:rgb(28,28,26);">in or<span style="letter-spacing:-13.5px;margin-left:11.4px;">bit </span><span style="letter-spacing:-9.9px;margin-left:-9.0px;">around </span><span style="letter-spacing:-30.9px;margin-left:-12.5px;">it.</span></span><span class="s1 f24 fs7 l0" style="left:3668.96px;bottom:5073.3px;letter-spacing:13.0px;word-spacing:-10.6px;color:rgb(28,28,26);">Venus<span style="word-spacing:0px;"> </span>h<span style="letter-spacing:15.6px;margin-left:-4.8px;">as<span style="word-spacing:0px;"> </span>tho</span><span style="letter-spacing:13.9px;margin-left:-0.1px;">usands<span style="word-spacing:0px;"> </span></span></span><span class="s1 f24 fs7 l0" style="left:9013.7px;bottom:5073.3px;color:rgb(28,28,26);"><span style="word-spacing:0px;"> </span></span><span class="s1 f24 fs7 l0" style="left:3668.96px;bottom:4305.24px;letter-spacing:11.1px;word-spacing:-10.6px;color:rgb(28,28,26);">of<span style="word-spacing:0px;"> </span>volc<span style="letter-spacing:15.7px;margin-left:7.7px;">anoes<span style="word-spacing:0px;"> </span>o</span><span style="letter-spacing:12.9px;margin-left:-3.1px;">n<span style="word-spacing:0px;"> </span>its<span style="word-spacing:0px;"> </span>sur</span><span style="letter-spacing:12.3px;margin-left:27.4px;">fa</span><span style="letter-spacing:3.4px;margin-left:4.7px;">ce.</span></span><span class="s1 f24 fs7 l0" style="left:14669.7px;bottom:23305.5px;letter-spacing:18.5px;word-spacing:-10.6px;color:rgb(28,28,26);">Mercury<span style="letter-spacing:13.0px;margin-left:-7.9px;"><span style="word-spacing:0px;"> </span>is<span style="word-spacing:0px;"> </span>th</span><span style="letter-spacing:0.0px;margin-left:4.5px;">e<span style="word-spacing:0px;"> </span></span></span><span class="s1 f24 fs7 l0" style="left:14669.7px;bottom:22537.4px;letter-spacing:11.1px;word-spacing:-10.6px;color:rgb(28,28,26);">smalles<span style="letter-spacing:12.1px;margin-left:-5.3px;">t<span style="word-spacing:0px;"> </span>plane</span><span style="letter-spacing:8.0px;margin-left:-3.2px;">t<span style="word-spacing:0px;"> </span>in<span style="word-spacing:0px;"> </span></span></span><span class="s1 f24 fs7 l0" style="left:14669.7px;bottom:21769.3px;letter-spacing:17.3px;word-spacing:-10.6px;color:rgb(28,28,26);">the<span style="word-spacing:0px;"> </span>so<span style="letter-spacing:10.6px;margin-left:-11.1px;">lar<span style="word-spacing:0px;"> </span>system</span><span style="letter-spacing:0.4px;margin-left:-5.5px;">.<span style="word-spacing:0px;"> </span><span style="word-spacing:0px;"> </span></span></span><span class="s1 f24 fs7 l0" style="left:14669.7px;bottom:21001.3px;letter-spacing:17.5px;word-spacing:-10.6px;color:rgb(28,28,26);">It’<span style="letter-spacing:10.6px;margin-left:-41.0px;">s<span style="word-spacing:0px;"> </span></span><span style="letter-spacing:9.9px;margin-left:0.0px;">a<span style="word-spacing:0px;"> </span>lit</span><span style="letter-spacing:12.9px;margin-left:23.6px;">tle</span><span style="letter-spacing:11.3px;margin-left:-2.3px;"><span style="word-spacing:0px;"> </span>bigger<span style="word-spacing:0px;"> </span></span></span><span class="s1 f24 fs7 l0" style="left:14669.7px;bottom:20233.2px;letter-spacing:14.2px;word-spacing:-10.6px;color:rgb(28,28,26);">than<span style="word-spacing:0px;"> </span>ou<span style="letter-spacing:11.8px;margin-left:4.4px;">r<span style="word-spacing:0px;"> </span>moon.</span></span><span class="s1 f24 fs7 l0" style="left:25984.4px;bottom:20379.6px;letter-spacing:17.6px;word-spacing:-10.6px;color:rgb(28,28,26);">Eart<span style="letter-spacing:10.3px;margin-left:6.9px;">h<span style="word-spacing:0px;"> </span>is<span style="word-spacing:0px;"> </span>t</span><span style="letter-spacing:12.6px;margin-left:14.2px;">he<span style="word-spacing:0px;"> </span>onl</span><span style="letter-spacing:0.0px;margin-left:-4.0px;">y<span style="word-spacing:0px;"> </span></span></span><span class="s1 f24 fs7 l0" style="left:25984.4px;bottom:19611.6px;letter-spacing:11.6px;word-spacing:-10.6px;color:rgb(28,28,26);">planet<span style="word-spacing:0px;"> </span>t<span style="letter-spacing:10.4px;margin-left:12.8px;">hat<span style="word-spacing:0px;"> </span>w</span><span style="letter-spacing:-0.0px;margin-left:6.3px;">e<span style="word-spacing:0px;"> </span></span></span><span class="s1 f24 fs7 l0" style="left:25984.4px;bottom:18843.5px;letter-spacing:12.4px;word-spacing:-10.6px;color:rgb(28,28,26);">know<span style="word-spacing:0px;"> </span>for<span style="word-spacing:0px;"> </span>su<span style="letter-spacing:7.2px;margin-left:6.2px;">re<span style="word-spacing:0px;"> </span></span></span><span class="s1 f24 fs7 l0" style="left:29555.1px;bottom:18843.5px;color:rgb(28,28,26);"><span style="word-spacing:0px;"> </span></span><span class="s1 f24 fs7 l0" style="left:25984.4px;bottom:18075.5px;letter-spacing:11.7px;word-spacing:-10.6px;color:rgb(28,28,26);">has<span style="word-spacing:0px;"> </span>lif<span style="letter-spacing:9.2px;margin-left:-1.2px;">e<span style="word-spacing:0px;"> </span>on<span style="word-spacing:0px;"> </span>it.</span></span><span class="s1 f24 fs7 l0" style="left:13824.2px;bottom:6727.68px;letter-spacing:12.8px;word-spacing:-10.6px;color:rgb(28,28,26);">Many<span style="word-spacing:0px;"> </span>spa<span style="letter-spacing:15.4px;margin-left:4.1px;">cecraf</span><span style="letter-spacing:10.6px;margin-left:19.4px;">t<span style="word-spacing:0px;"> </span>h</span><span style="letter-spacing:8.0px;margin-left:-2.1px;">ave<span style="word-spacing:0px;"> </span></span></span><span class="s1 f24 fs7 l0" style="left:13824.2px;bottom:5959.64px;letter-spacing:13.1px;word-spacing:-10.6px;color:rgb(28,28,26);">visited<span style="word-spacing:0px;"> </span><span style="letter-spacing:13.0px;margin-left:-2.6px;">Mars<span style="word-spacing:0px;"> </span>to</span><span style="letter-spacing:10.7px;margin-left:-2.4px;"><span style="word-spacing:0px;"> </span>study<span style="word-spacing:0px;"> </span></span></span><span class="s1 f24 fs7 l0" style="left:13824.2px;bottom:5191.57px;letter-spacing:13.2px;word-spacing:-10.6px;color:rgb(28,28,26);">its<span style="word-spacing:0px;"> </span>weath<span style="letter-spacing:15.9px;margin-left:4.3px;">er</span><span style="letter-spacing:0.0px;margin-left:-62.3px;">,</span><span style="letter-spacing:22.1px;margin-left:10.6px;"><span style="word-spacing:0px;"> </span>surf</span><span style="letter-spacing:7.7px;margin-left:-9.8px;">ace,</span><span style="letter-spacing:0.0px;margin-left:-7.7px;"><span style="word-spacing:0px;"> </span></span></span><span class="s1 f24 fs7 l0" style="left:13824.2px;bottom:4423.51px;letter-spacing:12.1px;word-spacing:-10.6px;color:rgb(28,28,26);">and<span style="word-spacing:0px;"> </span>rocks.</span><span class="s1 f24 fs7 l0" style="left:11486.2px;bottom:28729.8px;letter-spacing:22.5px;word-spacing:-10.6px;color:rgb(28,28,26);">The<span style="word-spacing:0px;"> </span><span style="letter-spacing:12.3px;margin-left:-12.0px;">sun<span style="word-spacing:0px;"> </span>is<span style="word-spacing:0px;"> </span>a<span style="word-spacing:0px;"> </span></span><span style="letter-spacing:9.1px;margin-left:-1.8px;">kind<span style="word-spacing:0px;"> </span></span></span><span class="s1 f24 fs7 l0" style="left:15960.1px;bottom:28729.8px;color:rgb(28,28,26);"><span style="word-spacing:0px;"> </span></span><span class="s1 f24 fs7 l0" style="left:11486.2px;bottom:27961.7px;letter-spacing:11.3px;word-spacing:-7.7px;color:rgb(28,28,26);">of<span style="word-spacing:0px;"> </span>sta<span style="letter-spacing:14.2px;margin-left:5.2px;">r<span style="word-spacing:0px;"> </span>th</span><span style="letter-spacing:13.9px;margin-left:-6.0px;">at<span style="word-spacing:0px;"> </span>sc</span><span style="letter-spacing:11.2px;margin-left:-4.8px;">ientist</span><span style="letter-spacing:-0.1px;margin-left:-2.0px;">s<span style="word-spacing:0px;"> </span></span></span><span class="s1 f24 fs7 l0" style="left:16704.3px;bottom:27961.7px;color:rgb(28,28,26);"><span style="word-spacing:0px;"> </span></span><span class="s1 f24 fs7 l0" style="left:11486.2px;bottom:27193.7px;letter-spacing:10.1px;word-spacing:-10.6px;color:rgb(28,28,26);">call<span style="word-spacing:0px;"> </span>a<span style="word-spacing:0px;"> </span>yel<span style="letter-spacing:10.8px;margin-left:-7.5px;">low<span style="word-spacing:0px;"> </span>dwar</span><span style="letter-spacing:-1.2px;margin-left:29.6px;">f.</span></span><span class="s1 f24 fs7 l0" style="left:31467.1px;bottom:6122.26px;letter-spacing:16.1px;word-spacing:-10.6px;color:rgb(28,28,26);">Scie<span style="letter-spacing:10.5px;margin-left:-0.7px;">ntist</span><span style="letter-spacing:13.7px;margin-left:-1.4px;">s<span style="word-spacing:0px;"> </span>thin</span><span style="letter-spacing:15.8px;margin-left:1.7px;">k<span style="word-spacing:0px;"> </span>the</span><span style="letter-spacing:0.0px;margin-left:-15.8px;"><span style="word-spacing:0px;"> </span></span></span><span class="s1 f24 fs7 l0" style="left:31467.1px;bottom:5354.2px;letter-spacing:10.5px;word-spacing:-10.6px;color:rgb(28,28,26);">asteroid<span style="word-spacing:0px;"> </span>b<span style="letter-spacing:6.4px;margin-left:17.7px;">elt</span><span style="letter-spacing:14.6px;margin-left:4.2px;"><span style="word-spacing:0px;"> </span>conta</span><span style="letter-spacing:9.7px;margin-left:-2.8px;">ins<span style="word-spacing:0px;"> </span></span></span><span class="s1 f24 fs7 l0" style="left:31467.1px;bottom:4586.13px;letter-spacing:14.2px;word-spacing:-10.6px;color:rgb(28,28,26);">the<span style="word-spacing:0px;"> </span>le<span style="letter-spacing:20.3px;margin-left:1.9px;">fto</span><span style="letter-spacing:10.8px;margin-left:-10.3px;">ver<span style="word-spacing:0px;"> </span>rocks<span style="word-spacing:0px;"> </span></span></span><span class="s1 f24 fs7 l0" style="left:31467.1px;bottom:3818.07px;letter-spacing:14.0px;word-spacing:-5.6px;color:rgb(28,28,26);">from<span style="word-spacing:0px;"> </span>wh<span style="letter-spacing:14.0px;margin-left:3.5px;">en<span style="word-spacing:0px;"> </span>th</span><span style="letter-spacing:11.3px;margin-left:3.5px;">e<span style="word-spacing:0px;"> </span>plane</span><span style="letter-spacing:4.4px;margin-left:-2.4px;">ts<span style="word-spacing:0px;"> </span></span></span><span class="s1 f24 fs7 l0" style="left:36919.6px;bottom:3818.07px;color:rgb(28,28,26);"><span style="word-spacing:0px;"> </span></span><span class="s1 f24 fs7 l0" style="left:31467.1px;bottom:3050px;letter-spacing:13.9px;word-spacing:-15.5px;color:rgb(28,28,26);">were<span style="word-spacing:0px;"> </span>form<span style="letter-spacing:19.8px;margin-left:1.6px;">ed.</span></span><span class="s1 f25 fs5 l0 t4 o0" style="left:11704.3px;bottom:11543px;color:rgb(28,28,26);">V</span><span class="s1 f25 fs5 l0 t5 o0" style="left:12478.4px;bottom:11810.4px;color:rgb(28,28,26);">e</span><span class="s1 f25 fs5 l0 t6 o0" style="left:13082.7px;bottom:12047.4px;color:rgb(28,28,26);">n</span><span class="s1 f25 fs5 l0 t7 o0" style="left:13801.2px;bottom:12361.6px;color:rgb(28,28,26);">u</span><span class="s1 f25 fs5 l0 t8 o0" style="left:14522.4px;bottom:12714.8px;color:rgb(28,28,26);">s</span><span class="s1 f25 fs5 l0 t9 o0" style="left:21236.8px;bottom:8666.71px;color:rgb(28,28,26);">M</span><span class="s1 f25 fs5 l0 t10 o0" style="left:22300.9px;bottom:9182.66px;color:rgb(28,28,26);">a</span><span class="s1 f25 fs5 l0 t11 o0" style="left:22962px;bottom:9546.67px;color:rgb(28,28,26);">r</span><span class="s1 f25 fs5 l0 t12 o0" style="left:23510.4px;bottom:9875.24px;color:rgb(28,28,26);">s</span><span class="s1 f25 fs5 l0 t13 o0" style="left:32561.8px;bottom:7651.01px;color:rgb(28,28,26);">A</span><span class="s1 f25 fs5 l0 t14 o0" style="left:33308.2px;bottom:8286.75px;color:rgb(28,28,26);">s</span><span class="s1 f25 fs5 l0 t15 o0" style="left:33772px;bottom:8724.67px;color:rgb(28,28,26);">t</span><span class="s1 f25 fs5 l0 t16 o0" style="left:34132.7px;bottom:9085.56px;color:rgb(28,28,26);">e</span><span class="s1 f25 fs5 l0 t17 o0" style="left:34574.6px;bottom:9561.65px;color:rgb(28,28,26);">r</span><span class="s1 f25 fs5 l0 t18 o0" style="left:34997.8px;bottom:10056.2px;color:rgb(28,28,26);">o</span><span class="s1 f25 fs5 l0 t19 o0" style="left:35404px;bottom:10576.7px;color:rgb(28,28,26);">i</span><span class="s1 f25 fs5 l0 t20 o0" style="left:35627.9px;bottom:10877.1px;color:rgb(28,28,26);">d</span><span class="s1 f25 fs5 l0 t21 o0" style="left:36041.1px;bottom:11492.1px;color:rgb(28,28,26);"> </span><span class="s1 f25 fs5 l0 t22 o0" style="left:36290.1px;bottom:11893.9px;color:rgb(28,28,26);">b</span><span class="s1 f25 fs5 l0 t23 o0" style="left:36636.8px;bottom:12523.3px;color:rgb(28,28,26);">e</span><span class="s1 f25 fs5 l0 t24 o0" style="left:36916.6px;bottom:13106.5px;color:rgb(28,28,26);">l</span><span class="s1 f25 fs5 l0 t25 o0" style="left:37065.3px;bottom:13452.3px;color:rgb(28,28,26);">t</span><span class="s1 f25 fs5 l0 t26 o0" style="left:10311.7px;bottom:14553.8px;color:rgb(28,28,26);">M</span><span class="s1 f25 fs5 l0 t27 o0" style="left:11407.3px;bottom:14938.7px;color:rgb(28,28,26);">e</span><span class="s1 f25 fs5 l0 t28 o0" style="left:12008px;bottom:15195.5px;color:rgb(28,28,26);">r</span><span class="s1 f25 fs5 l0 t29 o0" style="left:12591.7px;bottom:15483.7px;color:rgb(28,28,26);">c</span><span class="s1 f25 fs5 l0 t30 o0" style="left:13153.5px;bottom:15788.8px;color:rgb(28,28,26);">u</span><span class="s1 f25 fs5 l0 t31 o0" style="left:13844.1px;bottom:16221.1px;color:rgb(28,28,26);">r</span><span class="s1 f25 fs5 l0 t32 o0" style="left:14400px;bottom:16605.5px;color:rgb(28,28,26);">y</span><span class="s1 f25 fs5 l0 t33 o0" style="left:23499.2px;bottom:17634.8px;color:rgb(28,28,26);">E</span><span class="s1 f25 fs5 l0 t34 o0" style="left:23941.2px;bottom:18372.2px;color:rgb(28,28,26);">a</span><span class="s1 f25 fs5 l0 t35 o0" style="left:24255.8px;bottom:19073.4px;color:rgb(28,28,26);">r</span><span class="s1 f25 fs5 l0 t36 o0" style="left:24474px;bottom:19719.2px;color:rgb(28,28,26);">t</span><span class="s1 f25 fs5 l0 t37 o0" style="left:24608.5px;bottom:20218.9px;color:rgb(28,28,26);">h</span><span class="s1 f24 fs7 l0" style="left:23535px;bottom:14382.3px;letter-spacing:12.8px;word-spacing:-10.6px;color:rgb(28,28,26);">Mars<span style="word-spacing:0px;"> </span>is<span style="word-spacing:0px;"> </span>k<span style="letter-spacing:12.0px;margin-left:-0.1px;">nown<span style="word-spacing:0px;"> </span>as<span style="word-spacing:0px;"> </span></span></span><span class="s1 f24 fs7 l0" style="left:28000.5px;bottom:14382.3px;color:rgb(28,28,26);"><span style="word-spacing:0px;"> </span></span><span class="s1 f24 fs7 l0" style="left:23581.5px;bottom:13614.2px;letter-spacing:18.4px;word-spacing:-10.6px;color:rgb(28,28,26);">the<span style="word-spacing:0px;"> </span>“R<span style="letter-spacing:17.3px;margin-left:20.7px;">ed<span style="word-spacing:0px;"> </span></span><span style="letter-spacing:14.8px;margin-left:-6.7px;">Planet</span><span style="letter-spacing:0.0px;margin-left:-10.3px;">”<span style="word-spacing:0px;"> </span></span></span><span class="s1 f24 fs7 l0" style="left:27954px;bottom:13614.2px;color:rgb(28,28,26);"><span style="word-spacing:0px;"> </span></span><span class="s1 f24 fs7 l0" style="left:22539.6px;bottom:12846.1px;letter-spacing:21.8px;word-spacing:-10.6px;color:rgb(28,28,26);">because<span style="letter-spacing:12.0px;margin-left:-11.3px;"><span style="word-spacing:0px;"> </span>its<span style="word-spacing:0px;"> </span>dust</span><span style="letter-spacing:13.4px;margin-left:14.9px;">y<span style="word-spacing:0px;"> </span>su</span><span style="letter-spacing:26.3px;margin-left:5.2px;">rfa</span><span style="letter-spacing:7.2px;margin-left:-9.4px;">ce<span style="word-spacing:0px;"> </span></span></span><span class="s1 f24 fs7 l0" style="left:23997.6px;bottom:12078.1px;letter-spacing:14.2px;word-spacing:-10.6px;color:rgb(28,28,26);">contain<span style="letter-spacing:12.8px;margin-left:3.6px;">s<span style="word-spacing:0px;"> </span>rust</span><span style="letter-spacing:0.0px;margin-left:-17.9px;">.</span></span><span class="s1 f24 fs7 l0" style="left:29795.7px;bottom:30898.1px;letter-spacing:9.6px;word-spacing:-10.6px;color:rgb(28,28,26);">Peo<span style="letter-spacing:8.6px;margin-left:0.9px;">ple<span style="word-spacing:0px;"> </span>have<span style="word-spacing:0px;"> </span></span></span><span class="s1 f24 fs7 l0" style="left:32856px;bottom:30898.1px;color:rgb(28,28,26);"><span style="word-spacing:0px;"> </span></span><span class="s1 f24 fs7 l0" style="left:28472.2px;bottom:30130px;letter-spacing:15.1px;word-spacing:-10.6px;color:rgb(28,28,26);">invented<span style="letter-spacing:9.9px;margin-left:-4.6px;"><span style="word-spacing:0px;"> </span>ways<span style="word-spacing:0px;"> </span>to<span style="word-spacing:0px;"> </span>st</span><span style="letter-spacing:9.0px;margin-left:11.0px;">udy<span style="word-spacing:0px;"> </span></span></span><span class="s1 f24 fs7 l0" style="left:28475.7px;bottom:29362px;letter-spacing:13.2px;word-spacing:-10.6px;color:rgb(28,28,26);">and<span style="word-spacing:0px;"> </span>trav<span style="letter-spacing:13.4px;margin-left:0.9px;">el<span style="word-spacing:0px;"> </span>around</span><span style="letter-spacing:11.1px;margin-left:-2.8px;"><span style="word-spacing:0px;"> </span>our<span style="word-spacing:0px;"> </span></span></span><span class="s1 f24 fs7 l0" style="left:29649.3px;bottom:28593.9px;letter-spacing:13.9px;word-spacing:-8.4px;color:rgb(28,28,26);">solar<span style="letter-spacing:9.1px;margin-left:-3.3px;"><span style="word-spacing:0px;"> </span>system.</span></span><span class="s1 f22 fs4 l0" style="left:1582.56px;bottom:1019.76px;letter-spacing:26.9px;word-spacing:-26.9px;color:rgb(28,28,26);">10</span><span class="s1 f25 fs5 l0 t38 o0" style="left:4859.67px;bottom:29800.2px;color:rgb(28,28,26);">S</span><span class="s1 f25 fs5 l0 t39 o0" style="left:5444.94px;bottom:29389.7px;color:rgb(28,28,26);">u</span><span class="s1 f25 fs5 l0 t40 o0" style="left:6051.03px;bottom:28886.1px;color:rgb(28,28,26);">n</span></div></div></body>
  //     `,
  //     expected: 172,
  //   },
  {
    name: "Bob book 1",
    html: `
      <body>
<div id="page035">

<div class="para">
<div class="clsa_006 just1" style="left:36.00px;top:525.32px;/*width:127.34px;*/letter-spacing:1.05px;"><span class="clsa_078">J</span><span class="clsa_112">immy</span></div>
<div class="clsa_006 just1" style="left:185.80px;top:525.32px;/*width:70.60px;*/letter-spacing:0.10px;"><span class="clsa_112">and</span></div>
<div class="clsa_011 just1" style="left:283.70px;top:525.40px;/*width:343.32px;*/letter-spacing:3.75px;"><span class="clsa_083">Skipper</span> <span class="clsa_112">jumped</span></div>
<div class="clsa_005 just1" style="left:650.40px;top:525.34px;/*width:107.96px;*/letter-spacing:3.30px;"><span class="clsa_112">over.</span></div>
</div>

</div>

</body>
      `,
    expected: 5,
  },
  {
    name: "Bees 1",
    html: `
      <div xmlns="http://www.w3.org/1999/xhtml" id="Page" class="PageContainer" style="position:absolute;top:0px;left:0px;width:1427.44px;height:2169.71px;"><div id="ImageContainer008_00"><img width="1427" height="2170" alt="background image" style="position:absolute" src="images/bg008_00.jpg" /></div><div id="TextContainer8"><span class="s1 f15 fs1 l0" style="left:1814.18px;bottom:1253.74px;color:rgb(28,28,26);">6</span><span class="s1 f15 fs5 l0" style="left:2721.26px;bottom:35990.5px;letter-spacing:-2.9px;color:rgb(28,28,26);">Bees<span style="word-spacing:0px;"> </span>come<span style="word-spacing:0px;"> </span>in<span style="word-spacing:0px;"> </span>many<span style="letter-spacing:0.0px;margin-left:-52.8px;"><span style="word-spacing:0px;"> </span></span></span><span class="s1 f15 fs5 l0" style="left:2721.26px;bottom:33686.5px;letter-spacing:-3.0px;color:rgb(28,28,26);">colors.<span style="word-spacing:0px;"> </span></span><span class="s1 f15 fs5 l0" style="left:2721.26px;bottom:31382.5px;letter-spacing:-8.3px;color:rgb(28,28,26);">There<span style="word-spacing:0px;"> </span>are<span style="word-spacing:0px;"> </span><span style="letter-spacing:0.0px;margin-left:8.3px;">blue<span style="word-spacing:0px;"> </span>bees,<span style="word-spacing:0px;"> </span></span></span><span class="s1 f15 fs5 l0" style="left:2721.26px;bottom:29078.5px;letter-spacing:-1.9px;color:rgb(28,28,26);">green<span style="word-spacing:0px;"> </span>bees,<span style="word-spacing:0px;"> </span>and<span style="word-spacing:0px;"> </span><span style="word-spacing:0px;"> </span></span><span class="s1 f15 fs5 l0" style="left:2721.26px;bottom:26774.5px;letter-spacing:-19.2px;color:rgb(28,28,26);">yellow<span style="word-spacing:0px;"> </span><span style="letter-spacing:0.0px;margin-left:19.2px;">bees.<span style="word-spacing:0px;"> </span></span></span><span class="s1 f16 fs5 l0" style="left:4082.54px;bottom:5917.51px;color:rgb(28,28,26);">hair</span></div></div>
      `,
    expected: 16,
  },
  {
    name: "Eurika 1",
    html: `
      <body><span id="pg_13" title="14" xmlns="http://www.w3.org/1999/xhtml" style="display:none;"> </span><div id="page-container"><div id="pfd" class="pf w0 h0" data-page-no="d"><div class="pc pcd w0 h0"><img class="bi x1d y5 w6 he" alt="" src="images/bgd.jpg" /><div class="t m0 x1e h5 y1f ff2 fs0 fc1 sc0 ls1 ws1">13</div><div class="t m0 x1f h8 y39 ff1 fs7 fc0 sc0 lsf wsf">18<span class="_ _0"></span>3<span class="_ _0"></span>0<span class="_ _4"></span><span class="fs8 fc3 sc1 ls1 ws1">s<span class="_ _c"></span><span class="fc0 sc0">s</span></span></div><div class="t m0 x20 h9 y3a ff2 fs1 fc0 sc0 lsb wsa">Niépc<span class="_ _3"></span>e’<span class="_ _4"></span>s inventing par<span class="_ _0"></span>tn<span class="_ _0"></span>e<span class="_ _3"></span>r<span class="_ _5"></span>, Louis <span class="_ _0"></span>D<span class="_ _3"></span>aguerre<span class="_ _3"></span>, trie<span class="_ _0"></span>d a dif<span class="_ _0"></span>ferent </div><div class="t m0 x1f h9 y3b ff2 fs1 fc0 sc0 lsb wsa">t<span class="_ _0"></span>ype <span class="_ _0"></span>of metal <span class="_ _0"></span>plate<span class="_ _3"></span>. He coated i<span class="_ _0"></span>t wi<span class="_ _0"></span>th dif<span class="_ _0"></span>ferent chemicals. </div><div class="t m0 x20 h9 y3c ff2 fs1 fc0 sc0 lsb wsa">With <span class="_ _0"></span>these and <span class="_ _0"></span>other changes, D<span class="_ _3"></span>aguerre created <span class="_ _0"></span>a photo<span class="_ _3"></span> </div><div class="t m0 x1f h9 y3d ff2 fs1 fc0 sc0 lsb wsa">that could be taken <span class="_ _0"></span>in fi<span class="_ _0"></span>f<span class="_ _0"></span>teen minutes. He <span class="_ _0"></span>call<span class="_ _3"></span>ed it <span class="_ _0"></span>the<span class="_ _3"></span> </div><div class="t m0 x1f ha y47 ff4 fs1 fc0 sc0 ls12 ws12">dag<span class="_ _0"></span>uer<span class="_ _0"></span>reo<span class="_ _0"></span>ty<span class="_ _0"></span>pe<span class="_ _0"></span><span class="ff2 ls13 ws13">—a<span class="_ _0"></span>f<span class="_ _0"></span>ter himse<span class="_ _0"></span>l<span class="_ _3"></span>f!</span></div></div><div class="pi" data-data="{&quot;ctm&quot;:[2.225694,0.000000,0.000000,2.225694,0.000000,0.000000]}"></div></div>
</div></body>
      `,
    expected: 42,
  },
  {
    name: "Eurika 2",
    html: `
      <body><span id="pg_3" title="4" xmlns="http://www.w3.org/1999/xhtml" style="display:none;"> </span><div id="page-container"><div id="pf3" class="pf w0 h0" data-page-no="3"><div class="pc pc3 w0 h0"><img class="bi x6 y5 w0 h0" alt="" src="images/bg3.jpg" /><div class="t m0 x8 h5 y1f ff2 fs0 fc0 sc0 ls1 ws1">3</div><div class="t m0 x9 h8 y20 ff1 fs7 fc0 sc0 lsa ws1">P<span class="_ _2"></span>r<span class="_ _0"></span>ess a b<span class="_ _0"></span>u<span class="_ _5"></span>tt<span class="_ _4"></span>o<span class="_ _0"></span>n<span class="_ _0"></span>, t<span class="_ _5"></span>a<span class="_ _3"></span>ke a p<span class="_ _0"></span>h<span class="_ _0"></span>o<span class="_ _5"></span>t<span class="_ _4"></span>o<span class="_ _4"></span>. <span class="ff2 fs1 lsb wsa">A photograph </span></div><div class="t m0 x9 h9 y21 ff2 fs1 fc0 sc0 lsb wsa">is a <span class="_ _0"></span>moment frozen in t<span class="_ _0"></span>ime<span class="_ _3"></span>. Some photos are <span class="_ _0"></span>printed on <span class="_ _0"></span>paper<span class="_ _5"></span>. </div><div class="t m0 x9 h9 y22 ff2 fs1 fc0 sc0 lsb wsa">Some are <span class="_ _0"></span>on screens. But <span class="_ _0"></span>all photos are t<span class="_ _0"></span>aken by a camera. </div><div class="t m0 x9 h9 y23 ff2 fs1 fc0 sc0 lsb wsa">Cameras pick up <span class="_ _0"></span>the l<span class="_ _3"></span>ight bouncing of<span class="_ _0"></span>f <span class="_ _0"></span>people or object<span class="_ _0"></span>s. </div><div class="t m0 xa h9 y24 ff2 fs1 fc0 sc0 lsb wsa">Pho<span class="_ _3"></span>tos are <span class="_ _0"></span>all around u<span class="_ _0"></span>s<span class="_ _3"></span>. Cameras <span class="_ _0"></span>are<span class="_ _3"></span>,<span class="_ _3"></span> <span class="ls1 ws1"> </span></div><div class="t m0 xb h9 y25 ff2 fs1 fc0 sc0 lsb wsa">too<span class="_ _3"></span>. How exac<span class="_ _0"></span>tly did people f<span class="_ _0"></span>igure out <span class="_ _0"></span><span class="ls1 ws1"> </span></div><div class="t m0 xb h9 y26 ff2 fs1 fc0 sc0 lsb wsa">how to f<span class="_ _0"></span>reez<span class="_ _3"></span>e t<span class="_ _0"></span>ime this way?</div></div><div class="pi" data-data="{&quot;ctm&quot;:[2.225694,0.000000,0.000000,2.225694,0.000000,0.000000]}"></div></div>
</div></body>
      `,
    expected: 63,
  },
  //   {
  //     name: "Empty spans",
  //     html: "<div><span style='bottom: 10px;'></span><span style='bottom: 10px;'>Word</span></div>",
  //     expected: 1,
  //   },
];

// Jest test suite
describe("processSpansForTextSpacing", () => {
  testCases.forEach((testCase) => {
    test(testCase.name, () => {
      // Setup test document
      document.body.innerHTML = testCase.html;

      // Process the document
      processSpansForTextSpacing();

      // Get the result and count words
      const resultText = document.body.textContent;
      const wordCount = countWords(resultText);
      // For debugging, log the actual text
      console.log(`Actual text: "${resultText}"`);
      // Check if the word count matches the expected count
      expect(wordCount).toBe(testCase.expected);
    });
  });
});

// Keep the old test function for compatibility with other runners
function testProcessSpansForTextSpacing() {
  console.log("Running tests for processSpansForTextSpacing");

  // Run each test case
  testCases.forEach((testCase) => {
    console.log(`Running test: ${testCase.name}`);

    try {
      // Setup test document
      document.body.innerHTML = testCase.html;

      // Process the document
      processSpansForTextSpacing();

      // Get the result and count words
      const resultText = document.body.textContent;
      const wordCount = countWords(resultText);

      // Check if the word count matches the expected count
      if (wordCount === testCase.expected) {
        console.log(`✅ PASS: ${testCase.name}`);
      } else {
        console.error(`❌ FAIL: ${testCase.name}`);
        console.error(`  Expected word count: ${testCase.expected}`);
        console.error(`  Actual word count:   ${wordCount}`);
        console.error(`  Actual text: "${resultText}"`);
      }
    } catch (error) {
      console.error(`❌ ERROR in test ${testCase.name}: ${error.message}`);
    }
  });
}

/**
 * Mock document implementation for testing in Node.js environment
 * This will be needed if running tests in Node without a browser
 */
function setupMockDOM() {
  // Simple DOM mock if needed for Node environment
  if (typeof document === "undefined") {
    global.document = {
      body: {
        innerHTML: "",
        get textContent() {
          // Simple implementation - would need to be more sophisticated for real tests
          return this.innerHTML.replace(/<[^>]*>/g, "");
        },
      },
      createElement: (tag) => ({
        classList: {
          add: () => {},
        },
        style: {},
        setAttribute: () => {},
        appendChild: () => {},
        innerHTML: "",
      }),
      querySelectorAll: () => [],
    };
  }
}

/**
 * Run all tests
 */
function runTests() {
  setupMockDOM();
  testProcessSpansForTextSpacing();
  console.log("All tests completed");
}

// Add comments explaining how to run the tests
/**
 * This test file can be run in several ways:
 *
 * 1. Using Jest:
 *    - Install Jest: npm install --save-dev jest @babel/preset-env babel-jest
 *    - Create a babel.config.js file with:
 *      module.exports = {
 *        presets: [['@babel/preset-env', {targets: {node: 'current'}}]],
 *      };
 *    - Add to package.json:
 *      "scripts": {
 *        "test": "jest"
 *      }
 *    - Run: npm test
 *
 * 2. Using browser and HTML:
 *    - Create an HTML file that imports this test
 *    - Open in browser to run tests
 *
 * 3. Using Node.js with JSDOM:
 *    - Install JSDOM: npm install --save-dev jsdom
 *    - Run with the script below: node run-tests.js
 */

// Run tests if this file is executed directly
if (typeof require !== "undefined" && require.main === module) {
  runTests();
}

// Export for use in other test suites
module.exports = {
  testProcessSpansForTextSpacing,
  runTests: () => testProcessSpansForTextSpacing(),
};
