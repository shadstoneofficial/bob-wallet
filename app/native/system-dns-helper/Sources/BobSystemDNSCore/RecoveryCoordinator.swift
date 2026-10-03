import Foundation

public protocol RestoreRecordStore: Sendable {
  func read() throws -> RestoreRecord?
  func write(_ record: RestoreRecord) throws
  func clear() throws
}

public protocol SystemDNSAdapter: Sendable {
  func capture() throws -> [DNSServiceSnapshot]
  func applyLoopback(to record: RestoreRecord) throws
  func isStillOwned(_ record: RestoreRecord) throws -> Bool
  func restoreExactly(_ record: RestoreRecord) throws
  func verifyRestored(_ record: RestoreRecord) throws
}

public struct RecoveryCoordinator: Sendable {
  private let installID: UUID
  private let store: RestoreRecordStore
  private let adapter: SystemDNSAdapter

  public init(installID: UUID, store: RestoreRecordStore, adapter: SystemDNSAdapter) {
    self.installID = installID
    self.store = store
    self.adapter = adapter
  }

  public func enable() throws -> RestoreRecord {
    try recoverBeforeMutation()
    let snapshots = try adapter.capture()
    var record = try RestoreRecord(installID: installID, services: snapshots)
    try store.write(record) // durable journal precedes the system mutation
    do {
      try adapter.applyLoopback(to: record)
      record.phase = .active
      try store.write(record)
      return record
    } catch {
      if try adapter.isStillOwned(record) {
        var restoring = record
        restoring.phase = .restoring
        try store.write(restoring)
        try adapter.restoreExactly(restoring)
        try adapter.verifyRestored(restoring)
        try store.clear()
      }
      throw error
    }
  }

  public func recoverBeforeMutation() throws {
    guard var record = try store.read() else { return }
    guard record.installID == installID else { throw HelperError.wrongOwner }
    guard try adapter.isStillOwned(record) else { throw HelperError.ownershipChanged }
    record.phase = .restoring
    try store.write(record)
    try adapter.restoreExactly(record)
    try adapter.verifyRestored(record)
    try store.clear()
  }
}
