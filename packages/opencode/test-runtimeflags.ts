// Check module identity
console.log("=== Module identity ===")
const rf = await import("./src/effect/runtime-flags")
console.log("rf module URL:", import.meta.url)
console.log("RuntimeFlags.Service:", rf.RuntimeFlags.Service)
console.log("RuntimeFlags.Service.name:", rf.RuntimeFlags.Service.name)
console.log("RuntimeFlags.Service.ServiceId:", (rf.RuntimeFlags.Service as any).ServiceId)
console.log("RuntimeFlags.node:", rf.RuntimeFlags.node)
console.log("RuntimeFlags.defaultLayer:", rf.RuntimeFlags.defaultLayer)

// Now import via the server module path
const server = await import("./src/server/routes/instance/httpapi/server")
console.log("\n=== Server module ===")
// Check what the server module imports
const rfFromServer = await import("./src/effect/runtime-flags")
console.log("rfFromServer === rf:", rfFromServer === rf)
console.log("rfFromServer.Service === rf.Service:", rfFromServer.RuntimeFlags.Service === rf.RuntimeFlags.Service)
