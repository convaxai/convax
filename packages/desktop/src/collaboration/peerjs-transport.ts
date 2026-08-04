import type { DataConnection as PeerJsDataConnection, Peer as PeerJsPeer } from "peerjs";

/**
 * PeerJS is intentionally only a physical browser transport.  This module does
 * not authenticate a peer, decrypt payloads, order domain commands, persist
 * anything, or acknowledge durable writes.  Its only application-facing bytes
 * are opaque peer wire bytes handed to the Desktop-main owner.
 */

export const collaborationPeerChannels = [
  "control",
  "update",
  "awareness",
  "blob",
] as const;

export type CollaborationPeerChannel =
  (typeof collaborationPeerChannels)[number];

export const collaborationPeerChannelLabel = (
  channel: CollaborationPeerChannel,
): string => `convax-collaboration/${channel}`;

const channelByLabel = new Map<
  string,
  CollaborationPeerChannel
>(
  collaborationPeerChannels.map((channel) => [
    collaborationPeerChannelLabel(channel),
    channel,
  ]),
);

const channelCode: Record<CollaborationPeerChannel, number> = {
  control: 1,
  update: 2,
  blob: 3,
  awareness: 4,
};

const channelFromCode = new Map<
  number,
  CollaborationPeerChannel
>(
  collaborationPeerChannels.map((channel) => [channelCode[channel], channel]),
);

const sendPriority: readonly CollaborationPeerChannel[] = [
  "control",
  "update",
  "awareness",
  "blob",
];

/** PeerJS's documented binary connection surface, kept injectable for tests. */
export interface PeerJsLikeDataConnection {
  readonly peer: string;
  readonly label: string;
  readonly open?: boolean;
  readonly bufferSize?: number;
  send(data: Uint8Array): void;
  close(): void;
  on(
    event: "open" | "data" | "close" | "error",
    listener: (...args: readonly unknown[]) => void,
  ): void;
}

export interface PeerJsLikePeer {
  readonly open?: boolean;
  connect(
    peerId: string,
    options: { label: string; serialization: "binary" },
  ): PeerJsLikeDataConnection;
  on(
    event: "open" | "connection" | "error" | "disconnected" | "close",
    listener: (...args: readonly unknown[]) => void,
  ): void;
  reconnect?(): void;
  destroy?(): void;
}

export interface PeerJsLikeFactory {
  create(localPeerId: string): PeerJsLikePeer;
}

/**
 * Typed bridge for the installed PeerJS client.  It intentionally maps only the
 * documented public events and never exposes metadata or the native dataChannel.
 * Callers inject `createPeer`, keeping construction/configuration at Desktop main.
 */
export function createPeerJsLikeFactory(
  createPeer: (localPeerId: string) => PeerJsPeer,
): PeerJsLikeFactory {
  return {
    create(localPeerId) {
      return adaptPeerJsPeer(createPeer(localPeerId));
    },
  };
}

function adaptPeerJsPeer(peer: PeerJsPeer): PeerJsLikePeer {
  return {
    get open() {
      return peer.open;
    },
    connect(peerId, options) {
      return adaptPeerJsDataConnection(peer.connect(peerId, options));
    },
    on(event, listener) {
      switch (event) {
        case "open":
          peer.on("open", (peerId) => listener(peerId));
          return;
        case "connection":
          peer.on("connection", (connection) => listener(adaptPeerJsDataConnection(connection)));
          return;
        case "error":
          peer.on("error", (error) => listener(error));
          return;
        case "disconnected":
          peer.on("disconnected", (peerId) => listener(peerId));
          return;
        case "close":
          peer.on("close", () => listener());
      }
    },
    reconnect() {
      peer.reconnect();
    },
    destroy() {
      peer.destroy();
    },
  };
}

function adaptPeerJsDataConnection(connection: PeerJsDataConnection): PeerJsLikeDataConnection {
  return {
    peer: connection.peer,
    label: connection.label,
    get open() {
      return connection.open;
    },
    get bufferSize() {
      // `Peer.connect` is typed as the DataConnection base class even though the
      // binary runtime instance exposes the documented buffered-message count.
      const candidate = connection as PeerJsDataConnection & { bufferSize?: unknown };
      return typeof candidate.bufferSize === "number" ? candidate.bufferSize : undefined;
    },
    send(data) {
      void connection.send(data);
    },
    close() {
      connection.close();
    },
    on(event, listener) {
      switch (event) {
        case "open":
          connection.on("open", () => listener());
          return;
        case "data":
          connection.on("data", (data) => listener(data));
          return;
        case "close":
          connection.on("close", () => listener());
          return;
        case "error":
          connection.on("error", (error) => listener(error));
      }
    },
  };
}

/**
 * This is deliberately a one-way ingress port.  Durable ACKs, persistence,
 * decryption, and identity admission belong to the caller, never this adapter.
 */
export interface CollaborationPeerWireIngress {
  receivePeerWireBytes(input: {
    peerId: string;
    channel: CollaborationPeerChannel;
    purpose: "handshake" | "message";
    wireBytes: Uint8Array;
  }): void;
}

export interface CollaborationPeerSessionScope {
  /** Opaque values: they are compared locally and never written to the wire. */
  credentialEpoch: string;
  documentEpoch: string;
}

export interface CollaborationConnectivity {
  isOnline(): boolean;
  subscribe(handlers: {
    onOnline(): void;
    onOffline(): void;
  }): () => void;
}

export interface CollaborationPeerScheduler {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface CollaborationPeerTransportLimits {
  maxQueueEntriesPerChannel: number;
  maxQueuedBytesPerChannel: number;
  /** PeerJS DataConnection.bufferSize is a count of PeerJS-buffered messages. */
  maxConnectionBufferedMessages: number;
  /** Polling is used because PeerJS does not publish a public drain event. */
  pumpIntervalMs: number;
  maxPeerWireBytes: number;
  maxFragmentsPerMessage: number;
  maxReassemblyEntries: number;
  maxReassemblyBytes: number;
  reassemblyTtlMs: number;
  connectionOpenTimeoutMs: number;
  reconnectBaseMs: number;
  reconnectMaxMs: number;
}

export interface CollaborationPeerJsTransportOptions {
  factory: PeerJsLikeFactory;
  localPeerId: string;
  sessionScope: CollaborationPeerSessionScope;
  peerWireIngress: CollaborationPeerWireIngress;
  connectivity?: CollaborationConnectivity;
  scheduler?: CollaborationPeerScheduler;
  random?: () => number;
  createMessageId?: () => Uint8Array;
  limits?: Partial<CollaborationPeerTransportLimits>;
  onTransportError?: (input: {
    peerId?: string;
    channel?: CollaborationPeerChannel;
    reason:
      | "connection-error"
      | "connection-open-timeout"
      | "peer-error"
      | "queue-limit"
      | "wire-invalid"
      | "reassembly-limit"
      | "ingress-error";
  }) => void;
  /** Main uses this only to restart its authenticated session handshake. */
  onRouteReady?: (peerId: string) => void;
  /** Physical loss revokes admission but does not discard Main's durable routes. */
  onRouteReset?: (peerId: string) => void;
}

const physicalFrameBytes = 64 * 1024;
const frameHeaderBytes = 32;
const framePayloadBytes = physicalFrameBytes - frameHeaderBytes;
const frameMagic = 0x43565850; // "CVXP"
const frameVersion = 1;
const handshakeFlag = 1;
const messageIdBytes = 16;

const defaultLimits: CollaborationPeerTransportLimits = {
  maxQueueEntriesPerChannel: 128,
  maxQueuedBytesPerChannel: 2 * 1024 * 1024,
  maxConnectionBufferedMessages: 128,
  pumpIntervalMs: 25,
  maxPeerWireBytes: 65_504 * 256,
  maxFragmentsPerMessage: 256,
  maxReassemblyEntries: 64,
  maxReassemblyBytes: 16 * 1024 * 1024,
  reassemblyTtlMs: 30_000,
  connectionOpenTimeoutMs: 10_000,
  reconnectBaseMs: 250,
  reconnectMaxMs: 15_000,
};

interface WireFrame {
  bytes: Uint8Array;
}

interface ChannelRouteState {
  queue: WireFrame[];
  queuedBytes: number;
  connection?: ManagedConnection;
}

interface PeerRoute {
  peerId: string;
  desired: boolean;
  handshakeComplete: boolean;
  channels: Record<CollaborationPeerChannel, ChannelRouteState>;
  retryAttempt: number;
  readyGeneration?: number;
  retryTimer?: unknown;
}

interface ManagedConnection {
  connection: PeerJsLikeDataConnection;
  channel: CollaborationPeerChannel;
  generation: number;
  open: boolean;
  openTimer?: unknown;
  pumpTimer?: unknown;
}

interface ParsedFrame {
  channel: CollaborationPeerChannel;
  handshake: boolean;
  messageId: Uint8Array;
  fragmentIndex: number;
  fragmentCount: number;
  totalWireBytes: number;
  payload: Uint8Array;
}

interface Reassembly {
  key: string;
  peerId: string;
  channel: CollaborationPeerChannel;
  handshake: boolean;
  messageId: Uint8Array;
  fragmentCount: number;
  totalWireBytes: number;
  pieces: Map<number, Uint8Array>;
  bytes: number;
  expiresAt: number;
  expiryTimer: unknown;
}

function defaultScheduler(): CollaborationPeerScheduler {
  return {
    now: () => Date.now(),
    setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as number),
  };
}

function requireBoundedId(value: string, field: string): void {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    throw new Error(`${field} must be a non-empty string of at most 256 characters`);
  }
}

function requirePositiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive safe integer`);
  }
}

function cloneBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function toWireBytes(value: unknown): Uint8Array | undefined {
  if (value instanceof Uint8Array) {
    return cloneBytes(value);
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value.slice(0));
  }
  return undefined;
}

function messageKey(messageId: Uint8Array): string {
  let output = "";
  for (const value of messageId) {
    output += value.toString(16).padStart(2, "0");
  }
  return output;
}

function createDefaultMessageId(): Uint8Array {
  const output = new Uint8Array(messageIdBytes);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(output);
    return output;
  }
  // This identifier is only a bounded reassembly key, not authentication or key
  // material. Browsers/Electron provide Web Crypto; this fallback keeps tests and
  // constrained runtimes functional without creating a security claim.
  for (let index = 0; index < output.byteLength; index += 1) {
    output[index] = Math.floor(Math.random() * 256);
  }
  return output;
}

function makeRoute(peerId: string): PeerRoute {
  const channels: Record<CollaborationPeerChannel, ChannelRouteState> = {
    control: { queue: [], queuedBytes: 0 },
    update: { queue: [], queuedBytes: 0 },
    awareness: { queue: [], queuedBytes: 0 },
    blob: { queue: [], queuedBytes: 0 },
  };

  return {
    peerId,
    desired: false,
    handshakeComplete: false,
    channels,
    retryAttempt: 0,
  };
}

/**
 * A bounded, peer-wire-only PeerJS transport for Desktop-main composition.
 * It has no knowledge of PeerJS metadata because metadata is not identity.
 */
export class CollaborationPeerJsTransport {
  readonly #factory: PeerJsLikeFactory;
  readonly #peerWireIngress: CollaborationPeerWireIngress;
  readonly #scheduler: CollaborationPeerScheduler;
  readonly #random: () => number;
  readonly #createMessageId: () => Uint8Array;
  readonly #limits: CollaborationPeerTransportLimits;
  readonly #onTransportError?: CollaborationPeerJsTransportOptions["onTransportError"];
  readonly #onRouteReady?: CollaborationPeerJsTransportOptions["onRouteReady"];
  readonly #onRouteReset?: CollaborationPeerJsTransportOptions["onRouteReset"];
  readonly #peer: PeerJsLikePeer;
  readonly #localPeerId: string;
  readonly #routes = new Map<string, PeerRoute>();
  readonly #reassemblies = new Map<string, Reassembly>();
  #reassemblyBytes = 0;
  #generation = 0;
  #online = true;
  #peerReady = true;
  #peerReconnectAttempt = 0;
  #peerReconnectTimer?: unknown;
  #disposed = false;
  #sessionScope: CollaborationPeerSessionScope;
  #unsubscribeConnectivity?: () => void;

  constructor(options: CollaborationPeerJsTransportOptions) {
    requireBoundedId(options.localPeerId, "localPeerId");
    this.#validateScope(options.sessionScope);
    this.#factory = options.factory;
    this.#peerWireIngress = options.peerWireIngress;
    this.#scheduler = options.scheduler ?? defaultScheduler();
    this.#random = options.random ?? Math.random;
    this.#createMessageId = options.createMessageId ?? createDefaultMessageId;
    this.#limits = { ...defaultLimits, ...options.limits };
    this.#validateLimits();
    this.#onTransportError = options.onTransportError;
    this.#onRouteReady = options.onRouteReady;
    this.#onRouteReset = options.onRouteReset;
    this.#sessionScope = { ...options.sessionScope };
    this.#online = options.connectivity?.isOnline() ?? true;
    this.#localPeerId = options.localPeerId;
    this.#peer = this.#factory.create(options.localPeerId);
    this.#peerReady = this.#peer.open !== false;

    this.#peer.on("open", () => {
      this.#handlePeerOpen();
    });
    this.#peer.on("connection", (...args) => {
      this.#acceptIncomingConnection(args[0]);
    });
    this.#peer.on("error", () => {
      this.#report({ reason: "peer-error" });
    });
    this.#peer.on("disconnected", () => {
      this.#handlePeerDisconnected();
    });
    this.#peer.on("close", () => {
      this.#peerReady = false;
      this.#cancelPeerReconnect();
      this.#tearDownAllChannels();
    });

    if (options.connectivity) {
      this.#unsubscribeConnectivity = options.connectivity.subscribe({
        onOnline: () => this.setOnline(true),
        onOffline: () => this.setOnline(false),
      });
    }
  }

  /** Declares a route. It grants no identity or permission to send plaintext. */
  connect(peerId: string): void {
    this.#assertNotDisposed();
    requireBoundedId(peerId, "peerId");
    if (peerId === this.#localPeerId) {
      throw new Error("peerId must not equal localPeerId");
    }
    const route = this.#getOrCreateRoute(peerId);
    route.desired = true;
    if (this.#online && this.#peerReady) {
      this.#openRoute(route);
    }
  }

  /**
   * Sends only control-channel wire bytes carrying the external handshake.
   * A transport handshake frame is not identity admission and never flips state.
   */
  sendHandshakeWireBytes(peerId: string, wireBytes: Uint8Array): boolean {
    return this.#send(peerId, "control", wireBytes, true);
  }

  /**
   * Sends opaque post-admission wireBytes. Before Main marks the route admitted,
   * nothing is queued or sent; this prevents pre-handshake inventory leakage.
   */
  sendPeerWireBytes(
    peerId: string,
    channel: CollaborationPeerChannel,
    wireBytes: Uint8Array,
  ): boolean {
    return this.#send(peerId, channel, wireBytes, false);
  }

  /** Main calls this only after its own authentication/admission protocol. */
  markHandshakeComplete(peerId: string): boolean {
    if (this.#disposed) {
      return false;
    }
    const route = this.#routes.get(peerId);
    if (!route || !this.#online || !this.#peerReady) {
      return false;
    }
    route.handshakeComplete = true;
    this.#flushRoute(route);
    return true;
  }

  /**
   * Credential and document-epoch changes invalidate all physical channels in
   * one lifecycle transition. The opaque values never cross the PeerJS boundary.
   */
  setSessionScope(nextScope: CollaborationPeerSessionScope): void {
    this.#validateScope(nextScope);
    if (
      this.#sessionScope.credentialEpoch === nextScope.credentialEpoch &&
      this.#sessionScope.documentEpoch === nextScope.documentEpoch
    ) {
      return;
    }
    this.#sessionScope = { ...nextScope };
    this.#tearDownAllChannels();
    if (this.#online && this.#peerReady) {
      for (const route of this.#routes.values()) {
        if (route.desired) {
          this.#openRoute(route);
        }
      }
    }
  }

  /** Exposed for an injected browser connectivity source and deterministic tests. */
  setOnline(online: boolean): void {
    if (this.#disposed || this.#online === online) {
      return;
    }
    this.#online = online;
    if (!online) {
      this.#cancelPeerReconnect();
      this.#tearDownAllChannels();
      return;
    }
    if (!this.#peerReady) {
      this.#schedulePeerReconnect();
      return;
    }
    for (const route of this.#routes.values()) {
      if (route.desired) {
        this.#openRoute(route);
      }
    }
  }

  /** Stops one desired route. Inbound-only routes never reconnect by themselves. */
  closePeer(peerId: string): void {
    const route = this.#routes.get(peerId);
    if (!route) {
      return;
    }
    route.desired = false;
    this.#cancelRetry(route);
    this.#closeRouteChannels(route);
    this.#clearRouteQueues(route);
    this.#clearPeerReassemblies(peerId);
    this.#routes.delete(peerId);
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#cancelPeerReconnect();
    this.#unsubscribeConnectivity?.();
    this.#unsubscribeConnectivity = undefined;
    this.#tearDownAllChannels();
    this.#peer.destroy?.();
  }

  #handlePeerOpen(): void {
    if (this.#disposed) return;
    this.#peerReady = true;
    this.#peerReconnectAttempt = 0;
    this.#cancelPeerReconnect();
    if (!this.#online) return;
    for (const route of this.#routes.values()) {
      if (route.desired) this.#openRoute(route);
    }
  }

  #handlePeerDisconnected(): void {
    if (this.#disposed) return;
    this.#peerReady = false;
    this.#tearDownAllChannels();
    if (this.#online) this.#schedulePeerReconnect();
  }

  #schedulePeerReconnect(): void {
    if (this.#disposed || !this.#online || this.#peerReady || this.#peerReconnectTimer !== undefined) return;
    const exponential = Math.min(
      this.#limits.reconnectBaseMs * 2 ** Math.min(this.#peerReconnectAttempt, 16),
      this.#limits.reconnectMaxMs,
    );
    const delay = Math.max(1, Math.floor(exponential * (0.75 + this.#random() * 0.5)));
    this.#peerReconnectTimer = this.#scheduler.setTimeout(() => {
      this.#peerReconnectTimer = undefined;
      if (this.#disposed || !this.#online || this.#peerReady) return;
      this.#peerReconnectAttempt += 1;
      try {
        this.#peer.reconnect?.();
      } catch {
        this.#report({ reason: "peer-error" });
      }
      if (!this.#peerReady) this.#schedulePeerReconnect();
    }, delay);
  }

  #cancelPeerReconnect(): void {
    if (this.#peerReconnectTimer === undefined) return;
    this.#scheduler.clearTimeout(this.#peerReconnectTimer);
    this.#peerReconnectTimer = undefined;
  }

  #send(
    peerId: string,
    channel: CollaborationPeerChannel,
    wireBytes: Uint8Array,
    handshake: boolean,
  ): boolean {
    if (this.#disposed || !this.#online || !(wireBytes instanceof Uint8Array)) {
      return false;
    }
    const route = this.#routes.get(peerId);
    if (!route || (!handshake && !route.handshakeComplete)) {
      return false;
    }
    if (handshake && channel !== "control") {
      return false;
    }
    const frames = this.#encodeFrames(channel, handshake, wireBytes);
    if (!frames) {
      return false;
    }
    const state = route.channels[channel];
    const totalFrameBytes = frames.reduce(
      (total, frame) => total + frame.bytes.byteLength,
      0,
    );
    if (
      state.queue.length + frames.length > this.#limits.maxQueueEntriesPerChannel ||
      state.queuedBytes + totalFrameBytes > this.#limits.maxQueuedBytesPerChannel
    ) {
      this.#report({ peerId, channel, reason: "queue-limit" });
      return false;
    }
    state.queue.push(...frames);
    state.queuedBytes += totalFrameBytes;
    this.#flushRoute(route);
    return true;
  }

  #encodeFrames(
    channel: CollaborationPeerChannel,
    handshake: boolean,
    wireBytes: Uint8Array,
  ): WireFrame[] | undefined {
    if (
      wireBytes.byteLength === 0 ||
      wireBytes.byteLength > this.#limits.maxPeerWireBytes
    ) {
      return undefined;
    }
    const fragmentCount = Math.ceil(wireBytes.byteLength / framePayloadBytes);
    if (fragmentCount > this.#limits.maxFragmentsPerMessage) {
      return undefined;
    }
    const messageId = this.#createMessageId();
    if (!(messageId instanceof Uint8Array) || messageId.byteLength !== messageIdBytes) {
      throw new Error("createMessageId must return exactly 16 bytes");
    }
    const frames: WireFrame[] = [];
    for (let fragmentIndex = 0; fragmentIndex < fragmentCount; fragmentIndex += 1) {
      const offset = fragmentIndex * framePayloadBytes;
      const payload = wireBytes.subarray(
        offset,
        Math.min(offset + framePayloadBytes, wireBytes.byteLength),
      );
      const bytes = new Uint8Array(frameHeaderBytes + payload.byteLength);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      view.setUint32(0, frameMagic);
      view.setUint8(4, frameVersion);
      view.setUint8(5, channelCode[channel]);
      view.setUint8(6, handshake ? handshakeFlag : 0);
      view.setUint8(7, 0);
      bytes.set(messageId, 8);
      view.setUint16(24, fragmentIndex);
      view.setUint16(26, fragmentCount);
      view.setUint32(28, wireBytes.byteLength);
      bytes.set(payload, frameHeaderBytes);
      frames.push({ bytes });
    }
    return frames;
  }

  #getOrCreateRoute(peerId: string): PeerRoute {
    const existing = this.#routes.get(peerId);
    if (existing) {
      return existing;
    }
    const route = makeRoute(peerId);
    this.#routes.set(peerId, route);
    return route;
  }

  #openRoute(route: PeerRoute): void {
    if (
      this.#disposed ||
      !this.#online ||
      !route.desired ||
      !this.#isInitiatorFor(route.peerId)
    ) {
      return;
    }
    for (const channel of collaborationPeerChannels) {
      if (route.channels[channel].connection) {
        continue;
      }
      let connection: PeerJsLikeDataConnection;
      try {
        connection = this.#peer.connect(route.peerId, {
          label: collaborationPeerChannelLabel(channel),
          serialization: "binary",
        });
      } catch {
        this.#report({ peerId: route.peerId, channel, reason: "connection-error" });
        this.#scheduleReconnect(route);
        return;
      }
      this.#bindConnection(route, channel, connection);
    }
  }

  #acceptIncomingConnection(candidate: unknown): void {
    if (this.#disposed || !this.#online || !this.#isConnection(candidate)) {
      this.#closeUnknownConnection(candidate);
      return;
    }
    const channel = channelByLabel.get(candidate.label);
    if (
      !channel ||
      !this.#isPeerId(candidate.peer) ||
      candidate.peer === this.#localPeerId ||
      this.#isInitiatorFor(candidate.peer)
    ) {
      candidate.close();
      return;
    }
    const route = this.#getOrCreateRoute(candidate.peer);
    // The lexical peer-id initiator rule prevents both ends from closing each
    // other's simultaneous outbound connections. Metadata is deliberately ignored;
    // it cannot be used to decide routing or identity.
    if (route.channels[channel].connection) {
      candidate.close();
      return;
    }
    this.#bindConnection(route, channel, candidate);
  }

  #bindConnection(
    route: PeerRoute,
    channel: CollaborationPeerChannel,
    connection: PeerJsLikeDataConnection,
  ): void {
    const state: ManagedConnection = {
      connection,
      channel,
      generation: this.#generation,
      open: connection.open === true,
    };
    route.channels[channel].connection = state;
    connection.on("open", () => this.#onConnectionOpen(route, state));
    connection.on("data", (...args) => this.#onConnectionData(route, state, args[0]));
    connection.on("close", () => this.#onConnectionClosed(route, state));
    connection.on("error", () => {
      this.#report({ peerId: route.peerId, channel, reason: "connection-error" });
      try {
        state.connection.close();
      } catch {
        // The local teardown below is still required if PeerJS close throws.
      }
      this.#onConnectionClosed(route, state);
    });
    if (state.open) {
      this.#onConnectionOpen(route, state);
      return;
    }
    state.openTimer = this.#scheduler.setTimeout(() => {
      if (!this.#isCurrentConnection(route, state)) {
        return;
      }
      this.#report({
        peerId: route.peerId,
        channel,
        reason: "connection-open-timeout",
      });
      try {
        state.connection.close();
      } catch {
        // The state transition below remains authoritative when close throws.
      }
      this.#onConnectionClosed(route, state);
    }, this.#limits.connectionOpenTimeoutMs);
  }

  #onConnectionOpen(route: PeerRoute, state: ManagedConnection): void {
    if (!this.#isCurrentConnection(route, state)) {
      return;
    }
    state.open = true;
    this.#cancelOpenTimer(state);
    if (this.#allChannelsOpen(route)) {
      route.retryAttempt = 0;
      if (route.readyGeneration !== this.#generation) {
        route.readyGeneration = this.#generation;
        this.#onRouteReady?.(route.peerId);
      }
    }
    this.#flushRoute(route);
  }

  #onConnectionData(
    route: PeerRoute,
    state: ManagedConnection,
    candidate: unknown,
  ): void {
    if (!this.#isCurrentConnection(route, state)) {
      return;
    }
    const bytes = toWireBytes(candidate);
    const parsed = bytes && this.#parseFrame(bytes, state.channel);
    if (!parsed) {
      this.#report({ peerId: route.peerId, channel: state.channel, reason: "wire-invalid" });
      return;
    }
    if (parsed.handshake) {
      if (parsed.channel !== "control") {
        this.#report({ peerId: route.peerId, channel: state.channel, reason: "wire-invalid" });
        return;
      }
    } else if (!route.handshakeComplete) {
      // Normal updates and any inventory-like message are ignored before Main
      // explicitly completes admission; they are neither queued nor observed.
      return;
    }
    const wireBytes = this.#acceptFragment(route, parsed);
    if (!wireBytes) {
      return;
    }
    try {
      this.#peerWireIngress.receivePeerWireBytes({
        peerId: route.peerId,
        channel: parsed.channel,
        purpose: parsed.handshake ? "handshake" : "message",
        wireBytes,
      });
    } catch {
      this.#report({ peerId: route.peerId, channel: parsed.channel, reason: "ingress-error" });
    }
  }

  #parseFrame(bytes: Uint8Array, expectedChannel: CollaborationPeerChannel): ParsedFrame | undefined {
    if (bytes.byteLength < frameHeaderBytes || bytes.byteLength > physicalFrameBytes) {
      return undefined;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (
      view.getUint32(0) !== frameMagic ||
      view.getUint8(4) !== frameVersion ||
      view.getUint8(7) !== 0
    ) {
      return undefined;
    }
    const channel = channelFromCode.get(view.getUint8(5));
    const flags = view.getUint8(6);
    const fragmentIndex = view.getUint16(24);
    const fragmentCount = view.getUint16(26);
    const totalWireBytes = view.getUint32(28);
    if (
      !channel ||
      channel !== expectedChannel ||
      (flags & ~handshakeFlag) !== 0 ||
      fragmentCount === 0 ||
      fragmentCount > this.#limits.maxFragmentsPerMessage ||
      fragmentIndex >= fragmentCount ||
      totalWireBytes === 0 ||
      totalWireBytes > this.#limits.maxPeerWireBytes ||
      fragmentCount !== Math.ceil(totalWireBytes / framePayloadBytes)
    ) {
      return undefined;
    }
    const expectedPayloadBytes =
      fragmentIndex === fragmentCount - 1
        ? totalWireBytes - framePayloadBytes * (fragmentCount - 1)
        : framePayloadBytes;
    if (bytes.byteLength !== frameHeaderBytes + expectedPayloadBytes) {
      return undefined;
    }
    return {
      channel,
      handshake: (flags & handshakeFlag) !== 0,
      messageId: bytes.slice(8, 8 + messageIdBytes),
      fragmentIndex,
      fragmentCount,
      totalWireBytes,
      payload: bytes.slice(frameHeaderBytes),
    };
  }

  #acceptFragment(route: PeerRoute, frame: ParsedFrame): Uint8Array | undefined {
    if (frame.fragmentCount === 1) {
      return cloneBytes(frame.payload);
    }
    const key = `${route.peerId}:${frame.channel}:${frame.handshake ? "h" : "m"}:${messageKey(frame.messageId)}`;
    let reassembly = this.#reassemblies.get(key);
    if (!reassembly) {
      if (this.#reassemblies.size >= this.#limits.maxReassemblyEntries) {
        this.#report({ peerId: route.peerId, channel: frame.channel, reason: "reassembly-limit" });
        return undefined;
      }
      if (this.#reassemblyBytes + frame.payload.byteLength > this.#limits.maxReassemblyBytes) {
        this.#report({ peerId: route.peerId, channel: frame.channel, reason: "reassembly-limit" });
        return undefined;
      }
      reassembly = {
        key,
        peerId: route.peerId,
        channel: frame.channel,
        handshake: frame.handshake,
        messageId: cloneBytes(frame.messageId),
        fragmentCount: frame.fragmentCount,
        totalWireBytes: frame.totalWireBytes,
        pieces: new Map(),
        bytes: 0,
        expiresAt: this.#scheduler.now() + this.#limits.reassemblyTtlMs,
        expiryTimer: undefined,
      };
      this.#reassemblies.set(key, reassembly);
      reassembly.expiryTimer = this.#scheduler.setTimeout(() => {
        const current = this.#reassemblies.get(key);
        if (current && current === reassembly) {
          this.#dropReassembly(current);
        }
      }, this.#limits.reassemblyTtlMs);
    }
    if (
      reassembly.channel !== frame.channel ||
      reassembly.handshake !== frame.handshake ||
      reassembly.fragmentCount !== frame.fragmentCount ||
      reassembly.totalWireBytes !== frame.totalWireBytes ||
      !sameBytes(reassembly.messageId, frame.messageId)
    ) {
      this.#dropReassembly(reassembly);
      return undefined;
    }
    const existing = reassembly.pieces.get(frame.fragmentIndex);
    if (existing) {
      if (!sameBytes(existing, frame.payload)) {
        this.#dropReassembly(reassembly);
      }
      return undefined;
    }
    if (this.#reassemblyBytes + frame.payload.byteLength > this.#limits.maxReassemblyBytes) {
      this.#dropReassembly(reassembly);
      this.#report({ peerId: route.peerId, channel: frame.channel, reason: "reassembly-limit" });
      return undefined;
    }
    reassembly.pieces.set(frame.fragmentIndex, cloneBytes(frame.payload));
    reassembly.bytes += frame.payload.byteLength;
    this.#reassemblyBytes += frame.payload.byteLength;
    if (reassembly.pieces.size !== reassembly.fragmentCount) {
      return undefined;
    }
    const wireBytes = new Uint8Array(reassembly.totalWireBytes);
    let offset = 0;
    for (let index = 0; index < reassembly.fragmentCount; index += 1) {
      const payload = reassembly.pieces.get(index);
      if (!payload) {
        this.#dropReassembly(reassembly);
        return undefined;
      }
      wireBytes.set(payload, offset);
      offset += payload.byteLength;
    }
    if (offset !== reassembly.totalWireBytes) {
      this.#dropReassembly(reassembly);
      return undefined;
    }
    this.#dropReassembly(reassembly);
    return wireBytes;
  }

  #flushRoute(route: PeerRoute): void {
    if (this.#disposed || !this.#online) {
      return;
    }
    for (const channel of sendPriority) {
      const state = route.channels[channel];
      const managed = state.connection;
      if (!managed || !managed.open || !this.#isCurrentConnection(route, managed)) {
        continue;
      }
      while (state.queue.length > 0) {
        const bufferedMessages = managed.connection.bufferSize ?? 0;
        if (
          !Number.isFinite(bufferedMessages) ||
          bufferedMessages < 0 ||
          bufferedMessages >= this.#limits.maxConnectionBufferedMessages
        ) {
          this.#schedulePump(route, managed);
          break;
        }
        const frame = state.queue[0];
        try {
          managed.connection.send(frame.bytes);
        } catch {
          this.#report({ peerId: route.peerId, channel, reason: "connection-error" });
          this.#onConnectionClosed(route, managed);
          break;
        }
        state.queue.shift();
        state.queuedBytes -= frame.bytes.byteLength;
      }
      if (state.queue.length > 0 && route.channels[channel].connection === managed) {
        this.#schedulePump(route, managed);
      }
    }
  }

  #onConnectionClosed(route: PeerRoute, state: ManagedConnection): void {
    if (!this.#isCurrentConnection(route, state)) {
      return;
    }
    route.channels[state.channel].connection = undefined;
    this.#cancelOpenTimer(state);
    this.#cancelPump(state);
    const hadSession = route.handshakeComplete || route.readyGeneration !== undefined;
    route.handshakeComplete = false;
    route.readyGeneration = undefined;
    // The four physical connections form one admitted transport session.  Keeping
    // old control/awareness links alive after another channel has died would let a
    // subsequent handshake span two sessions, so any channel failure tears down
    // the remaining three before one retry recreates the full set.
    this.#closeRouteChannels(route);
    this.#clearRouteQueues(route);
    this.#clearPeerReassemblies(route.peerId);
    if (hadSession) this.#onRouteReset?.(route.peerId);
    if (
      route.desired &&
      this.#online &&
      !this.#disposed &&
      this.#isInitiatorFor(route.peerId)
    ) {
      this.#scheduleReconnect(route);
    }
  }

  #scheduleReconnect(route: PeerRoute): void {
    if (
      route.retryTimer !== undefined ||
      !route.desired ||
      !this.#online ||
      this.#disposed ||
      !this.#isInitiatorFor(route.peerId)
    ) {
      return;
    }
    const attempt = route.retryAttempt;
    route.retryAttempt += 1;
    const exponential = Math.min(
      this.#limits.reconnectMaxMs,
      this.#limits.reconnectBaseMs * 2 ** Math.min(attempt, 16),
    );
    const entropy = this.#random();
    const jitter = Number.isFinite(entropy) ? Math.min(1, Math.max(0, entropy)) : 0.5;
    const delayMs = Math.floor(exponential * (0.5 + jitter));
    const expectedGeneration = this.#generation;
    const timer = this.#scheduler.setTimeout(() => {
      if (route.retryTimer !== timer) {
        return;
      }
      route.retryTimer = undefined;
      if (
        this.#generation !== expectedGeneration ||
        !route.desired ||
        !this.#online ||
        this.#disposed
      ) {
        return;
      }
      this.#openRoute(route);
    }, delayMs);
    route.retryTimer = timer;
  }

  #tearDownAllChannels(): void {
    this.#generation += 1;
    for (const route of this.#routes.values()) {
      const hadSession = route.handshakeComplete || route.readyGeneration !== undefined;
      this.#cancelRetry(route);
      this.#closeRouteChannels(route);
      this.#clearRouteQueues(route);
      route.handshakeComplete = false;
      route.readyGeneration = undefined;
      if (hadSession) this.#onRouteReset?.(route.peerId);
    }
    this.#clearAllReassemblies();
  }

  #closeRouteChannels(route: PeerRoute): void {
    for (const channel of collaborationPeerChannels) {
      const managed = route.channels[channel].connection;
      if (!managed) {
        continue;
      }
      route.channels[channel].connection = undefined;
      this.#cancelOpenTimer(managed);
      this.#cancelPump(managed);
      try {
        managed.connection.close();
      } catch {
        // Closing is best effort; detaching state makes stale callbacks inert.
      }
    }
  }

  #clearRouteQueues(route: PeerRoute): void {
    for (const channel of collaborationPeerChannels) {
      const state = route.channels[channel];
      state.queue = [];
      state.queuedBytes = 0;
    }
  }

  #clearPeerReassemblies(peerId: string): void {
    for (const reassembly of this.#reassemblies.values()) {
      if (reassembly.peerId === peerId) {
        this.#dropReassembly(reassembly);
      }
    }
  }

  #clearAllReassemblies(): void {
    for (const reassembly of this.#reassemblies.values()) {
      this.#dropReassembly(reassembly);
    }
  }

  #dropReassembly(reassembly: Reassembly): void {
    if (this.#reassemblies.get(reassembly.key) !== reassembly) {
      return;
    }
    this.#reassemblies.delete(reassembly.key);
    this.#scheduler.clearTimeout(reassembly.expiryTimer);
    this.#reassemblyBytes -= reassembly.bytes;
  }

  #cancelRetry(route: PeerRoute): void {
    if (route.retryTimer !== undefined) {
      this.#scheduler.clearTimeout(route.retryTimer);
      route.retryTimer = undefined;
    }
  }

  #cancelOpenTimer(state: ManagedConnection): void {
    if (state.openTimer !== undefined) {
      this.#scheduler.clearTimeout(state.openTimer);
      state.openTimer = undefined;
    }
  }

  #schedulePump(route: PeerRoute, state: ManagedConnection): void {
    if (state.pumpTimer !== undefined || !this.#isCurrentConnection(route, state)) {
      return;
    }
    state.pumpTimer = this.#scheduler.setTimeout(() => {
      state.pumpTimer = undefined;
      if (this.#isCurrentConnection(route, state)) {
        this.#flushRoute(route);
      }
    }, this.#limits.pumpIntervalMs);
  }

  #cancelPump(state: ManagedConnection): void {
    if (state.pumpTimer !== undefined) {
      this.#scheduler.clearTimeout(state.pumpTimer);
      state.pumpTimer = undefined;
    }
  }

  #allChannelsOpen(route: PeerRoute): boolean {
    return collaborationPeerChannels.every(
      (channel) => route.channels[channel].connection?.open === true,
    );
  }

  #isCurrentConnection(route: PeerRoute, state: ManagedConnection): boolean {
    return (
      !this.#disposed &&
      this.#online &&
      state.generation === this.#generation &&
      route.channels[state.channel].connection === state
    );
  }

  #isConnection(candidate: unknown): candidate is PeerJsLikeDataConnection {
    if (!candidate || typeof candidate !== "object") {
      return false;
    }
    const value = candidate as Partial<PeerJsLikeDataConnection>;
    return (
      typeof value.peer === "string" &&
      typeof value.label === "string" &&
      typeof value.send === "function" &&
      typeof value.close === "function" &&
      typeof value.on === "function"
    );
  }

  #isPeerId(peerId: string): boolean {
    return peerId.length > 0 && peerId.length <= 256;
  }

  #isInitiatorFor(peerId: string): boolean {
    return this.#localPeerId < peerId;
  }

  #closeUnknownConnection(candidate: unknown): void {
    if (candidate && typeof candidate === "object" && "close" in candidate) {
      const close = (candidate as { close?: unknown }).close;
      if (typeof close === "function") {
        try {
          close.call(candidate);
        } catch {
          // Invalid remote input is not allowed to escape into product state.
        }
      }
    }
  }

  #validateScope(scope: CollaborationPeerSessionScope): void {
    requireBoundedId(scope.credentialEpoch, "sessionScope.credentialEpoch");
    requireBoundedId(scope.documentEpoch, "sessionScope.documentEpoch");
  }

  #validateLimits(): void {
    for (const [field, value] of Object.entries(this.#limits)) {
      requirePositiveInteger(value, `limits.${field}`);
    }
    if (this.#limits.reconnectBaseMs > this.#limits.reconnectMaxMs) {
      throw new Error("limits.reconnectBaseMs must be no greater than reconnectMaxMs");
    }
    if (
      this.#limits.maxPeerWireBytes >
      framePayloadBytes * this.#limits.maxFragmentsPerMessage
    ) {
      throw new Error("limits.maxPeerWireBytes exceeds the configured fragment bound");
    }
  }

  #assertNotDisposed(): void {
    if (this.#disposed) {
      throw new Error("CollaborationPeerJsTransport is disposed");
    }
  }

  #report(
    input: NonNullable<CollaborationPeerJsTransportOptions["onTransportError"]> extends (
      value: infer Value,
    ) => void
      ? Value
      : never,
  ): void {
    try {
      this.#onTransportError?.(input);
    } catch {
      // Observability must not change the transport state machine.
    }
  }
}
