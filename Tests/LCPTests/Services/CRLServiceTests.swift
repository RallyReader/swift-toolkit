//
//  Copyright 2026 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

import Foundation
@testable import ReadiumLCP
import ReadiumShared
import Testing

/// Rally: the CRL cache keeps only a DER certificate list, never a page a school web filter or a captive portal
/// answered the plain-HTTP request with.
struct CRLServiceTests {
    /// The outer shape of EDRLab's CRL: a SEQUENCE with a two-byte long-form length (661 bytes in all).
    private static let crl = Data([0x30, 0x82, 0x02, 0x91]) + Data(repeating: 0x01, count: 0x0291)
    private static let blockPage = Data("<html><body>This site is blocked by your school.</body></html>".utf8)

    private let suiteName = "org.readium.lcp.crl.test.\(UUID().uuidString)"
    private let defaults: UserDefaults

    init() {
        defaults = UserDefaults(suiteName: suiteName)!
    }

    private func makeService(_ responses: [HTTPResult<Data>]) -> (CRLService, FakeHTTPClient) {
        let client = FakeHTTPClient(responses: responses)
        return (CRLService(httpClient: client, defaults: defaults), client)
    }

    private func cache(_ crl: String, daysAgo: Int) {
        defaults.set(crl, forKey: CRLService.crlKey)
        defaults.set(Calendar.current.date(byAdding: .day, value: -daysAgo, to: Date())!, forKey: CRLService.dateKey)
    }

    private func isCRLFetching(_ error: Error) -> Bool {
        if case .crlFetching = error as? LCPError {
            return true
        }
        return false
    }

    // MARK: - Format

    @Test func acceptsADERCertificateList() {
        #expect(CRLService.isDERCertificateList(Self.crl))
        #expect(CRLService.isDERCertificateList(Data([0x30, 0x03, 0x02, 0x01, 0x01])))
        #expect(CRLService.isPEMCertificateList(CRLService.pem(fromDER: Self.crl)))
    }

    @Test func rejectsWhatIsNotACertificateList() {
        #expect(!CRLService.isDERCertificateList(Self.blockPage))
        #expect(!CRLService.isDERCertificateList(Data()))
        #expect(!CRLService.isDERCertificateList(Data("0 results".utf8)))
        // Cut off, or followed by something else.
        #expect(!CRLService.isDERCertificateList(Self.crl.dropLast(10)))
        #expect(!CRLService.isDERCertificateList(Self.crl + Data([0x00])))
        // What older versions cached when the filter answered.
        #expect(!CRLService.isPEMCertificateList(CRLService.pem(fromDER: Self.blockPage)))
        #expect(!CRLService.isPEMCertificateList("not a CRL"))
    }

    // MARK: - Fetching and the cache

    @Test func fetchesAndCachesACertificateList() async throws {
        let (service, _) = makeService([.success(Self.crl)])

        let crl = try await service.retrieve()

        #expect(crl == CRLService.pem(fromDER: Self.crl))
        #expect(defaults.string(forKey: CRLService.crlKey) == crl)
    }

    @Test func neverCachesAPageAnsweredWithA200() async {
        let (service, _) = makeService([.success(Self.blockPage)])

        let error = await #expect(throws: LCPError.self) {
            try await service.retrieve()
        }
        #expect(error.map(isCRLFetching) == true)
        #expect(defaults.string(forKey: CRLService.crlKey) == nil)
    }

    @Test func keepsAnOutdatedCRLWhenTheFetchBringsAPage() async throws {
        let cached = CRLService.pem(fromDER: Self.crl)
        cache(cached, daysAgo: 10)
        let (service, _) = makeService([.success(Self.blockPage)])

        #expect(try await service.retrieve() == cached)
        #expect(defaults.string(forKey: CRLService.crlKey) == cached)
    }

    @Test func dropsAPageCachedByAnOlderVersion() async throws {
        cache(CRLService.pem(fromDER: Self.blockPage), daysAgo: 1)
        let (service, client) = makeService([.success(Self.crl)])

        // Still within the 7 days, but fetched again since the cache is not a CRL.
        let crl = try await service.retrieve()

        #expect(crl == CRLService.pem(fromDER: Self.crl))
        #expect(client.requestCount == 1)
    }

    @Test func usesARecentCRLWithoutFetching() async throws {
        let cached = CRLService.pem(fromDER: Self.crl)
        cache(cached, daysAgo: 1)
        let (service, client) = makeService([])

        #expect(try await service.retrieve() == cached)
        #expect(client.requestCount == 0)
    }

    @Test func refreshFetchesEvenWithARecentCRL() async throws {
        cache(CRLService.pem(fromDER: Data([0x30, 0x03, 0x02, 0x01, 0x01])), daysAgo: 0)
        let (service, client) = makeService([.success(Self.crl)])

        #expect(try await service.refresh() == CRLService.pem(fromDER: Self.crl))
        #expect(client.requestCount == 1)
        #expect(defaults.string(forKey: CRLService.crlKey) == CRLService.pem(fromDER: Self.crl))
    }

    @Test func aFailedRefreshKeepsTheCache() async {
        let cached = CRLService.pem(fromDER: Self.crl)
        cache(cached, daysAgo: 0)
        let (service, _) = makeService([.failure(.offline(nil))])

        let error = await #expect(throws: LCPError.self) {
            try await service.refresh()
        }
        #expect(error.map(isCRLFetching) == true)
        #expect(defaults.string(forKey: CRLService.crlKey) == cached)
    }
}

/// Answers each request with the next of `responses`, as a 200 with that body.
private final class FakeHTTPClient: HTTPClient, @unchecked Sendable {
    private var responses: [HTTPResult<Data>]
    private(set) var requestCount = 0

    init(responses: [HTTPResult<Data>]) {
        self.responses = responses
    }

    func stream(
        request: HTTPRequestConvertible,
        consume: @escaping (_ chunk: Data, _ progress: Double?) -> HTTPResult<Void>
    ) async -> HTTPResult<HTTPResponse> {
        requestCount += 1
        guard case let .success(request) = request.httpRequest(), !responses.isEmpty else {
            return .failure(.unreachable(nil))
        }
        switch responses.removeFirst() {
        case let .success(body):
            _ = consume(body, 1)
            return .success(HTTPResponse(request: request, url: request.url, status: 200, headers: [:], mediaType: nil, body: nil))
        case let .failure(error):
            return .failure(error)
        }
    }
}
