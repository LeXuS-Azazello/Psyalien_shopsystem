import { StoreError } from "./inventory-store.ts";
import type {
  InventorySession,
  InventorySessionReport,
  InventoryStore,
} from "./inventory-store.ts";
import { SqliteInventoryStore } from "./inventory-store.ts";
import { Redis } from "ioredis";

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

function sessionKey(sessionId: string): string {
  return `ps:sessions:${sessionId}`;
}

function readerIndexKey(readerId: string): string {
  return `ps:sessions:reader:${readerId}`;
}

function listKey(): string {
  return `ps:sessions:all`;
}

export class RedisInventoryStore implements InventoryStore {
  private readonly inner: SqliteInventoryStore;
  private readonly redis: Redis;

  constructor(inner: SqliteInventoryStore, redisUrl: string) {
    this.inner = inner;
    this.redis = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
    });
    void this.redis.connect();
  }

  async listProducts() {
    return this.inner.listProducts();
  }

  async createProduct(sku: string, name: string) {
    return this.inner.createProduct(sku, name);
  }

  async updateProduct(id: string, sku: string, name: string) {
    return this.inner.updateProduct(id, sku, name);
  }

  async listInventory() {
    return this.inner.listInventory();
  }

  async listInventoryMovements(limit: number, productId?: string) {
    return this.inner.listInventoryMovements(limit, productId);
  }

  async recordInventoryMovement(
    movement: Parameters<SqliteInventoryStore["recordInventoryMovement"]>[0],
  ) {
    return this.inner.recordInventoryMovement(movement);
  }

  async reconcileInventory(
    readerId: string,
    from: string,
    to: string,
    sessionId?: string,
    useCapturedScanEvents?: boolean,
  ) {
    return this.inner.reconcileInventory(
      readerId,
      from,
      to,
      sessionId,
      useCapturedScanEvents,
    );
  }

  async listTags() {
    return this.inner.listTags();
  }

  async listTagHistory(limit: number, epc?: string) {
    return this.inner.listTagHistory(limit, epc);
  }

  async bindTag(epc: string, productId: string) {
    return this.inner.bindTag(epc, productId);
  }

  async unbindTag(epc: string) {
    return this.inner.unbindTag(epc);
  }

  async listScanEvents(limit: number, epc?: string) {
    return this.inner.listScanEvents(limit, epc);
  }

  async recordScanEvent(
    event: Parameters<SqliteInventoryStore["recordScanEvent"]>[0],
  ) {
    return this.inner.recordScanEvent(event);
  }

  close(): void {
    this.inner.close();
    void this.redis.quit();
  }

  async createInventorySession(readerId: string): Promise<InventorySession> {
    const session = await this.inner.createInventorySession(readerId);

    try {
      const payload = JSON.stringify(session);
      await this.redis.setex(sessionKey(session.sessionId), SESSION_TTL_SECONDS, payload);
      await this.redis.set(readerIndexKey(readerId), session.sessionId);
      await this.redis.zadd(listKey(), Date.now(), session.sessionId);
    } catch {
      // Redis unavailable: session remains durable in SQLite.
    }

    return session;
  }

  async listInventorySessions(limit: number): Promise<InventorySession[]> {
    try {
      const ids = await this.redis.zrevrange(listKey(), 0, limit - 1);
      if (ids.length === 0) {
        return this.inner.listInventorySessions(limit);
      }
      const sessions: InventorySession[] = [];
      for (const id of ids) {
        const raw = await this.redis.get(sessionKey(id));
        if (raw) {
          sessions.push(JSON.parse(raw) as InventorySession);
        }
      }
      if (sessions.length === 0) {
        return this.inner.listInventorySessions(limit);
      }
      return sessions;
    } catch {
      return this.inner.listInventorySessions(limit);
    }
  }

  async closeInventorySession(
    sessionId: string,
  ): Promise<{ status: "closed" | "already_closed"; session: InventorySession }> {
    let session: InventorySession | null = null;
    try {
      const raw = await this.redis.get(sessionKey(sessionId));
      if (raw) {
        session = JSON.parse(raw) as InventorySession;
      }
    } catch {
      session = null;
    }

    if (!session) {
      return this.inner.closeInventorySession(sessionId);
    }

    if (session.closedAt !== null) {
      return { status: "already_closed", session };
    }

    const closedAt = new Date().toISOString();
    const updated: InventorySession = { ...session, closedAt };

    try {
      const ttl = SESSION_TTL_SECONDS;
      await this.redis.setex(
        sessionKey(sessionId),
        ttl,
        JSON.stringify(updated),
      );
    } catch {
      // Redis unavailable: continue with SQLite close.
    }

    return this.inner.closeInventorySession(sessionId);
  }

  async getInventorySessionReport(
    sessionId: string,
  ): Promise<InventorySessionReport> {
    let session: InventorySession | null = null;
    try {
      const raw = await this.redis.get(sessionKey(sessionId));
      if (raw) {
        session = JSON.parse(raw) as InventorySession;
      }
    } catch {
      session = null;
    }

    if (!session) {
      return this.inner.getInventorySessionReport(sessionId);
    }

    return {
      session,
      reconciliation: await this.inner.reconcileInventory(
        session.readerId,
        session.startedAt,
        session.closedAt ?? new Date().toISOString(),
        session.sessionId,
        session.closedAt !== null,
      ),
    };
  }
}
