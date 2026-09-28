// Encryption for customers' vendor credentials. A Gausium client secret in
// our database is the key to someone else's fleet, so it is never stored or
// logged in the clear: AES-256-GCM, a fresh 12-byte IV per value, the auth
// tag checked on every read so a tampered row fails loudly instead of
// decrypting to garbage.
//
// The key comes from BOTLIEN_SECRET_KEY (32 bytes, base64), set as a Fly
// secret so it never sits on the same volume as the data it protects. In
// production the vault refuses to work without it. On a laptop it falls back
// to a key file beside the databases, created once with owner-only access,
// so development and tests need no setup.
import { createHmac, timingSafeEqual, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const VERSION = "v1";

export class VaultError extends Error {}

export function createVault({ keyB64 = process.env.BOTLIEN_SECRET_KEY ?? null, production = process.env.BOTLIEN_SECURE_COOKIES === "1", devKeyPath = null } = {}) {
  let key = null;
  if (keyB64) {
    key = Buffer.from(keyB64, "base64");
    if (key.length !== 32) throw new VaultError("BOTLIEN_SECRET_KEY must be 32 bytes, base64 encoded");
  } else if (!production && devKeyPath) {
    if (existsSync(devKeyPath)) {
      key = Buffer.from(readFileSync(devKeyPath, "utf8").trim(), "base64");
    } else {
      key = randomBytes(32);
      mkdirSync(dirname(devKeyPath), { recursive: true });
      writeFileSync(devKeyPath, key.toString("base64"), { mode: 0o600 });
    }
  }

  function need() {
    if (!key) throw new VaultError("credential storage is off: set BOTLIEN_SECRET_KEY");
    return key;
  }

  return {
    ready: key !== null,

    /** A signature for a link the server must later trust (an unsubscribe
     *  link), keyed to this server's secret and to what the link is for. */
    sign(purpose, message) {
      return createHmac("sha256", need()).update(`${purpose}\0${message}`).digest("base64url");
    },

    verify(purpose, message, signature) {
      if (!key || typeof signature !== "string") return false;
      const want = Buffer.from(this.sign(purpose, message));
      const got = Buffer.from(signature);
      return want.length === got.length && timingSafeEqual(want, got);
    },

    /** Object in, one opaque string out: v1.<iv>.<tag>.<ciphertext>. */
    seal(obj) {
      const iv = randomBytes(12);
      const c = createCipheriv("aes-256-gcm", need(), iv);
      const body = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
      return [VERSION, iv.toString("base64"), c.getAuthTag().toString("base64"), body.toString("base64")].join(".");
    },

    open(sealed) {
      const [v, iv, tag, body] = String(sealed).split(".");
      if (v !== VERSION || !iv || !tag || !body) throw new VaultError("not a sealed credential");
      const d = createDecipheriv("aes-256-gcm", need(), Buffer.from(iv, "base64"));
      d.setAuthTag(Buffer.from(tag, "base64"));
      try {
        return JSON.parse(Buffer.concat([d.update(Buffer.from(body, "base64")), d.final()]).toString("utf8"));
      } catch {
        throw new VaultError("credential failed its integrity check");
      }
    },
  };
}
