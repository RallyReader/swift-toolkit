//
//  Lcp.swift
//  readium-lcp-swift
//
//  Created by Alexandre Camilleri on 9/14/17.
//
//  Copyright 2018 Readium Foundation. All rights reserved.
//  Use of this source code is governed by a BSD-style license which is detailed
//  in the LICENSE file present in the project repository where this source code is maintained.
//

import Foundation
import UIKit
import PromiseKit
import SwiftyJSON
import ZIPFoundation
import R2Shared
import R2LCPClient

public class LcpLicense: DrmLicense {
    
    enum State {
        case pendingValidation
        case validating(LicenseValidation)
        case valid(LicenseDocument, StatusDocument?, DRMContext)
        case invalid(LcpError)
    }

    private let makeValidation: () -> LicenseValidation
    private let container: LicenseContainer
    private let device: DeviceService
    private var state: State

    init(container: LicenseContainer, makeValidation: @escaping () -> LicenseValidation, device: DeviceService) {
        self.container = container
        self.makeValidation = makeValidation
        self.device = device
        self.state = .pendingValidation
    }
    
    /// Reads and validates the License Document in the container.
    func validate() -> AsyncResult<LcpLicense> {
        guard let containerLicenseData = try? container.read() else {
            return .failure(.licenseNotInContainer) // FIXME: wrong error?
        }
        
        let validation = makeValidation()
        state = .validating(validation)
        
        return validation
            .validate(containerLicenseData)
            .map { [unowned self] license, status, context -> LcpLicense in
                self.state = .valid(license, status, context)
                // Overwrites the License Document in the container if it was updated
                if containerLicenseData != license.data {
                    try? self.container.write(license) // FIXME: should we report an error here?
                }
                
                return self
            }
            .failure { error in
                self.state = .invalid(error)
            }
    }

    /// Decipher encrypted content.
    public func decipher(_ data: Data) throws -> Data? {
        guard case let .valid(_, _, context) = state else {
            throw LcpError.invalidContext
        }
        return decrypt(data: data, using: context)
    }

    /// Check that current date is inside the [end - start] right's dates range.
    // FIXME: Is it useful? it seems to be checked by the lcplib (LCPClientError.licenseOutOfDate)
    public func areRightsValid() throws {
        guard case .valid(let license, _, _) = state else {
            throw LcpError.invalidLicense(nil)
        }
        let now = Date.init()
        if let start = license.rights.start,
            !(now > start) {
            throw LcpError.invalidRights
        }
        if let end = license.rights.end,
            !(now < end) {
            throw LcpError.invalidRights
        }
    }

    public func register() {
        guard case let .valid(license, optionalStatus, _) = state, let status = optionalStatus else {
            return
        }
        
        device.registerLicense(license, using: status, completion: nil)
    }

    public func `return`(completion: @escaping (Error?) -> Void){
        guard case let .valid(license, optionalStatus, _) = state, let status = optionalStatus else {
            completion(LcpError.noStatusDocument)
            return
        }
        
        guard let url = status.link(withRel: StatusDocument.Rel.return)?.href,
            var returnUrl = URL(string: url.absoluteString.replacingOccurrences(of: "%7B?id,name%7D", with: "")) else
        {
            completion(LcpError.returnLinkNotFound)
            return
        }
//
//        returnUrl = URL(string: returnUrl.absoluteString + "?id=\(device.id)&name=\(device.name)")!
//        var request = URLRequest(url: returnUrl)
//        request.httpMethod = "PUT"
//        let task = URLSession.shared.dataTask(with: request, completionHandler: { (data, response, error) in
//            guard let httpResponse = response as? HTTPURLResponse else {
//                if let error = error {
//                    completion(error)
//                }
//                return
//            }
//            if error == nil {
//                switch httpResponse.statusCode {
//                case 200:
//                    // update the status document
//                    if let data = data {
//                        do {
//                            // Update local license in Lcp object
//                            self.status = try StatusDocument(data: data)
//                            // Update license status (to 'returned' normally)
//                            try LcpDatabase.shared.licenses.updateState(forLicenseWith: self.license.id,
//                                                                        to: self.status!.status.rawValue)
//                            completion(nil)
//                        } catch {
//                            completion(LcpError.licenseDocumentData)
//                        }
//                    }
//                case 400:
//                    completion(LcpError.returnFailure)
//                case 403:
//                    completion(LcpError.alreadyReturned)
//                default:
//                    completion(LcpError.unexpectedServerError)
//                }
//            }
//        })
//        task.resume()
    }

    public func renew(endDate: Date?, completion: @escaping (Error?) -> Void) {
//        // Is the Status document fetched.
//        guard let status = status else {
//            completion(LcpError.noStatusDocument)
//            return
//        }
//        // Get device ID and Name.
//        guard let deviceId = getDeviceId() else {
//            completion(LcpError.deviceId)
//            return
//        }
//        let deviceName = getDeviceName()
//        // get registerUrl.
//        guard let url = status.link(withRel: StatusDocument.Rel.renew)?.href,
//            var renewUrl = URL(string: url.absoluteString.replacingOccurrences(of: "%7B?end,id,name%7D", with: "")) else
//        {
//            completion(LcpError.renewLinkNotFound)
//            return
//        }
//
//        renewUrl = URL(string: renewUrl.absoluteString + "?id=\(deviceId)&name=\(deviceName)")!
//        var request = URLRequest(url: renewUrl)
//        request.httpMethod = "PUT"
//
//        // Call returnUrl.
//        let task = URLSession.shared.dataTask(with: request, completionHandler: { (data, response, error) in
//            if let httpResponse = response as? HTTPURLResponse  {
//                if error == nil {
//                    switch httpResponse.statusCode {
//                    case 200:
//                        // update the status document
//                        if let data = data {
//                            do {
//                                // Update local license in Lcp object
//                                self.status = try StatusDocument(data: data)
//                                // Update license status (to 'returned' normally)
//                                try LcpDatabase.shared.licenses.updateState(forLicenseWith: self.license.id,
//                                                                            to: self.status!.status.rawValue)
//                                // Update license document.
//                                firstly {
//                                    self.updateLicenseDocument()
//                                    }.then {
//                                        completion(nil)
//                                    }.catch { error in
//                                        completion(error)
//                                }
//                            } catch {
//                                completion(LcpError.licenseDocumentData)
//                            }
//                        }
//                    case 400:
//                        completion(LcpError.renewFailure)
//                    case 403:
//                        completion(LcpError.renewPeriod)
//                    default:
//                        completion(LcpError.unexpectedServerError)
//                    }
//                } else if let error = error {
//                    completion(error)
//                }
//            }
//        })
//        task.resume()
    }

    public func getStatus() -> StatusDocument.Status? {
        guard case .valid(_, let status, _) = state else {
            return nil
        }
        return status?.status
    }
    
    /// Download publication to inbox and return the path to the downloaded
    /// resource.
    ///
    /// - Returns: The URL representing the path of the publication localy.
    func fetchPublication() -> AsyncResult<(URL, URLSessionDownloadTask?)> {
        guard case .valid(let license, _, _) = state else {
            return AsyncResult<(URL, URLSessionDownloadTask?)>.failure(.invalidLicense(nil))
        }
        
        return AsyncResult { completion in
            guard let publicationLink = license.link(withRel: LicenseDocument.Rel.publication) else {
                completion(.failure(.publicationLinkNotFound))
                return
            }
            let request = URLRequest(url: publicationLink.href)
            let fileManager = FileManager.default
            // Document Directory always exists (hence try!).
            var destinationUrl = try! fileManager.url(for: .documentDirectory,
                                                      in: .userDomainMask,
                                                      appropriateFor: nil,
                                                      create: true)
            let fileName = "lcp." + license.id
            destinationUrl.appendPathComponent("\(fileName).epub")
            
            let publicationTitle = publicationLink.title ?? "..."
            
            DownloadSession.shared.launch(request: request, description: publicationTitle, completionHandler: { (tmpLocalUrl, response, error, downloadTask) -> Bool? in
                if let localUrl = tmpLocalUrl, error == nil {
                    do {
                        // Saves the License Document into the downloaded publication
                        let container = EpubLicenseContainer(epub: localUrl)
                        try container.write(license)
                        
                        try FileManager.default.moveItem(at: localUrl, to: destinationUrl)
                    } catch {
                        print(error.localizedDescription)
                        completion(.failure(LcpError.wrap(error)))
                        return false
                    }
                    completion(.success((destinationUrl, downloadTask)))
                    return true
                } else if let error = error {
                    completion(.failure(LcpError.wrap(error)))
                } else {
                    completion(.failure(LcpError.unknown(nil)))
                }
                return false
            })
        }
    }
    
    /// Try to save the license document without status document.
    /// There is also no update logic for the license, because the license url belongs to status.
    /// - Parameters:
    ///   - shouldRejectError: should the function reject anny error emitted .
    ///
    public func saveLicenseDocumentWithoutStatus(shouldRejectError: Bool) -> Promise<Void> {
        return Promise<Void> { fulfill, reject in
//            do {
//                let exist = try LcpDatabase.shared.licenses.existingLicense(with: self.license.id)
//                if exist { // When the LCP license already exist
//                    if shouldRejectError {
//                        reject(LcpError.licenseAlreadyExist)
//                    }
//                } else {
//                    try LcpDatabase.shared.licenses.insert(self.license, with: nil)
//                }
//                fulfill(())
//            } catch {
//                if shouldRejectError {
//                    reject(error)
//                } else {fulfill(())}
//            }
        }
    }
    
    /// Update the License Document.
    ///
    /// - Parameter completion:
    public func updateLicenseDocument() -> Promise<Void> {
        return Promise<Void> { fulfill, reject in
//            guard let status = self.status else {
//                reject(LcpError.noStatusDocument)
//                return
//            }
//            guard let licenseLink = status.link(withRel: StatusDocument.Rel.license) else {
//                reject(LcpError.licenseLinkNotFound)
//                return
//            }
//            print(licenseLink.href.absoluteString)
//            let request = URLRequest(url: licenseLink.href)
//
//            // Compare last update date
//            let latestUpdate = license.dateOfLastUpdate()
//
//            if let lastUpdate = LcpDatabase.shared.licenses.dateOfLastUpdate(forLicenseWith: license.id),
//                lastUpdate > latestUpdate {
//                    fulfill(())
//                return
//            }
//
//            /// 3.4.1/ Fetch the updated license.
//            let task = URLSession.shared.downloadTask(with: request, completionHandler: { tmpLocalUrl, response, error in
//                if let localUrl = tmpLocalUrl, error == nil {
//                    let content: Data
//
//                    do {
//                        /// Refresh the current LicenseDocument in memory with the
//                        /// freshly fetched one.
//                        content = try Data.init(contentsOf: localUrl)
//                        self.license = try LicenseDocument.init(with: content)
//                        try self.container.write(self.license)
//                    } catch {
//                        print(error.localizedDescription)
//                    }
//                } else if let error = error {
//                    print(error.localizedDescription)
//                }
//                try? LcpDatabase.shared.licenses.insert(self.license, with: status.status)
//              fulfill(())
//            })
//            task.resume()
        }
    }

    public func removeDataBaseItem() throws {
//        try LcpDatabase.shared.licenses.deleteData(for: self.license.id)
    }
    
    public static func removeDataBaseItem(licenseID: String) throws {
//        try LcpDatabase.shared.licenses.deleteData(for: licenseID)
    }
    
    public var profile: String {
        guard case let .valid(license, _, _) = state else {
            return ""
        }
        return license.encryption.profile.absoluteString
    }

    public func currentStatus() -> String {
        return getStatus()?.rawValue ?? ""
    }

    public func lastUpdate() -> Date {
        guard case let .valid(license, _, _) = state else {
            return Date()
        }
        return license.dateOfLastUpdate()
    }

    public func issued() -> Date {
        guard case let .valid(license, _, _) = state else {
            return Date()
        }
        return license.issued
    }

    public func provider() -> URL {
        guard case let .valid(license, _, _) = state else {
            return URL(string: "http://test.com")!
        }
        return license.provider
    }

    public func rightsEnd() -> Date? {
        guard case let .valid(license, _, _) = state else {
            return nil
        }
        return license.rights.end
    }

    public func rightsStart() -> Date? {
        guard case let .valid(license, _, _) = state else {
            return nil
        }
        return license.rights.start
    }

    public func rightsPrints() -> Int? {
        guard case let .valid(license, _, _) = state else {
            return nil
        }
        return license.rights.print
    }

    public func rightsCopies() -> Int? {
        guard case let .valid(license, _, _) = state else {
            return nil
        }
        return license.rights.copy
    }

    public func potentialRightsEnd() -> Date? {
        guard case let .valid(license, _, _) = state else {
            return nil
        }
        return license.rights.potentialEnd
    }
}
