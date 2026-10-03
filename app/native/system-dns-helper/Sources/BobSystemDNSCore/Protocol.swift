import Foundation

public enum HelperOperation: String, Codable, Sendable {
  case status, capture, apply, inspectOwnership, restore
}

public struct HelperRequest: Codable, Equatable, Sendable {
  public static let currentProtocolVersion = 1
  public let protocolVersion: Int
  public let installID: UUID
  public let transactionID: UUID?
  public let nonce: UUID
  public let operation: HelperOperation

  public init(protocolVersion: Int = currentProtocolVersion, installID: UUID,
              transactionID: UUID? = nil, nonce: UUID = UUID(), operation: HelperOperation) {
    self.protocolVersion = protocolVersion
    self.installID = installID
    self.transactionID = transactionID
    self.nonce = nonce
    self.operation = operation
  }

  public func validate() throws {
    guard protocolVersion == Self.currentProtocolVersion else { throw HelperError.unsupportedProtocol }
    if [.apply, .inspectOwnership, .restore].contains(operation), transactionID == nil {
      throw HelperError.missingTransaction
    }
  }
}

public enum PreviousDNSMode: String, Codable, Sendable { case dhcp, staticServers, empty }

public struct DNSServiceSnapshot: Codable, Equatable, Sendable {
  public let stableID: String
  public let previousMode: PreviousDNSMode
  public let previousServers: [String]
  public let appliedServers: [String]

  public init(stableID: String, previousMode: PreviousDNSMode, previousServers: [String],
              appliedServers: [String] = ["127.0.0.1", "::1"]) throws {
    guard !stableID.isEmpty, !appliedServers.isEmpty,
          appliedServers.allSatisfy({ $0 == "127.0.0.1" || $0 == "::1" }) else {
      throw HelperError.invalidSnapshot
    }
    self.stableID = stableID
    self.previousMode = previousMode
    self.previousServers = previousServers
    self.appliedServers = appliedServers
  }
}

public struct RestoreRecord: Codable, Equatable, Sendable {
  public enum Phase: String, Codable, Sendable { case pending, active, restoring }
  public let schemaVersion: Int
  public let installID: UUID
  public let transactionID: UUID
  public var phase: Phase
  public let services: [DNSServiceSnapshot]

  public init(installID: UUID, transactionID: UUID = UUID(), phase: Phase = .pending,
              services: [DNSServiceSnapshot]) throws {
    guard !services.isEmpty, Set(services.map(\.stableID)).count == services.count else {
      throw HelperError.invalidSnapshot
    }
    self.schemaVersion = 1
    self.installID = installID
    self.transactionID = transactionID
    self.phase = phase
    self.services = services
  }
}

public enum HelperError: Error, Equatable {
  case unsupportedProtocol, missingTransaction, invalidSnapshot, wrongOwner, ownershipChanged
}
