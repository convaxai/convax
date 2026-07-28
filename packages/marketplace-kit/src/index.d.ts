import { parseMcpServerExtension, parseRegistryV1, parseRegistryV2, projectRegistryV1, type ParsedServerPackage, type RegistryV1, type RegistryV2, type ShowcaseV2 } from "@convax/marketplace";
export type StarterKind = "plugin" | "skill" | "mcp-server";
export interface StarterOptions {
    id: string;
    name: string;
    owner: string;
    repository: string;
    starter: StarterKind;
}
export interface BuildMarketplaceOptions {
    root: string;
    outDir: string;
    official?: boolean;
    sequence?: number;
    previousRegistryPath?: string;
    bootstrapPreviousV1Path?: string;
    initialOfficial?: boolean;
    v1Revision?: string;
    publishIdentities?: readonly string[];
}
export interface MarketplaceBuildResult {
    registry: RegistryV2;
    registrySha256: string;
    registryV1?: RegistryV1;
    showcase: ShowcaseV2;
    artifacts: Array<{
        path: string;
        size: number;
        sha256: string;
        releaseTag: string;
        url: string;
        kind: StarterKind;
        id: string;
        version: string;
    }>;
    releasePlan: {
        schema: "convax.release-plan/1";
        releases: Array<{
            tag: string;
            assets: Array<{
                path: string;
                name: string;
                size: number;
                sha256: string;
                url: string;
            }>;
        }>;
    };
    productLockInput: Record<string, unknown>;
}
interface DiscoveredPackage {
    kind: StarterKind;
    id: string;
    version: string;
    root: string;
    contentRoot: string;
    presentation: {
        name: string;
        description?: string;
    };
    authoring?: Record<string, unknown>;
    manifest?: Record<string, unknown>;
    server?: Record<string, unknown>;
    extension?: ReturnType<typeof parseMcpServerExtension>;
    catalogSupported?: boolean;
    mcpRuntime?: ParsedServerPackage["runtime"];
}
export declare function discoverMarketplacePackages(root: string): Promise<DiscoveredPackage[]>;
export declare function changedMarketplaceVersions(root: string, baseRevision: string): Promise<Array<{
    kind: StarterKind;
    id: string;
    version: string;
    releaseTag: string;
}>>;
interface InventoryEntry {
    path: string;
    bytes: Uint8Array;
    mode: number;
}
export declare function createDeterministicZip(entriesValue: readonly InventoryEntry[]): Uint8Array;
export declare function checkMarketplace(root: string): Promise<void>;
export declare function buildMarketplace(options: BuildMarketplaceOptions): Promise<MarketplaceBuildResult>;
export declare function buildRegistryV2(options: BuildMarketplaceOptions): Promise<RegistryV2>;
export { parseRegistryV1, parseRegistryV2, projectRegistryV1 };
export declare function composeProductLockInput(options: {
    catalogDir: string;
    builtinDir: string;
    outFile: string;
}): Promise<Record<string, unknown>>;
export declare function buildBuiltinBundle(options: {
    root: string;
    outDir: string;
    releaseId?: string;
}): Promise<{
    schema: "convax.builtin-bundle/1";
    release: {
        id: string;
    };
    members: Array<{
        kind: StarterKind;
        id: string;
        version: string;
        artifact: {
            path: string;
            size: number;
            sha256: string;
        };
        presentation: {
            poster: {
                path: string;
                mime: string;
                size: number;
                sha256: string;
            };
            animation?: {
                path: string;
                mime: string;
                size: number;
                sha256: string;
            };
        };
    }>;
    archive: {
        path: string;
        size: number;
        sha256: string;
    };
}>;
export declare function createMarketplaceTemplate(root: string, kind: StarterKind, id: string): Promise<string>;
export declare function createMarketplaceStarter(root: string, options: StarterOptions): Promise<void>;
export declare function addMarketplaceDirectory(root: string, sourceDirectory: string): Promise<string>;
export declare function addTarget(root: string, mcpDirectory: string, options: {
    target: string;
    file: string;
}): Promise<string>;
//# sourceMappingURL=index.d.ts.map