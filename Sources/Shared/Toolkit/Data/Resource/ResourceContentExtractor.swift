//
//  Copyright 2026 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

import Foundation
import ReadiumFuzi
import SwiftSoup

/// Extracts pure content from a marked-up (e.g. HTML) or binary (e.g. PDF) resource.
public protocol ResourceContentExtractor {
    /// Extracts the text content of the given `resource`.
    func extractText(of resource: Resource) async -> ReadResult<String>
}

@available(*, unavailable, renamed: "ResourceContentExtractor")
public typealias _ResourceContentExtractor = ResourceContentExtractor

/// Creates a `ResourceContentExtractor` for a given resource and media type.
public protocol ResourceContentExtractorFactory {
    /// Creates a `ResourceContentExtractor` instance for the given `resource`.
    /// Returns nil if the resource format is not supported.
    func makeExtractor(for resource: Resource, mediaType: MediaType) -> ResourceContentExtractor?
}

@available(*, unavailable, renamed: "ResourceContentExtractorFactory")
public typealias _ResourceContentExtractorFactory = ResourceContentExtractorFactory

/// Default `ResourceContentExtractorFactory` supporting HTML resources.
public class DefaultResourceContentExtractorFactory: ResourceContentExtractorFactory {
    public init() {}

    public func makeExtractor(for resource: Resource, mediaType: MediaType) -> ResourceContentExtractor? {
        if mediaType.isHTML {
            return HTMLResourceContentExtractor()
        } else {
            return nil
        }
    }
}

@available(*, unavailable, renamed: "DefaultResourceContentExtractorFactory")
public typealias _DefaultResourceContentExtractorFactory = DefaultResourceContentExtractorFactory

/// `ResourceContentExtractor` implementation for HTML resources.
class HTMLResourceContentExtractor: ResourceContentExtractor {
    func extractText(of resource: Resource) async -> ReadResult<String> {
        await resource.read()
            .asString()
            .asyncFlatMap { content in
                do {
                    // Rally: Fuzi drops HTML entities (" ' …) when parsing the XML, so the entities are unescaped
                    // before parsing. `&`, `<`, `>` and `"` are protected through the parsers with placeholders (a raw
                    // `&` or `<` is no longer valid XML: the page fell back to SwiftSoup, which read `<` as markup,
                    // RR-9683); line breaks
                    // and paragraph/div boundaries become new lines; the "ff" ligature is spelled out.
                    // Every `<br>` (`<br/>`, `<br />`, with attributes) gets exactly one new line, like
                    // `separateLineBreaks` in decorator.js gives it in the web view. A word drawn one glyph per
                    // SVG `<text>` loses the newlines between them, like `joinGlyphsAcrossUndrawnWhitespace`.
                    let unescapedContent = try Entities.unescape(Self.joiningSVGGlyphs(in: content)
                        .replacingOccurrences(of: #"<br\b[^>]*>"#, with: "$0\n", options: .regularExpression)
                        .replacingOccurrences(of: "/p><p", with: "/p>\n<p")
                        .replacingOccurrences(of: "/div><div", with: "/div>\n<div")
                        .replacingOccurrences(of: "&(?:amp|#0*38|#[xX]0*26);", with: "ampToand", options: .regularExpression)
                        .replacingOccurrences(of: "&(?:lt|#0*60|#[xX]0*3[cC]);", with: "rallylessthan", options: .regularExpression)
                        .replacingOccurrences(of: "&(?:gt|#0*62|#[xX]0*3[eE]);", with: "rallygreaterthan", options: .regularExpression)
                        .replacingOccurrences(of: "&quot;", with: "rallyquote")
                        .replacingOccurrences(of: "\u{FB00}", with: "ff")
                    )

                    // First try to parse a valid XML document, then fallback on SwiftSoup, which is slower.
                    let text = parse(xml: unescapedContent)
                        ?? parse(html: unescapedContent)
                        ?? ""

                    return .success(
                        text
                            .replacingOccurrences(of: "ampToand", with: "&")
                            .replacingOccurrences(of: "rallylessthan", with: "<")
                            .replacingOccurrences(of: "rallygreaterthan", with: ">")
                            .replacingOccurrences(of: "rallyquote", with: "\"")
                    )

                } catch {
                    return .failure(.decoding(error))
                }
            }
    }

    /// Parse the HTML resource as a strict XML document.
    ///
    /// This is much more efficient than using SwiftSoup, but will fail when encountering
    /// invalid HTML documents.
    private func parse(xml: String) -> String? {
        guard let document = try? ReadiumFuzi.XMLDocument(string: xml) else {
            return nil
        }
        document.definePrefix("xhtml", forNamespace: "http://www.w3.org/1999/xhtml")

        guard let body = document.firstChild(xpath: "/xhtml:html/xhtml:body") else {
            return nil
        }

        // Rally: only fixed-layout pages with absolutely positioned elements can
        // have page numbers glued to the text.
        guard xml.contains("left:") || xml.contains("right:") else {
            return body.stringValue
        }

        return textSeparatingPageNumbers(of: body)
    }

    // MARK: - Page numbers in positioned layouts (Rally)

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
    private func textSeparatingPageNumbers(of body: ReadiumFuzi.XMLElement) -> String {
        let candidates = body.xpath(".//*[@style and normalize-space(.) != '' and translate(normalize-space(.), '0123456789', '') = '']")

        var spaceBefore: [ReadiumFuzi.XMLElement] = []
        var spaceAfter: [ReadiumFuzi.XMLElement] = []

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

            func isOnAnotherLine(_ neighbor: ReadiumFuzi.XMLElement?) -> Bool {
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

        func append(_ node: ReadiumFuzi.XMLNode) {
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

        init?(_ element: ReadiumFuzi.XMLElement) {
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


    /// Parse the HTML resource with SwiftSoup.
    ///
    /// This may be slow but will recover from broken HTML documents.
    private func parse(html: String) -> String? {
        try? SwiftSoup.parse(html).body()?.text()
    }
}

// MARK: - Words drawn one glyph per SVG <text> (Rally, RR-6140)

extension HTMLResourceContentExtractor {
    /// Removes the whitespace between two SVG `<text>` elements that draw one word together.
    ///
    /// Curved titles converted from print draw every glyph in its own `<text>`, with a newline
    /// between the elements in the markup. SVG draws no text outside its `<text>` elements, so the
    /// newline separates nothing on the page, but the text kept it: "Rumble" read as "R u m b l e".
    /// The web view drops it where the two glyphs touch on one line (`joinsAcrossUndrawnWhitespace`
    /// in `text-spacing.js`); without a layout, this compares where each element is drawn from: the
    /// next glyph must start after the previous one, within a glyph's width, on the same line.
    ///
    /// Like the web view, only pieces of at most two characters are joined, and a space drawn as
    /// its own `<text>` keeps the words apart.
    static func joiningSVGGlyphs(in content: String) -> String {
        guard content.range(of: "<svg", options: .caseInsensitive) != nil else {
            return content
        }
        let source = content as NSString
        var result = ""
        var location = 0
        for svg in svgRegex.matches(in: content, range: NSRange(location: 0, length: source.length)) {
            result += source.substring(with: NSRange(location: location, length: svg.range.location - location))
            result += joiningGlyphs(inSVG: source.substring(with: svg.range))
            location = NSMaxRange(svg.range)
        }
        result += source.substring(from: location)
        return result
    }

    private static func joiningGlyphs(inSVG svg: String) -> String {
        let source = svg as NSString
        let texts = textRegex.matches(in: svg, range: NSRange(location: 0, length: source.length))
        guard texts.count > 1 else {
            return svg
        }
        var result = source.substring(to: texts[0].range.location)
        for (index, text) in texts.enumerated() {
            result += source.substring(with: text.range)
            let end = NSMaxRange(text.range)
            let gapEnd = index + 1 < texts.count ? texts[index + 1].range.location : source.length
            let gap = source.substring(with: NSRange(location: end, length: gapEnd - end))
            if index + 1 < texts.count,
               !gap.isEmpty, gap.allSatisfy(\.isWhitespace),
               let previous = Glyph(text, in: source), let next = Glyph(texts[index + 1], in: source),
               next.continuesWord(of: previous)
            {
                continue
            }
            result += gap
        }
        return result
    }

    /// An SVG `<text>` element holding one or two characters, and where it is drawn from.
    private struct Glyph {
        let x: Double
        let y: Double
        let fontSize: Double

        init?(_ match: NSTextCheckingResult, in source: NSString) {
            let attributes = source.substring(with: match.range(at: 1))
            let content = source.substring(with: match.range(at: 2))
                .replacingOccurrences(of: "<[^>]*>", with: "", options: .regularExpression)
                .replacingOccurrences(of: "&[#A-Za-z0-9]+;", with: "x", options: .regularExpression)
            guard
                (1...2).contains(content.count),
                content.first?.isWhitespace == false, content.last?.isWhitespace == false,
                let fontSize = Self.number(in: attributes, pattern: #"font-size\s*[=:]\s*"?\s*(-?[0-9.]+)"#),
                fontSize > 0,
                let origin = Self.origin(in: attributes)
            else {
                return nil
            }
            self.x = origin.x
            self.y = origin.y
            self.fontSize = fontSize
        }

        /// Whether this glyph is drawn right after `previous`, on its line.
        func continuesWord(of previous: Glyph) -> Bool {
            let advance = x - previous.x
            return advance > 0
                && advance <= previous.fontSize * 1.2
                && abs(y - previous.y) <= previous.fontSize * 0.5
        }

        private static func origin(in attributes: String) -> (x: Double, y: Double)? {
            let value = "(-?[0-9.]+(?:e-?[0-9]+)?)"
            let separator = #"[\s,]+"#
            if let values = numbers(in: attributes, pattern: #"transform\s*=\s*"\s*matrix\(\s*"# + Array(repeating: value, count: 6).joined(separator: separator)),
               values.count == 6
            {
                return (values[4], values[5])
            }
            if let values = numbers(in: attributes, pattern: #"transform\s*=\s*"\s*translate\(\s*"# + value + "(?:" + separator + value + ")?"),
               let x = values.first
            {
                return (x, values.count > 1 ? values[1] : 0)
            }
            if let x = number(in: attributes, pattern: #"\bx\s*=\s*"\s*(-?[0-9.]+)"#),
               let y = number(in: attributes, pattern: #"\by\s*=\s*"\s*(-?[0-9.]+)"#)
            {
                return (x, y)
            }
            return nil
        }

        private static func number(in attributes: String, pattern: String) -> Double? {
            numbers(in: attributes, pattern: pattern)?.first
        }

        private static func numbers(in attributes: String, pattern: String) -> [Double]? {
            guard
                let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive),
                let match = regex.firstMatch(in: attributes, range: NSRange(location: 0, length: (attributes as NSString).length))
            else {
                return nil
            }
            return (1 ..< match.numberOfRanges).compactMap { index in
                let range = match.range(at: index)
                return range.location == NSNotFound ? nil : Double((attributes as NSString).substring(with: range))
            }
        }
    }

    private static let svgRegex = try! NSRegularExpression(pattern: #"<svg\b[^>]*>.*?</svg>"#, options: [.caseInsensitive, .dotMatchesLineSeparators])
    private static let textRegex = try! NSRegularExpression(pattern: #"<text\b([^>]*)>(.*?)</text>"#, options: [.caseInsensitive, .dotMatchesLineSeparators])
}
