//
//  Copyright 2021 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

import Foundation
import Fuzi
import SwiftSoup

/// Extracts pure content from a marked-up (e.g. HTML) or binary (e.g. PDF) resource.
///
/// **WARNING:** This API is experimental and may change or be removed in a future release without
/// notice. Use with caution.
public protocol _ResourceContentExtractor {

    /// Extracts the text content of the given `resource`.
    func extractText(of resource: Resource) -> ResourceResult<String>
}

public extension _ResourceContentExtractor {
    func extractText(of resource: Resource) -> ResourceResult<String> {
        .success("")
    }
}

/// **WARNING:** This API is experimental and may change or be removed in a future release without
/// notice. Use with caution.
public protocol _ResourceContentExtractorFactory {

    /// Creates a `ResourceContentExtractor` instance for the given `resource`.
    /// Returns null if the resource format is not supported.
    func makeExtractor(for resource: Resource) -> _ResourceContentExtractor?
}

/// **WARNING:** This API is experimental and may change or be removed in a future release without
/// notice. Use with caution.
public class _DefaultResourceContentExtractorFactory: _ResourceContentExtractorFactory {

    public init() {}

    public func makeExtractor(for resource: Resource) -> _ResourceContentExtractor? {
        switch resource.link.mediaType {
        case .html, .xhtml:
            return _HTMLResourceContentExtractor()
        default:
            return nil
        }
    }
}

/// `ResourceContentExtractor` implementation for HTML resources.
///
/// **WARNING:** This API is experimental and may change or be removed in a future release without
/// notice. Use with caution.
class _HTMLResourceContentExtractor: _ResourceContentExtractor {

    func extractText(of resource: Resource) -> ResourceResult<String> {
        resource.readAsString()
            .flatMap { content in
                do {
                    // Fuzi strips the HTML entities away when parsing the XML structure (we're missing characters like " ' etc)
                    // Getting the unescaped content before parsing it seems to solve the issue
                    
//                    print("content before unescaping: \(content)")
                    
                    // Transform HTML entities into their actual characters.
                    let unescapedContent = try Entities.unescape(content
                        .replacingOccurrences(of: "<br />", with: "<br /\n>")
                        .replacingOccurrences(of: "<br/>", with: "<br/>\n")
                        .replacingOccurrences(of: "/p><p", with: "/p>\n<p")
                        .replacingOccurrences(of: "/div><div", with: "/div>\n<div")
                        .replacingOccurrences(of: "&amp;", with: "ampToand")
                        .replacingOccurrences(of: "&#x0026;", with: "ampToand")
                        .replacingOccurrences(of: "&quot;", with: "rallyquote")
                        .replacingOccurrences(of: "\u{FB00}", with: "ff")
                    )
                    
                    let text = parse(xml: unescapedContent)
                        ?? parse(html: unescapedContent)
                        ?? ""
                    
                    return .success(
                        text
                            .replacingOccurrences(of: "ampToand", with: "&")
                            .replacingOccurrences(of: "rallyquote", with: "\"")
                        
                        //.replacingOccurrences(of: "br2n", with: "\n")
                    )
                    
//                    let text = parse(xml: content)
//                        ?? parse(html: content)
//                        ?? ""
//                    return .success(text)

                } catch {
                    return .failure(.wrap(error))
                }
            }
    }
    
    // Parse the HTML resource as a strict XML document.
    //
    // This is much more efficient than using SwiftSoup, but will fail when encountering
    // invalid HTML documents.
    private func parse(xml: String) -> String? {
        guard let document = try? Fuzi.XMLDocument(string: xml) else {
            return nil
        }
        document.definePrefix("xhtml", forNamespace: "http://www.w3.org/1999/xhtml")

        guard let body = document.firstChild(xpath: "/xhtml:html/xhtml:body") else {
            return nil
        }

        // Only fixed-layout pages with absolutely positioned elements can
        // have page numbers glued to the text.
        guard xml.contains("left:") || xml.contains("right:") else {
            return body.stringValue
        }

        return textSeparatingPageNumbers(of: body)
    }

    // MARK: - Page numbers in positioned layouts

    /// Fixed-layout pages converted from PDFs place every line in an
    /// absolutely positioned element, without whitespace between them. A page
    /// number drawn at the bottom of the page can come first in the DOM, so
    /// `textContent` glues it to the next word ("4Many animals") and the word
    /// tokenizer can't isolate it for the page number skipping in
    /// `decorator.js`.
    ///
    /// Adds a space around a positioned element containing only digits when
    /// it is the topmost or bottommost positioned element of its container and
    /// its neighbor is on a different line. Subscripts (CO2) and numbers
    /// inside the text are left untouched. `decorator.js` inserts a space
    /// between these elements in the DOM as well.
    private func textSeparatingPageNumbers(of body: Fuzi.XMLElement) -> String {
        let candidates = body.xpath(".//*[@style and normalize-space(.) != '' and translate(normalize-space(.), '0123456789', '') = '']")

        var spaceBefore: [Fuzi.XMLElement] = []
        var spaceAfter: [Fuzi.XMLElement] = []

        for element in candidates {
            guard
                let position = Position(element),
                let siblings = element.parent?.children
            else {
                continue
            }

            let lines = siblings.compactMap(Position.init).filter { $0.isComparable(with: position) }.map(\.vertical)
            guard
                lines.count > 1,
                let minLine = lines.min(), let maxLine = lines.max(), maxLine > minLine,
                position.vertical == minLine || position.vertical == maxLine
            else {
                continue
            }

            func isOnAnotherLine(_ neighbor: Fuzi.XMLElement?) -> Bool {
                guard let neighbor = neighbor, let neighborPosition = Position(neighbor), neighborPosition.isComparable(with: position) else {
                    return false
                }
                return abs(position.vertical - neighborPosition.vertical) / (maxLine - minLine) >= 0.05
            }

            if isOnAnotherLine(element.previousSibling) {
                spaceBefore.append(element)
            }
            if isOnAnotherLine(element.nextSibling) {
                spaceAfter.append(element)
            }
        }

        let originalText = body.stringValue
        guard !spaceBefore.isEmpty || !spaceAfter.isEmpty else {
            return originalText
        }

        var text = ""
        var textWithoutSpaces = ""

        func append(_ node: Fuzi.XMLNode) {
            guard node.type == .Element, let element = node.toElement() else {
                text += node.stringValue
                textWithoutSpaces += node.stringValue
                return
            }
            if spaceBefore.contains(where: { $0 == element }) {
                text += " "
            }
            element.childNodes(ofTypes: [.Element, .Text, .CDataSection, .EntityRef]).forEach(append)
            if spaceAfter.contains(where: { $0 == element }) {
                text += " "
            }
        }
        append(body)

        // Never risk changing anything else than the added spaces.
        return textWithoutSpaces == originalText ? text : originalText
    }

    /// Absolute position of an element, read from its inline style.
    private struct Position {
        let verticalProperty: String
        let unit: String
        let vertical: Double

        private static let regex = try! NSRegularExpression(pattern: "(?:^|;)\\s*(left|right|top|bottom)\\s*:\\s*(-?[0-9.]+)\\s*(px|pt|em|%)?", options: .caseInsensitive)

        init?(_ element: Fuzi.XMLElement) {
            guard let style = element.attr("style") else {
                return nil
            }

            var values: [String: (value: Double, unit: String)] = [:]
            for match in Self.regex.matches(in: style, range: NSRange(style.startIndex..., in: style)) {
                guard
                    let property = Range(match.range(at: 1), in: style),
                    let value = Range(match.range(at: 2), in: style).flatMap({ Double(style[$0]) })
                else {
                    continue
                }
                let unit = Range(match.range(at: 3), in: style).map { String(style[$0]).lowercased() } ?? ""
                values[style[property].lowercased()] = (value, unit)
            }

            guard values["left"] != nil || values["right"] != nil else {
                return nil
            }
            if let bottom = values["bottom"] {
                verticalProperty = "bottom"
                vertical = bottom.value
                unit = bottom.unit
            } else if let top = values["top"] {
                verticalProperty = "top"
                vertical = top.value
                unit = top.unit
            } else {
                return nil
            }
        }

        func isComparable(with other: Position) -> Bool {
            verticalProperty == other.verticalProperty && unit == other.unit
        }
    }
    
    // Parse the HTML resource with SwiftSoup.
    //
    // This may be slow but will recover from broken HTML documents.
    private func parse(html: String) -> String? {
        return try? SwiftSoup.parse(html).body()?.text()
    }
}
