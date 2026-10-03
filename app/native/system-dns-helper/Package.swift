// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "BobSystemDNSCore",
  platforms: [.macOS(.v13)],
  products: [.library(name: "BobSystemDNSCore", targets: ["BobSystemDNSCore"])],
  targets: [
    .target(name: "BobSystemDNSCore"),
    .testTarget(name: "BobSystemDNSCoreTests", dependencies: ["BobSystemDNSCore"]),
  ]
)
