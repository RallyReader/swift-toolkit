//
//  Copyright 2021 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

// Base script used by both reflowable and fixed layout resources.

import "./gestures";
import "./keyboard";
import { findFirstVisibleLocator } from "./dom";
import {
  removeProperty,
  scrollLeft,
  scrollRight,
  scrollToId,
  scrollToPosition,
  scrollToText,
  setProperty,
  setCSSProperties,
  rectFromLocator,
  clientRectFromLocator,
  calculateHorizontalPageRanges,
  getFirstVisibleWordText,
  getLastVisibleWordText,
} from "./utils";
import { getDecorations, registerTemplates } from "./decorator";

// Public API used by the navigator.
global.readium = {
  // utils
  scrollToId: scrollToId,
  scrollToPosition: scrollToPosition,
  scrollToText: scrollToText,
  scrollLeft: scrollLeft,
  scrollRight: scrollRight,
  setCSSProperties: setCSSProperties,
  setProperty: setProperty,
  removeProperty: removeProperty,
  rectFromLocator: rectFromLocator,
  clientRectFromLocator: clientRectFromLocator,
  calculateHorizontalPageRanges: calculateHorizontalPageRanges,
  getFirstVisibleWordText: getFirstVisibleWordText,
  getLastVisibleWordText: getLastVisibleWordText,
  // decoration
  registerDecorationTemplates: registerTemplates,
  getDecorations: getDecorations,

  // DOM
  findFirstVisibleLocator: findFirstVisibleLocator,
};
