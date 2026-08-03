import { describe, expect, test } from "bun:test";
import type { DataConnection, Peer } from "peerjs";

import {
  collaborationPeerChannelLabel,
  collaborationPeerChannels,
  CollaborationPeerJsTransport,
  createPeerJsLikeFactory,
  type CollaborationPeerWireIngress,
  type CollaborationPeerScheduler,
  type PeerJsLikeDataConnection,
  type PeerJsLikeFactory,
  type PeerJsLikePeer,
} from "./peerjs-transport";

type ConnectionEvent = "open" | "data" | "close" | "error";
type PeerEvent = "open" | "connection" | "error" | "disconnected" | "close";

class FakeScheduler implements CollaborationPeerScheduler {
  #now = 0;
  #nextId = 1;
  #timers = new Map<number, { at: number; callback: () => void }>();

  now(): number {
    return this.#now;
  }

  setTimeout(callback: () => void, delayMs: number): number {
    const id = this.#nextId;
    this.#nextId += 1;
    this.#timers.set(id, { at: this.#now + delayMs, callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    if (typeof handle === "number") {
      this.#timers.delete(handle);
    }
  }

  advance(delayMs: number): void {
    const deadline = this.#now + delayMs;
    while (true) {
      const due = [...this.#timers.entries()]
        .filter(([, timer]) => timer.at <= deadline)
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (!due) {
        break;
      }
      const [id, timer] = due;
      this.#timers.delete(id);
      this.#now = timer.at;
      timer.callback();
    }
    this.#now = deadline;
  }
}

class FakeConnection implements PeerJsLikeDataConnection {
  readonly sent: Uint8Array[] = [];
  readonly #listeners = new Map<ConnectionEvent, Array<(...args: readonly unknown[]) => void>>();
  open = false;
  bufferSize = 0;
  closeCount = 0;
  linked?: FakeConnection;
  metadata = { claimedIdentity: "never-consumed" };

  constructor(
    readonly peer: string,
    readonly label: string,
  ) {}

  send(data: Uint8Array): void {
    this.sent.push(new Uint8Array(data));
    this.linked?.emit("data", new Uint8Array(data));
  }

  close(): void {
    this.closeCount += 1;
    this.open = false;
    this.emit("close");
  }

  on(
    event: ConnectionEvent,
    listener: (...args: readonly unknown[]) => void,
  ): void {
    const listeners = this.#listeners.get(event) ?? [];
    listeners.push(listener);
    this.#listeners.set(event, listeners);
  }

  openNow(): void {
    this.open = true;
    this.emit("open");
  }

  emit(event: ConnectionEvent, ...args: readonly unknown[]): void {
    for (const listener of this.#listeners.get(event) ?? []) {
      listener(...args);
    }
  }
}

class FakePeer implements PeerJsLikePeer {
  readonly connections: FakeConnection[] = [];
  readonly #listeners = new Map<PeerEvent, Array<(...args: readonly unknown[]) => void>>();
  destroyed = false;
  open = true;
  reconnectCount = 0;

  connect(
    peerId: string,
    options: { label: string; serialization: "binary" },
  ): FakeConnection {
    expect(options.serialization).toBe("binary");
    const connection = new FakeConnection(peerId, options.label);
    this.connections.push(connection);
    return connection;
  }

  on(event: PeerEvent, listener: (...args: readonly unknown[]) => void): void {
    const listeners = this.#listeners.get(event) ?? [];
    listeners.push(listener);
    this.#listeners.set(event, listeners);
  }

  emit(event: PeerEvent, ...args: readonly unknown[]): void {
    for (const listener of this.#listeners.get(event) ?? []) {
      listener(...args);
    }
  }

  accept(connection: FakeConnection): void {
    this.emit("connection", connection);
  }

  destroy(): void {
    this.destroyed = true;
  }

  reconnect(): void {
    this.reconnectCount += 1;
  }
}

class FakeFactory implements PeerJsLikeFactory {
  constructor(readonly peer: FakePeer) {}

  create(_localPeerId: string): FakePeer {
    return this.peer;
  }
}

interface ReceivedPeerWire {
  peerId: string;
  channel: string;
  purpose: string;
  wireBytes: Uint8Array;
}

function makeIngress(received: ReceivedPeerWire[]): CollaborationPeerWireIngress {
  return {
    receivePeerWireBytes(input) {
      received.push({ ...input, wireBytes: new Uint8Array(input.wireBytes) });
    },
  };
}

function makeTransport(
  peer: FakePeer,
  received: ReceivedPeerWire[],
  scheduler = new FakeScheduler(),
  options: Partial<ConstructorParameters<typeof CollaborationPeerJsTransport>[0]> = {},
): CollaborationPeerJsTransport {
  return new CollaborationPeerJsTransport({
    factory: new FakeFactory(peer),
    localPeerId: "local",
    sessionScope: { credentialEpoch: "credential-1", documentEpoch: "document-1" },
    peerWireIngress: makeIngress(received),
    scheduler,
    random: () => 0.5,
    createMessageId: () => new Uint8Array(16).fill(7),
    ...options,
  });
}

function openAll(peer: FakePeer): void {
  for (const connection of peer.connections) {
    connection.openNow();
  }
}

function connectionFor(peer: FakePeer, channel: (typeof collaborationPeerChannels)[number]): FakeConnection {
  const connection = peer.connections.find(
    (candidate) => candidate.label === collaborationPeerChannelLabel(channel),
  );
  if (!connection) {
    throw new Error(`missing ${channel} connection`);
  }
  return connection;
}

function bridgeOutboundConnections(
  sourcePeer: FakePeer,
  targetPeer: FakePeer,
  sourcePeerId: string,
): FakeConnection[] {
  const inbound: FakeConnection[] = [];
  for (const outgoing of sourcePeer.connections) {
    if (outgoing.linked) {
      continue;
    }
    const reverse = new FakeConnection(sourcePeerId, outgoing.label);
    outgoing.linked = reverse;
    reverse.linked = outgoing;
    inbound.push(reverse);
    targetPeer.accept(reverse);
    outgoing.openNow();
    reverse.openNow();
  }
  return inbound;
}

describe("CollaborationPeerJsTransport", () => {
  test("opens exactly four fixed binary channels and rejects arbitrary labels", () => {
    const peer = new FakePeer();
    const received: ReceivedPeerWire[] = [];
    const transport = makeTransport(peer, received);

    transport.connect("remote");

    expect(peer.connections.map((connection) => connection.label).sort()).toEqual(
      collaborationPeerChannels.map(collaborationPeerChannelLabel).sort(),
    );
    const invalid = new FakeConnection("remote", "convax-collaboration/inventory");
    peer.accept(invalid);
    expect(invalid.closeCount).toBe(1);
    expect(received).toEqual([]);
  });

  test("does not send or accept normal peer wire bytes before Main completes the handshake", () => {
    const sourcePeer = new FakePeer();
    const targetPeer = new FakePeer();
    const sourceReceived: ReceivedPeerWire[] = [];
    const targetReceived: ReceivedPeerWire[] = [];
    const source = makeTransport(sourcePeer, sourceReceived, new FakeScheduler(), {
      localPeerId: "source",
    });
    const target = makeTransport(targetPeer, targetReceived, new FakeScheduler(), {
      localPeerId: "target",
    });

    source.connect("target");
    bridgeOutboundConnections(sourcePeer, targetPeer, "source");
    expect(source.sendPeerWireBytes("target", "update", new Uint8Array([1]))).toBe(false);
    expect(connectionFor(sourcePeer, "update").sent).toEqual([]);

    expect(source.sendHandshakeWireBytes("target", new Uint8Array([4, 5]))).toBe(true);
    expect(targetReceived).toEqual([
      expect.objectContaining({
        peerId: "source",
        channel: "control",
        purpose: "handshake",
        wireBytes: new Uint8Array([4, 5]),
      }),
    ]);
    expect(target.markHandshakeComplete("source")).toBe(true);
    expect(source.markHandshakeComplete("target")).toBe(true);
    expect(source.sendPeerWireBytes("target", "update", new Uint8Array([8]))).toBe(true);
    expect(targetReceived.at(-1)).toEqual(
      expect.objectContaining({
        channel: "update",
        purpose: "message",
        wireBytes: new Uint8Array([8]),
      }),
    );
  });

  test("fragments peer wire bytes at 64 KiB, reassembles them boundedly, and exposes only bytes", () => {
    const sourcePeer = new FakePeer();
    const targetPeer = new FakePeer();
    const targetReceived: ReceivedPeerWire[] = [];
    const source = makeTransport(sourcePeer, [], new FakeScheduler(), { localPeerId: "source" });
    const target = makeTransport(targetPeer, targetReceived, new FakeScheduler(), {
      localPeerId: "target",
    });
    source.connect("target");
    bridgeOutboundConnections(sourcePeer, targetPeer, "source");
    source.markHandshakeComplete("target");
    target.markHandshakeComplete("source");

    const wireBytes = new Uint8Array(2 * 65_504 + 13).map((_, index) => index % 251);
    expect(source.sendPeerWireBytes("target", "update", wireBytes)).toBe(true);
    const frames = connectionFor(sourcePeer, "update").sent;
    expect(frames).toHaveLength(3);
    expect(frames.every((frame) => frame instanceof Uint8Array && frame.byteLength <= 64 * 1024)).toBe(
      true,
    );
    expect(targetReceived).toHaveLength(1);
    expect(targetReceived[0]).toEqual(
      expect.objectContaining({ channel: "update", purpose: "message" }),
    );
    expect(targetReceived[0]?.wireBytes).toEqual(wireBytes);
  });

  test("uses an injected bounded pump so blob backpressure cannot block update", () => {
    const peer = new FakePeer();
    const clock = new FakeScheduler();
    const transport = makeTransport(peer, [], clock);
    transport.connect("remote");
    openAll(peer);
    transport.markHandshakeComplete("remote");
    connectionFor(peer, "blob").bufferSize = 128;

    expect(transport.sendPeerWireBytes("remote", "blob", new Uint8Array([1]))).toBe(true);
    expect(connectionFor(peer, "blob").sent).toEqual([]);
    expect(transport.sendPeerWireBytes("remote", "update", new Uint8Array([2]))).toBe(true);
    expect(connectionFor(peer, "update").sent).toHaveLength(1);
    expect(connectionFor(peer, "blob").sent).toEqual([]);
    connectionFor(peer, "blob").bufferSize = 0;
    clock.advance(25);
    expect(connectionFor(peer, "blob").sent).toHaveLength(1);
  });

  test("drops expired partial reassembly and does not pass malformed or stale bytes to Main", () => {
    const sourcePeer = new FakePeer();
    const targetPeer = new FakePeer();
    const sourceClock = new FakeScheduler();
    const targetClock = new FakeScheduler();
    const targetReceived: ReceivedPeerWire[] = [];
    const source = makeTransport(sourcePeer, [], sourceClock, { localPeerId: "source" });
    const target = makeTransport(targetPeer, targetReceived, targetClock, { localPeerId: "target" });
    source.connect("target");
    openAll(sourcePeer);
    source.markHandshakeComplete("target");

    const inbound = new FakeConnection("source", collaborationPeerChannelLabel("update"));
    targetPeer.accept(inbound);
    inbound.openNow();
    target.markHandshakeComplete("source");
    const wireBytes = new Uint8Array(65_504 + 1).fill(3);
    source.sendPeerWireBytes("target", "update", wireBytes);
    const frames = connectionFor(sourcePeer, "update").sent;
    inbound.emit("data", frames[0]);
    targetClock.advance(30_000);
    inbound.emit("data", frames[1]);

    expect(targetReceived).toEqual([]);
  });

  test("reconnects with bounded backoff and suspends retry while offline or disposed", () => {
    const peer = new FakePeer();
    const clock = new FakeScheduler();
    const transport = makeTransport(peer, [], clock, {
      limits: { reconnectBaseMs: 100, reconnectMaxMs: 1_000 },
    });
    transport.connect("remote");
    openAll(peer);
    const originalCount = peer.connections.length;
    connectionFor(peer, "update").close();
    clock.advance(99);
    expect(peer.connections).toHaveLength(originalCount);
    clock.advance(1);
    expect(peer.connections).toHaveLength(originalCount + 4);

    transport.setOnline(false);
    const afterOffline = peer.connections.length;
    clock.advance(10_000);
    expect(peer.connections).toHaveLength(afterOffline);
    transport.dispose();
    transport.setOnline(true);
    expect(peer.connections).toHaveLength(afterOffline);
  });

  test("waits for PeerJS readiness and uses reconnect without treating signaling loss as browser offline", () => {
    const peer = new FakePeer();
    peer.open = false;
    const clock = new FakeScheduler();
    const transport = makeTransport(peer, [], clock, {
      limits: { reconnectBaseMs: 100, reconnectMaxMs: 1_000 },
    });

    transport.connect("remote");
    expect(peer.connections).toHaveLength(0);

    peer.open = true;
    peer.emit("open", "local");
    expect(peer.connections).toHaveLength(4);

    openAll(peer);
    peer.open = false;
    peer.emit("disconnected", "local");
    clock.advance(100);
    expect(peer.reconnectCount).toBe(1);
    expect(peer.connections).toHaveLength(4);

    peer.open = true;
    peer.emit("open", "local");
    expect(peer.connections).toHaveLength(8);
    transport.dispose();
  });

  test("credential/epoch changes close every channel once and stale callbacks are inert", () => {
    const peer = new FakePeer();
    const received: ReceivedPeerWire[] = [];
    const transport = makeTransport(peer, received);
    transport.connect("remote");
    openAll(peer);
    transport.markHandshakeComplete("remote");
    const oldConnections = [...peer.connections];

    transport.setSessionScope({ credentialEpoch: "credential-2", documentEpoch: "document-2" });

    expect(oldConnections).toHaveLength(4);
    expect(oldConnections.every((connection) => connection.closeCount === 1)).toBe(true);
    oldConnections[0]?.emit("data", new Uint8Array([1, 2, 3]));
    expect(received).toEqual([]);
    expect(peer.connections).toHaveLength(8);
  });

  test("uses peer-id topology only so simultaneous connect has one four-channel group", () => {
    const lowPeer = new FakePeer();
    const highPeer = new FakePeer();
    const highReceived: ReceivedPeerWire[] = [];
    const low = makeTransport(lowPeer, [], new FakeScheduler(), { localPeerId: "alpha" });
    const high = makeTransport(highPeer, highReceived, new FakeScheduler(), { localPeerId: "omega" });

    low.connect("omega");
    high.connect("alpha");
    expect(lowPeer.connections).toHaveLength(4);
    expect(highPeer.connections).toHaveLength(0);
    const inbound = bridgeOutboundConnections(lowPeer, highPeer, "alpha");
    expect(inbound).toHaveLength(4);
    low.markHandshakeComplete("omega");
    high.markHandshakeComplete("alpha");
    expect(low.sendPeerWireBytes("omega", "awareness", new Uint8Array([9]))).toBe(true);
    expect(highReceived.at(-1)).toEqual(
      expect.objectContaining({ channel: "awareness", wireBytes: new Uint8Array([9]) }),
    );
  });

  test("smokes the installed PeerJS public shape through the narrow adapter", () => {
    const connectionListeners = new Map<string, Array<(...args: unknown[]) => void>>();
    const peerListeners = new Map<string, Array<(...args: unknown[]) => void>>();
    const sent: Uint8Array[] = [];
    const rawConnection = {
      peer: "remote",
      label: collaborationPeerChannelLabel("control"),
      open: true,
      bufferSize: 3,
      send(data: Uint8Array) {
        sent.push(new Uint8Array(data));
      },
      close() {},
      on(event: string, listener: (...args: unknown[]) => void) {
        const listeners = connectionListeners.get(event) ?? [];
        listeners.push(listener);
        connectionListeners.set(event, listeners);
      },
    } as unknown as DataConnection;
    const rawPeer = {
      connect() {
        return rawConnection;
      },
      on(event: string, listener: (...args: unknown[]) => void) {
        const listeners = peerListeners.get(event) ?? [];
        listeners.push(listener);
        peerListeners.set(event, listeners);
      },
      destroy() {},
    } as unknown as Peer;

    const factory = createPeerJsLikeFactory((_localPeerId) => rawPeer);
    const connection = factory.create("local").connect("remote", {
      label: collaborationPeerChannelLabel("control"),
      serialization: "binary",
    });
    const received: Uint8Array[] = [];
    connection.on("data", (data) => received.push(data as Uint8Array));
    connection.send(new Uint8Array([1]));
    connectionListeners.get("data")?.[0]?.(new Uint8Array([2]));

    expect(connection.bufferSize).toBe(3);
    expect(sent).toEqual([new Uint8Array([1])]);
    expect(received).toEqual([new Uint8Array([2])]);
  });
});
