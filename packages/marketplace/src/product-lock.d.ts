export type MarketplaceArtifactLock = {
    name: string;
    sha256: string;
    size: number;
    url: string;
};
export type MarketplacePreinstalledPackagePolicy = {
    id: string;
    kind: "plugin";
    marketplaceId: "convax-official";
    setup: "automatic";
    targets: Array<`${"darwin" | "linux" | "win32"}-${"arm64" | "x64"}`>;
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
    preinstalledPackages: MarketplacePreinstalledPackagePolicy[];
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
                arch: "arm64" | "x64";
                platform: "darwin" | "linux" | "win32";
            }>;
            id: string;
            kind: "plugin";
            marketplaceId: "convax-official";
            ownedSkills: MarketplaceArtifactLock[];
            setup: "explicit";
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