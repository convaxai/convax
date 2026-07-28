import { type BuiltinArtifactDelivery, type BuiltinBundle } from "./schemas";
export declare function parseBuiltinBundleArchive(archive: Uint8Array, limits?: {
    maxTotalEntryBytes?: number;
}): BuiltinBundle;
export declare function readBuiltinBundleMember(archive: Uint8Array, delivery: BuiltinArtifactDelivery): Uint8Array;
export declare function projectBuiltinMemberDelivery(bundle: BuiltinBundle, identity: {
    kind: "plugin" | "skill";
    id: string;
}): BuiltinArtifactDelivery;
//# sourceMappingURL=builtin-archive.d.ts.map