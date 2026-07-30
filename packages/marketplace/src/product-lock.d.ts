export type MarketplaceArtifactLock = {
    name: string;
    sha256: string;
    size: number;
    url: string;
};
export type MarketplaceProductPolicy = {
    builtin: {
        marketplaceId: "convax-builtin";
        repository: "microvoid/convax-plugins";
    };
    official: {
        descriptorUrl: string;
        marketplaceId: "convax-official";
        repository: "microvoid/convax-plugins";
    };
    preinstalledPackages: Array<{
        id: "ffmpeg-tools";
        kind: "plugin";
        marketplaceId: "convax-official";
        setup: "automatic";
        targets: ["darwin-arm64"];
    }>;
    revision: number;
};
export type MarketplaceProductLock = {
    policy: MarketplaceProductPolicy;
    resolved: {
        builtinBundle: MarketplaceArtifactLock;
        builtinReservations: Array<{
            id: string;
            kind: "plugin" | "skill";
        }>;
        official: {
            descriptor: MarketplaceArtifactLock;
            registry: MarketplaceArtifactLock;
            revision: string;
            showcase: MarketplaceArtifactLock;
        };
        packages: Array<{
            artifact: MarketplaceArtifactLock;
            companions: Array<MarketplaceArtifactLock & {
                arch: string;
                platform: string;
            }>;
            id: string;
            kind: "plugin" | "skill" | "mcp-server";
            marketplaceId: string;
            ownedSkills: MarketplaceArtifactLock[];
            setup: "explicit" | "none";
            version: string;
        }>;
        policyDigest: string;
    };
    schema: "convax.marketplace-product-lock/1";
};
export declare function canonicalProductPolicyDigest(policy: MarketplaceProductPolicy): string;
export declare function parseMarketplaceProductPolicy(value: unknown): MarketplaceProductPolicy;
export declare function parseMarketplaceProductLock(value: unknown): MarketplaceProductLock;
//# sourceMappingURL=product-lock.d.ts.map
