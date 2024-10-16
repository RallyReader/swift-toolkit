//
//  Copyright 2023 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

import Foundation
import ReadiumInternal

/// https://readium.org/webpub-manifest/schema/metadata.schema.json
public struct Metadata: Hashable, Loggable, WarningLogger, Sendable {
    /// Collection type used for collection/series metadata.
    /// For convenience, the JSON schema reuse the Contributor's definition.
    public typealias Collection = Contributor

    public var identifier: String? // URI
    public var type: String? // URI (@type)
    public var conformsTo: [Publication.Profile]

    public var localizedTitle: LocalizedString?
    public var title: String? { localizedTitle?.string }

    public var localizedSubtitle: LocalizedString?
    public var subtitle: String? { localizedSubtitle?.string }

    public var accessibility: Accessibility?
    public var modified: Date?
    public var published: Date?
    public var languages: [String] // BCP 47 tag
    // Main language of the publication.
    public var language: Language?
    public var sortAs: String?
    public var subjects: [Subject]
    public var authors: [Contributor]
    public var translators: [Contributor]
    public var editors: [Contributor]
    public var artists: [Contributor]
    public var illustrators: [Contributor]
    public var letterers: [Contributor]
    public var pencilers: [Contributor]
    public var colorists: [Contributor]
    public var inkers: [Contributor]
    public var narrators: [Contributor]
    public var contributors: [Contributor]
    public var publishers: [Contributor]
    public var imprints: [Contributor]
    public var description: String?
    public var duration: Double?
    public var numberOfPages: Int?
    public var belongsTo: [String: [Collection]]

    public var readingProgression: ReadingProgression

    /// Additional properties for extensions.
    public var otherMetadata: JSONDictionary.Wrapped {
        get { otherMetadataJSON.json }
        set { otherMetadataJSON = JSONDictionary(newValue) ?? JSONDictionary() }
    }

    // Trick to keep the struct equatable despite [String: Any]
    private var otherMetadataJSON: JSONDictionary

    public init(
        identifier: String? = nil,
        type: String? = nil,
        conformsTo: [Publication.Profile] = [],
        title: LocalizedStringConvertible? = nil,
        subtitle: LocalizedStringConvertible? = nil,
        accessibility: Accessibility? = nil,
        modified: Date? = nil,
        published: Date? = nil,
        languages: [String] = [],
        sortAs: String? = nil,
        subjects: [Subject] = [],
        authors: [Contributor] = [],
        translators: [Contributor] = [],
        editors: [Contributor] = [],
        artists: [Contributor] = [],
        illustrators: [Contributor] = [],
        letterers: [Contributor] = [],
        pencilers: [Contributor] = [],
        colorists: [Contributor] = [],
        inkers: [Contributor] = [],
        narrators: [Contributor] = [],
        contributors: [Contributor] = [],
        publishers: [Contributor] = [],
        imprints: [Contributor] = [],
        readingProgression: ReadingProgression = .auto,
        description: String? = nil,
        duration: Double? = nil,
        numberOfPages: Int? = nil,
        belongsTo: [String: [Collection]] = [:],
        belongsToCollections: [Collection] = [],
        belongsToSeries: [Collection] = [],
        otherMetadata: JSONDictionary.Wrapped = [:]
    ) {
        self.identifier = identifier
        self.type = type
        self.conformsTo = conformsTo
        localizedTitle = title?.localizedString
        localizedSubtitle = subtitle?.localizedString
        self.accessibility = accessibility
        self.modified = modified
        self.published = published
        self.languages = languages
        language = languages.first.map { Language(code: .bcp47($0)) }
        self.sortAs = sortAs
        self.subjects = subjects
        self.authors = authors
        self.translators = translators
        self.editors = editors
        self.artists = artists
        self.illustrators = illustrators
        self.letterers = letterers
        self.pencilers = pencilers
        self.colorists = colorists
        self.inkers = inkers
        self.narrators = narrators
        self.contributors = contributors
        self.publishers = publishers
        self.imprints = imprints
        self.readingProgression = readingProgression
        self.description = description
        self.duration = duration
        self.numberOfPages = numberOfPages

        var belongsTo = belongsTo
        if !belongsToCollections.isEmpty {
            belongsTo["collection"] = belongsToCollections
        }
        if !belongsToSeries.isEmpty {
            belongsTo["series"] = belongsToSeries
        }
        self.belongsTo = belongsTo

        otherMetadataJSON = JSONDictionary(otherMetadata) ?? JSONDictionary()
    }

    public init(
        json: Any?,
        warnings: WarningLogger? = nil
    ) throws {
        guard var json = JSONDictionary(json),
              let title = try? LocalizedString(json: json.pop("title"), warnings: warnings)
        else {
            throw JSONError.parsing(Metadata.self)
        }

        identifier = json.pop("identifier") as? String
        type = json.pop("@type") as? String ?? json.pop("type") as? String
        conformsTo = parseArray(json.pop("conformsTo"), allowingSingle: true)
            .map { Publication.Profile($0) }
        localizedTitle = title
        localizedSubtitle = try? LocalizedString(json: json.pop("subtitle"), warnings: warnings)
        accessibility = try? Accessibility(json: json.pop("accessibility"), warnings: warnings)
        modified = parseDate(json.pop("modified"))
        published = parseDate(json.pop("published"))
        languages = parseArray(json.pop("language"), allowingSingle: true)
        language = languages.first.map { Language(code: .bcp47($0)) }
        sortAs = json.pop("sortAs") as? String
        subjects = [Subject](json: json.pop("subject"), warnings: warnings)
        authors = [Contributor](json: json.pop("author"), warnings: warnings)
        translators = [Contributor](json: json.pop("translator"), warnings: warnings)
        editors = [Contributor](json: json.pop("editor"), warnings: warnings)
        artists = [Contributor](json: json.pop("artist"), warnings: warnings)
        illustrators = [Contributor](json: json.pop("illustrator"), warnings: warnings)
        letterers = [Contributor](json: json.pop("letterer"), warnings: warnings)
        pencilers = [Contributor](json: json.pop("penciler"), warnings: warnings)
        colorists = [Contributor](json: json.pop("colorist"), warnings: warnings)
        inkers = [Contributor](json: json.pop("inker"), warnings: warnings)
        narrators = [Contributor](json: json.pop("narrator"), warnings: warnings)
        contributors = [Contributor](json: json.pop("contributor"), warnings: warnings)
        publishers = [Contributor](json: json.pop("publisher"), warnings: warnings)
        imprints = [Contributor](json: json.pop("imprint"), warnings: warnings)
        readingProgression = parseRaw(json.pop("readingProgression")) ?? .auto
        description = json.pop("description") as? String
        duration = parsePositiveDouble(json.pop("duration"))
        numberOfPages = parsePositive(json.pop("numberOfPages"))
        belongsTo = (json.pop("belongsTo") as? JSONDictionary.Wrapped)?
            .compactMapValues { item in [Collection](json: item, warnings: warnings) }
            ?? [:]
        otherMetadataJSON = json
    }

    public var json: JSONDictionary.Wrapped {
        makeJSON([
            "identifier": encodeIfNotNil(identifier),
            "@type": encodeIfNotNil(type),
            "conformsTo": encodeIfNotEmpty(conformsTo.map(\.uri)),
            "title": encodeIfNotNil(localizedTitle?.json),
            "subtitle": encodeIfNotNil(localizedSubtitle?.json),
            "accessibility": encodeIfNotEmpty(accessibility?.json),
            "modified": encodeIfNotNil(modified?.iso8601),
            "published": encodeIfNotNil(published?.iso8601),
            "language": encodeIfNotEmpty(languages),
            "sortAs": encodeIfNotNil(sortAs),
            "subject": encodeIfNotEmpty(subjects.json),
            "author": encodeIfNotEmpty(authors.json),
            "translator": encodeIfNotEmpty(translators.json),
            "editor": encodeIfNotEmpty(editors.json),
            "artist": encodeIfNotEmpty(artists.json),
            "illustrator": encodeIfNotEmpty(illustrators.json),
            "letterer": encodeIfNotEmpty(letterers.json),
            "penciler": encodeIfNotEmpty(pencilers.json),
            "colorist": encodeIfNotEmpty(colorists.json),
            "inker": encodeIfNotEmpty(inkers.json),
            "narrator": encodeIfNotEmpty(narrators.json),
            "contributor": encodeIfNotEmpty(contributors.json),
            "publisher": encodeIfNotEmpty(publishers.json),
            "imprint": encodeIfNotEmpty(imprints.json),
            "readingProgression": readingProgression.rawValue,
            "description": encodeIfNotNil(description),
            "duration": encodeIfNotNil(duration),
            "numberOfPages": encodeIfNotNil(numberOfPages),
            "belongsTo": encodeIfNotEmpty(belongsTo.mapValues { $0.json }),
        ], additional: otherMetadata)
    }

    public var belongsToCollections: [Collection] {
        belongsTo["collection"] ?? []
    }

    public var belongsToSeries: [Collection] {
        belongsTo["series"] ?? []
    }

    @available(*, unavailable, renamed: "readingProgression")
    public var effectiveReadingProgression: ReadingProgression { fatalError() }

    /// Makes a copy of the `Metadata`, after modifying some of its properties.
    @available(*, unavailable, message: "Make a mutable copy of the struct instead")
    public func copy(
        identifier: String?? = nil,
        type: String?? = nil,
        conformsTo: [Publication.Profile]? = nil,
        title: LocalizedStringConvertible? = nil,
        subtitle: LocalizedStringConvertible?? = nil,
        accessibility: Accessibility?? = nil,
        modified: Date?? = nil,
        published: Date?? = nil,
        languages: [String]? = nil,
        sortAs: String?? = nil,
        subjects: [Subject]? = nil,
        authors: [Contributor]? = nil,
        translators: [Contributor]? = nil,
        editors: [Contributor]? = nil,
        artists: [Contributor]? = nil,
        illustrators: [Contributor]? = nil,
        letterers: [Contributor]? = nil,
        pencilers: [Contributor]? = nil,
        colorists: [Contributor]? = nil,
        inkers: [Contributor]? = nil,
        narrators: [Contributor]? = nil,
        contributors: [Contributor]? = nil,
        publishers: [Contributor]? = nil,
        imprints: [Contributor]? = nil,
        readingProgression: ReadingProgression? = nil,
        description: String?? = nil,
        duration: Double?? = nil,
        numberOfPages: Int?? = nil,
        belongsTo: [String: [Collection]]? = nil,
        belongsToCollections: [Collection]? = nil,
        belongsToSeries: [Collection]? = nil,
        otherMetadata: JSONDictionary.Wrapped? = nil
    ) -> Metadata {
        Metadata(
            identifier: identifier ?? self.identifier,
            type: type ?? self.type,
            conformsTo: conformsTo ?? self.conformsTo,
            title: title ?? localizedTitle,
            subtitle: subtitle ?? localizedSubtitle,
            accessibility: accessibility ?? self.accessibility,
            modified: modified ?? self.modified,
            published: published ?? self.published,
            languages: languages ?? self.languages,
            sortAs: sortAs ?? self.sortAs,
            subjects: subjects ?? self.subjects,
            authors: authors ?? self.authors,
            translators: translators ?? self.translators,
            editors: editors ?? self.editors,
            artists: artists ?? self.artists,
            illustrators: illustrators ?? self.illustrators,
            letterers: letterers ?? self.letterers,
            pencilers: pencilers ?? self.pencilers,
            colorists: colorists ?? self.colorists,
            inkers: inkers ?? self.inkers,
            narrators: narrators ?? self.narrators,
            contributors: contributors ?? self.contributors,
            publishers: publishers ?? self.publishers,
            imprints: imprints ?? self.imprints,
            readingProgression: readingProgression ?? self.readingProgression,
            description: description ?? self.description,
            duration: duration ?? self.duration,
            numberOfPages: numberOfPages ?? self.numberOfPages,
            belongsTo: belongsTo ?? self.belongsTo,
            belongsToCollections: belongsToCollections ?? self.belongsToCollections,
            belongsToSeries: belongsToSeries ?? self.belongsToSeries,
            otherMetadata: otherMetadata ?? self.otherMetadata
        )
    }
}
