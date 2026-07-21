/**
 * Compatibility entrypoint. Web is one node-renderer transport; capability
 * validation and Canvas host ports live in transport-neutral modules.
 */
export * from "../plugin-canvas-host"
export * from "../plugin-host-types"
export * from "./web-plugin-node-renderer"
