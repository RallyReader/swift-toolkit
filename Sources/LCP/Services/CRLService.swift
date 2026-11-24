//
//  Copyright 2026 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

import Foundation
import ReadiumShared

/// Certificate Revocation List
final class CRLService: Loggable {
    /// Number of days before the CRL cache expires.
    private static let expiration = 7

    static let crlKey = "org.readium.r2-lcp-swift.CRL"
    static let dateKey = "org.readium.r2-lcp-swift.CRLDate"

    private static let pemHeader = "-----BEGIN X509 CRL-----"
    private static let pemFooter = "-----END X509 CRL-----"

    private let httpClient: HTTPClient
    private let defaults: UserDefaults

    init(httpClient: HTTPClient, defaults: UserDefaults = .standard) {
        self.httpClient = httpClient
        self.defaults = defaults
    }

    /// Retrieves the CRL either from the cache, or from EDRLab if the cache is outdated.
    func retrieve() async throws -> String {
        let localCRL = readLocal()
        if let (crl, date) = localCRL, daysSince(date) < CRLService.expiration {
            return crl
        }

        // Short timeout to avoid blocking the License, since we can always fall back on the cached CRL.
        let timeout: TimeInterval? = (localCRL == nil) ? nil : 8

        do {
            return try await refresh(timeout: timeout)

        } catch {
            // Fallback on the locally cached CRL if available
            guard let (crl, _) = localCRL else {
                throw error
            }
            return crl
        }
    }

    /// Fetches the CRL from EDRLab, whatever the cache holds, and caches it. The cache is left as it is when the
    /// fetch fails.
    func refresh(timeout: TimeInterval? = nil) async throws -> String {
        let crl = try await fetch(timeout: timeout)
        saveLocal(crl)
        return crl
    }

    /// Fetches the updated Certificate Revocation List from EDRLab.
    private func fetch(timeout: TimeInterval? = nil) async throws -> String {
        let url = HTTPURL(string: "http://crl.edrlab.telesec.de/rl/EDRLab_CA.crl")!

        let response = try await httpClient.fetch(HTTPRequest(url: url, timeoutInterval: timeout))
            .mapError { _ in LCPError.crlFetching }
            .get()

        // Rally: the CRL is fetched over plain HTTP, so a school's web filter or a captive portal can answer with
        // its own page and a 200. Cached as the CRL, that page made liblcp reject every license on the device until
        // the cache expired, 7 days later (`licenseIntegrity(.unknown)`; Botan: "Tag mismatch … got UNIVERSAL
        // STRING/CONSTRUCTED", the `<` of the page). Only a DER certificate list is kept.
        guard let body = response.body, Self.isDERCertificateList(body) else {
            log(.warning, "The CRL response is not a DER certificate list (\(response.body?.count ?? 0) bytes, \(response.mediaType?.string ?? "no media type"))")
            throw LCPError.crlFetching
        }
        return Self.pem(fromDER: body)
    }

    /// Reads the local CRL.
    private func readLocal() -> (String, Date)? {
        guard let crl = defaults.string(forKey: CRLService.crlKey),
              let date = defaults.value(forKey: CRLService.dateKey) as? Date
        else {
            return nil
        }

        // Rally: a page cached in place of the CRL by an older version is dropped, so the CRL is fetched again now
        // rather than when that cache expires.
        guard Self.isPEMCertificateList(crl) else {
            log(.warning, "Dropping a cached CRL that is not a certificate list")
            defaults.removeObject(forKey: CRLService.crlKey)
            defaults.removeObject(forKey: CRLService.dateKey)
            return nil
        }

        return (crl, date)
    }

    /// Caches the given CRL.
    private func saveLocal(_ crl: String) {
        defaults.set(crl, forKey: CRLService.crlKey)
        defaults.set(Date(), forKey: CRLService.dateKey)
    }

    private func daysSince(_ date: Date) -> Int {
        let calendar = NSCalendar.current
        let updatedCal = calendar.startOfDay(for: date)
        let currentCal = calendar.startOfDay(for: Date())
        let components = calendar.dateComponents([.day], from: updatedCal, to: currentCal)
        return components.day ?? Int.max
    }

    // MARK: - CRL format (Rally)

    /// The PEM form liblcp takes.
    static func pem(fromDER der: Data) -> String {
        "\(pemHeader)\(der.base64EncodedString())\(pemFooter)"
    }

    /// Whether `pem` is the PEM form of a DER certificate list, as `pem(fromDER:)` writes it.
    static func isPEMCertificateList(_ pem: String) -> Bool {
        guard pem.hasPrefix(pemHeader), pem.hasSuffix(pemFooter) else {
            return false
        }
        let base64 = pem.dropFirst(pemHeader.count).dropLast(pemFooter.count)
        guard let der = Data(base64Encoded: String(base64), options: .ignoreUnknownCharacters) else {
            return false
        }
        return isDERCertificateList(der)
    }

    /// Whether `data` is one DER-encoded ASN.1 SEQUENCE that spans all of it, the outer shape of an X.509 CRL.
    /// A web page, an empty body or a cut-off download is not.
    static func isDERCertificateList(_ data: Data) -> Bool {
        let bytes = [UInt8](data)
        // A SEQUENCE tag, then its length.
        guard bytes.count >= 2, bytes[0] == 0x30 else {
            return false
        }
        let headerLength: Int
        let contentLength: Int
        if bytes[1] < 0x80 {
            // Short form: the length itself.
            headerLength = 2
            contentLength = Int(bytes[1])
        } else {
            // Long form: the number of length bytes that follow, big-endian.
            let lengthByteCount = Int(bytes[1] & 0x7F)
            guard (1 ... 4).contains(lengthByteCount), bytes.count >= 2 + lengthByteCount else {
                return false
            }
            headerLength = 2 + lengthByteCount
            contentLength = bytes[2 ..< headerLength].reduce(0) { $0 << 8 | Int($1) }
        }
        return headerLength + contentLength == bytes.count
    }
}
