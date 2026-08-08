// One SQLite file per account.
//
// This is the whole multi-tenancy design, and the reason it fits in 90 lines is
// that it refuses to change the shape of anything else. Every module in this
// codebase already assumes one store equals one fleet: owner.mjs, finance.mjs,
// rollup.mjs, rates.mjs, tips.mjs, variance.mjs and the importer all take a
// `store` and compute over everything in it. Threading an account_id through
// those queries would touch every table, every index and every test. Handing
// each account its own store changes none of them.
//
// The trade is that cross-account queries are impossible here. That is correct
// for now: the only cross-account number we want is the funnel, which lives in
// the control database, and peer benchmarks need a corpus we do not have.
//
// Isolation is structural rather than enforced by a WHERE clause, which is the
// property worth having: there is no query anyone can forget to scope. A bug in
// routing hands an owner the wrong file and fails loudly; a bug in a WHERE
// clause hands them someone else's robots and fails silently.
import { openStore } from "./store.mjs";
import { join } from "node:path";

/** Open stores are cached because opening a SQLite handle per request would
 * re-run the schema and re-negotiate WAL on every page view. The cap keeps a
 * pilot's worth of accounts resident without holding file descriptors for
 * every account that ever signed in. */
const DEFAULT_MAX_OPEN = 32;

export class TenantStores {
  /** @param root absolute path of the directory holding tenant databases. */
  constructor(root, { maxOpen = DEFAULT_MAX_OPEN, open = openStore } = {}) {
    this.root = root;
    this.maxOpen = maxOpen;
    this.open = open;
    /** Insertion order is the LRU order: re-reading a key deletes and reinserts
     * it, so the oldest entry is always the first the iterator yields. */
    this.cache = new Map();
  }

  /** Path for an account's database. Account ids are integers from SQLite's
   * AUTOINCREMENT, never user input, but this validates anyway: the one thing
   * that must never happen is a caller-influenced string reaching join() and
   * escaping the tenants directory. */
  pathFor(accountId) {
    if (!Number.isSafeInteger(accountId) || accountId <= 0) {
      throw new Error(`invalid account id: ${accountId}`);
    }
    return join(this.root, `${accountId}.db`);
  }

  /** The store for an account, opened on first use. The schema is created by
   * openStore, so a brand new account gets a valid empty fleet with no
   * migration step and no seeding. */
  get(accountId) {
    const key = this.pathFor(accountId);
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const store = this.open(key);
    this.cache.set(key, store);
    this.evict();
    return store;
  }

  /** Close least-recently-used handles down to the cap. Closing is safe because
   * every store operation is synchronous and complete before this can run;
   * a later request simply reopens the file. */
  evict() {
    while (this.cache.size > this.maxOpen) {
      const oldest = this.cache.keys().next().value;
      const store = this.cache.get(oldest);
      this.cache.delete(oldest);
      try {
        store.close();
      } catch {
        /* a handle we can no longer close is not worth failing a request over */
      }
    }
  }

  /** Drop one account's handle, forcing a reopen next time. Needed after any
   * out-of-band write to the file, such as a restore from backup. */
  forget(accountId) {
    const key = this.pathFor(accountId);
    const store = this.cache.get(key);
    if (!store) return false;
    this.cache.delete(key);
    try {
      store.close();
    } catch {
      /* ignore */
    }
    return true;
  }

  closeAll() {
    for (const store of this.cache.values()) {
      try {
        store.close();
      } catch {
        /* ignore */
      }
    }
    this.cache.clear();
  }

  get openCount() {
    return this.cache.size;
  }
}
