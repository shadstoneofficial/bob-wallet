import XCTest
@testable import BobSystemDNSCore

final class Box: @unchecked Sendable { var record: RestoreRecord?; var events: [String] = [] }
struct Store: RestoreRecordStore {
  let box: Box
  func read() throws -> RestoreRecord? { box.record }
  func write(_ record: RestoreRecord) throws { box.record = record; box.events.append("write:\(record.phase.rawValue)") }
  func clear() throws { box.record = nil; box.events.append("clear") }
}
struct Adapter: SystemDNSAdapter {
  let box: Box; var owned = true; var failApply = false
  func capture() throws -> [DNSServiceSnapshot] {
    box.events.append("capture")
    return [try DNSServiceSnapshot(stableID: "service-id", previousMode: .dhcp,
                                   previousServers: ["192.0.2.53", "192.0.2.54"])]
  }
  func applyLoopback(to record: RestoreRecord) throws {
    box.events.append("apply"); if failApply { throw CocoaError(.fileWriteUnknown) }
  }
  func isStillOwned(_ record: RestoreRecord) throws -> Bool { box.events.append("ownership"); return owned }
  func restoreExactly(_ record: RestoreRecord) throws { box.events.append("restore:\(record.services[0].previousServers.joined(separator: ","))") }
  func verifyRestored(_ record: RestoreRecord) throws { box.events.append("verify") }
}

final class RecoveryCoordinatorTests: XCTestCase {
  func testJournalPrecedesApplyAndRecoveryIsExact() throws {
    let box = Box(), id = UUID()
    let coordinator = RecoveryCoordinator(installID: id, store: Store(box: box), adapter: Adapter(box: box))
    _ = try coordinator.enable()
    XCTAssertEqual(box.events.prefix(3), ["capture", "write:pending", "apply"])
    try coordinator.recoverBeforeMutation()
    XCTAssertTrue(box.events.contains("restore:192.0.2.53,192.0.2.54"))
    XCTAssertNil(box.record)
  }

  func testChangedOwnershipBlocksRestore() throws {
    let box = Box(), id = UUID()
    box.record = try RestoreRecord(installID: id, phase: .active,
      services: [try DNSServiceSnapshot(stableID: "wifi", previousMode: .empty, previousServers: [])])
    let coordinator = RecoveryCoordinator(installID: id, store: Store(box: box), adapter: Adapter(box: box, owned: false))
    XCTAssertThrowsError(try coordinator.recoverBeforeMutation()) { XCTAssertEqual($0 as? HelperError, .ownershipChanged) }
    XCTAssertNotNil(box.record)
  }

  func testProtocolRejectsVersionAndMissingTransaction() {
    let id = UUID()
    XCTAssertThrowsError(try HelperRequest(protocolVersion: 2, installID: id, operation: .status).validate())
    XCTAssertThrowsError(try HelperRequest(installID: id, operation: .restore).validate())
  }
}
