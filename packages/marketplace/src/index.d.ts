import type { MarketplaceDelivery, MarketplaceItemKind, MarketplaceKind, Presentation } from "./schemas";
export * from "./schemas";
export * from "./server-schema";
export * from "./canonical";
export * from "./builtin-archive";
declare const sourceKeyBrand: unique symbol;
declare const selectionTokenBrand: unique symbol;
export type SourceKey = string & {
    readonly [sourceKeyBrand]: true;
};
export type SelectionToken = string & {
    readonly [selectionTokenBrand]: true;
};
/**
 * The one product-defined Builtin source identity. Bundle release ids, policy
 * revisions, and member lists are content state and must never enter SourceKey.
 */
export declare const BUILTIN_SOURCE_IDENTITY: {
    readonly kind: "builtin";
    readonly marketplaceId: "convax-builtin";
    readonly sourceInstanceId: "convax-product-builtin";
    readonly policyVersion: 1;
};
export type BuiltinSourceIdentity = typeof BUILTIN_SOURCE_IDENTITY;
export type SourceIdentity = {
    kind: "network";
    marketplaceId: string;
    descriptorUrl: string;
    repository: {
        owner: string;
        name: string;
    };
    deliveryPolicy: "github-pages-releases";
} | BuiltinSourceIdentity | {
    kind: "local";
    marketplaceId: string;
    sourceInstanceId: string;
    policyVersion: number;
};
export interface SourceQualifiedItem {
    marketplaceId: string;
    sourceKey: SourceKey;
    sourceKind: MarketplaceKind;
    sourceOrder: number;
    official: boolean;
    kind: MarketplaceItemKind;
    id: string;
    version: string;
    catalogSequence: number;
    catalogRevision: string;
    runtimeSurface: "none" | "agent" | "agent-and-convax";
    compatibility: {
        convax: string;
    };
    presentation: Presentation;
    delivery: MarketplaceDelivery;
}
export interface CatalogDisplayGroup {
    identity: {
        kind: MarketplaceItemKind;
        id: string;
    };
    representative: SourceQualifiedItem;
    sources: readonly SourceQualifiedItem[];
    requiresSourceSelection: boolean;
}
export interface InstalledSourceIdentity {
    kind: MarketplaceItemKind;
    id: string;
    sourceKey: SourceKey;
    version: string;
}
export interface SourceSecurityState {
    sequence: number;
    revision: string;
    catalogDigest: string;
    versionContracts: Readonly<Record<string, string>>;
}
export interface SelectionTokenPayload {
    senderId: string;
    expiresAt: number;
    ref: {
        marketplaceId: string;
        kind: MarketplaceItemKind;
        id: string;
    };
    sourceKey: SourceKey;
    catalogSequence: number;
    catalogRevision: string;
    version: string;
    metadataDigest: string;
    artifact: {
        url: string;
        size: number;
        sha256: string;
    } | null;
    companion: {
        target: string;
        url: string;
        size: number;
        sha256: string;
    } | null;
}
export declare function resolveSourceRegistration(existing: {
    marketplaceId: string;
    sourceKey: SourceKey;
} | undefined, candidate: {
    marketplaceId: string;
    sourceKey: SourceKey;
}): "add" | "no-op" | "identity-collision";
export declare function computeSourceKey(identity: SourceIdentity): SourceKey;
export declare function builtinSourceKey(): SourceKey;
export declare function identityKeyForMcpServer(name: string): string;
export declare function versionKeyForMcpServer(name: string, version: string): string;
export declare function aggregateCatalog(items: readonly SourceQualifiedItem[], installed?: readonly InstalledSourceIdentity[]): CatalogDisplayGroup[];
export declare function resolveInstallConflict(installed: InstalledSourceIdentity | undefined, candidate: {
    kind: MarketplaceItemKind;
    id: string;
    sourceKey: SourceKey;
}): "new-install" | "same-source-update" | "source-conflict";
export declare function decideSourceMutation(current: SourceSecurityState | undefined, candidate: SourceSecurityState): SourceSecurityState;
export declare function issueSelectionToken(payload: SelectionTokenPayload, secret: Uint8Array, now?: number): SelectionToken;
export declare function verifySelectionToken(token: SelectionToken, expected: {
    senderId: string;
    now: number;
}, secret: Uint8Array): SelectionTokenPayload;
export declare function assertSelectionCurrent(selection: SelectionTokenPayload, current: {
    sourceKey: SourceKey;
    catalogSequence: number;
    catalogRevision: string;
    version: string;
    metadataDigest: string;
    artifact: SelectionTokenPayload["artifact"];
    companion: SelectionTokenPayload["companion"];
}): void;
//# sourceMappingURL=index.d.ts.map
