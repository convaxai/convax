export type MarketplaceKind = "builtin" | "network" | "local";
export type MarketplaceItemKind = "plugin" | "skill" | "mcp-server";
export type Sha256 = string;
export interface MarketplaceItemRef {
    marketplaceId: string;
    kind: MarketplaceItemKind;
    id: string;
}
export interface Compatibility {
    convax: string;
}
export interface Presentation {
    name: string;
    description?: string;
}
export interface ArtifactDelivery {
    kind: "artifact";
    url: string;
    size: number;
    sha256: Sha256;
}
export interface BuiltinArtifactDelivery {
    kind: "builtin-artifact";
    bundleReleaseId: string;
    path: string;
    size: number;
    sha256: Sha256;
}
export type PluginCompanion = {
    command: string;
    version: string;
    targets: Array<{
        platform: "darwin" | "linux" | "win32";
        arch: "arm64" | "x64";
        artifact: {
            url: string;
            size: number;
            sha256: Sha256;
        };
    }>;
};
export interface McpHttpDelivery {
    kind: "mcp-http";
    serverJson: Record<string, unknown>;
    serverJsonSha256: Sha256;
    runtime: {
        endpoint: string;
        transport: "streamable-http" | "sse";
    };
}
export interface CompanionArtifact {
    target: string;
    command: string;
    url: string;
    size: number;
    sha256: Sha256;
}
export interface McpManagedStdioDelivery {
    kind: "mcp-managed-stdio";
    serverJson: Record<string, unknown>;
    serverJsonSha256: Sha256;
    extension: McpServerExtension;
    extensionSha256: Sha256;
    companions: CompanionArtifact[];
}
export type MarketplaceDelivery = ArtifactDelivery | BuiltinArtifactDelivery | McpHttpDelivery | McpManagedStdioDelivery;
export interface RegistryPackage {
    kind: MarketplaceItemKind;
    id: string;
    version: string;
    compatibility: Compatibility;
    presentation: Presentation;
    delivery: MarketplaceDelivery;
    yanked?: boolean;
    manifest?: Record<string, unknown>;
    companions?: PluginCompanion[];
    ownerPluginId?: string;
}
export interface RegistryV2 {
    schema: "convax.registry/2";
    marketplaceId: string;
    sequence: number;
    revision: string;
    packages: RegistryPackage[];
}
export interface MarketplaceDescriptor {
    schema: "convax.marketplace/1";
    id: string;
    name: string;
    publisher: {
        name: string;
    };
    repository: {
        owner: string;
        name: string;
    };
    registry: {
        v2: {
            url: string;
        };
    };
    showcase: {
        v2: {
            url: string;
        };
    };
    compatibility: Compatibility;
    delivery: {
        kind: "github-pages-releases";
    };
}
export interface McpServerExtension {
    schema: "convax.mcp-server-extension/1";
    runtime: {
        kind: "managed-stdio";
        command: string;
        argv: string[];
        compatibility: {
            targets: string[];
        };
    };
    productActions?: Array<{
        action: "canvas.import" | "canvas.export" | "project.files.read";
        tool: string;
    }>;
    grants?: Array<"canvas.read" | "canvas.write" | "project.files.read">;
}
export interface ParsedServerPackage {
    id: string;
    version: string;
    definition: Record<string, unknown>;
    runtime: {
        kind: "http-agent";
        endpoint: string;
        transport: "streamable-http" | "sse";
    } | {
        kind: "managed-stdio";
        command: string;
        argv: readonly string[];
        targets: readonly string[];
    };
    extension?: McpServerExtension;
}
export type ServerPackageCatalogAdmission = {
    supported: true;
    package: ParsedServerPackage;
} | {
    supported: false;
    id: string;
    version: string;
    definition: Record<string, unknown>;
    reason: "no-supported-runtime";
};
export interface BuiltinBundle {
    schema: "convax.builtin-bundle/1";
    release: {
        id: string;
    };
    members: Array<{
        kind: "plugin" | "skill";
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
}
export interface ShowcaseAsset {
    url: string;
    size: number;
    sha256: Sha256;
    mime: "image/png" | "image/jpeg" | "image/webp" | "video/mp4" | "video/webm";
    alt?: string;
    width?: number;
    height?: number;
}
export interface ShowcaseV2 {
    schema: "convax.showcase/2";
    marketplaceId: string;
    revision: string;
    packages: Array<{
        kind: MarketplaceItemKind;
        id: string;
        version: string;
        presentation: {
            name: string;
            description?: string;
            poster: ShowcaseAsset;
            animation?: ShowcaseAsset;
        };
    }>;
}
export declare function parseMarketplaceDescriptor(value: unknown): MarketplaceDescriptor;
export declare function parseMcpServerExtension(value: unknown): McpServerExtension;
export declare function parseRegistryV2(value: unknown): RegistryV2;
export declare function parseShowcaseV2(value: unknown, registry: RegistryV2, descriptor: MarketplaceDescriptor): ShowcaseV2;
export declare function parseBuiltinBundle(value: unknown): BuiltinBundle;
export declare function classifyServerPackageForCatalog(definitionValue: unknown, extensionValue?: unknown): ServerPackageCatalogAdmission;
export declare function parseServerPackage(definitionValue: unknown, extensionValue?: unknown): ParsedServerPackage;
//# sourceMappingURL=schemas.d.ts.map