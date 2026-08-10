import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROVIDERS,
  createOAuthProviders,
  buildAuthorizeUrl,
  newState,
  validState,
  exchangeCode,
  fetchVerifiedEmail,
} from "../src/oauth.mjs";

test("createOAuthProviders returns only providers with both a client id and secret", () => {
  const none = createOAuthProviders({ secrets: {}, env: {} });
  assert.deepEqual(Object.keys(none), []);

  const halfConfigured = createOAuthProviders({
    secrets: { google: { client_id: "abc" } }, // no secret
    env: {},
  });
  assert.deepEqual(Object.keys(halfConfigured), [], "a client id alone must not enable the provider");

  const both = createOAuthProviders({
    secrets: { google: { client_id: "abc", client_secret: "shh" } },
    env: {},
  });
  assert.deepEqual(Object.keys(both), ["google"]);
  assert.equal(both.google.clientId, "abc");
  assert.equal(both.google.clientSecret, "shh");
});

test("env vars take precedence over secrets.local.json for oauth credentials", () => {
  const providers = createOAuthProviders({
    secrets: { google: { client_id: "from-file", client_secret: "from-file" } },
    env: { BOTLIEN_GOOGLE_CLIENT_ID: "from-env", BOTLIEN_GOOGLE_CLIENT_SECRET: "from-env" },
  });
  assert.equal(providers.google.clientId, "from-env");
});

test("buildAuthorizeUrl carries client id, redirect uri, scope and state", () => {
  const provider = { ...PROVIDERS.google, clientId: "cid" };
  const url = new URL(buildAuthorizeUrl(provider, { state: "st4te", baseUrl: "https://app.botlien.com" }));
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("client_id"), "cid");
  assert.equal(url.searchParams.get("redirect_uri"), "https://app.botlien.com/auth/google/callback");
  assert.equal(url.searchParams.get("state"), "st4te");
  assert.equal(url.searchParams.get("scope"), "openid email");
});

test("redirect uri strips a trailing slash on baseUrl so it never doubles", () => {
  const provider = { ...PROVIDERS.microsoft, clientId: "cid" };
  const url = new URL(buildAuthorizeUrl(provider, { state: "s", baseUrl: "https://app.botlien.com/" }));
  assert.equal(url.searchParams.get("redirect_uri"), "https://app.botlien.com/auth/microsoft/callback");
});

test("newState is prefixed with the provider id and is unique per call", () => {
  const a = newState("google");
  const b = newState("google");
  assert.match(a, /^google:/);
  assert.notEqual(a, b);
});

test("validState rejects a missing cookie, a missing query value, and a provider mismatch", () => {
  const state = newState("google");
  assert.equal(validState({ providerId: "google", cookieState: null, queryState: state }), false);
  assert.equal(validState({ providerId: "google", cookieState: state, queryState: null }), false);
  assert.equal(validState({ providerId: "microsoft", cookieState: state, queryState: state }), false, "a google state must not validate a microsoft callback");
});

test("validState accepts a genuine round trip and rejects a tampered one", () => {
  const state = newState("google");
  assert.equal(validState({ providerId: "google", cookieState: state, queryState: state }), true);
  assert.equal(validState({ providerId: "google", cookieState: state, queryState: state + "x" }), false);
});

test("exchangeCode posts the code and returns the access token on 2xx", async () => {
  const provider = { ...PROVIDERS.google, clientId: "cid", clientSecret: "sec" };
  let seenBody = null;
  const fetchImpl = async (url, opts) => {
    seenBody = opts.body.toString();
    return { ok: true, json: async () => ({ access_token: "tok123" }) };
  };
  const out = await exchangeCode(provider, { code: "abc", baseUrl: "https://app.botlien.com", fetchImpl });
  assert.deepEqual(out, { ok: true, accessToken: "tok123" });
  assert.match(seenBody, /client_secret=sec/);
  assert.match(seenBody, /code=abc/);
});

test("exchangeCode returns ok:false rather than throwing on a non-2xx", async () => {
  const provider = { ...PROVIDERS.google, clientId: "cid", clientSecret: "sec" };
  const fetchImpl = async () => ({ ok: false, status: 400, text: async () => "invalid_grant" });
  const out = await exchangeCode(provider, { code: "expired", baseUrl: "https://app.botlien.com", fetchImpl });
  assert.equal(out.ok, false);
  assert.match(out.error, /400/);
});

test("exchangeCode returns ok:false on a network error instead of throwing", async () => {
  const provider = { ...PROVIDERS.google, clientId: "cid", clientSecret: "sec" };
  const fetchImpl = async () => {
    throw new Error("getaddrinfo ENOTFOUND");
  };
  const out = await exchangeCode(provider, { code: "abc", baseUrl: "https://app.botlien.com", fetchImpl });
  assert.equal(out.ok, false);
  assert.match(out.error, /ENOTFOUND/);
});

test("fetchVerifiedEmail returns the email when present and verified", async () => {
  const provider = { ...PROVIDERS.google };
  const fetchImpl = async () => ({ ok: true, json: async () => ({ email: "sam@harborgrill.com", email_verified: true }) });
  const out = await fetchVerifiedEmail(provider, { accessToken: "tok", fetchImpl });
  assert.deepEqual(out, { ok: true, email: "sam@harborgrill.com" });
});

test("fetchVerifiedEmail rejects an explicitly unverified email", async () => {
  const provider = { ...PROVIDERS.google };
  const fetchImpl = async () => ({ ok: true, json: async () => ({ email: "sam@harborgrill.com", email_verified: false }) });
  const out = await fetchVerifiedEmail(provider, { accessToken: "tok", fetchImpl });
  assert.equal(out.ok, false);
  assert.match(out.error, /not verified/);
});

test("fetchVerifiedEmail accepts a provider that has no verification flag at all", async () => {
  // Microsoft's OIDC userinfo does not return email_verified.
  const provider = { ...PROVIDERS.microsoft };
  const fetchImpl = async () => ({ ok: true, json: async () => ({ email: "sam@harborgrill.com" }) });
  const out = await fetchVerifiedEmail(provider, { accessToken: "tok", fetchImpl });
  assert.deepEqual(out, { ok: true, email: "sam@harborgrill.com" });
});

test("fetchVerifiedEmail returns ok:false when there is no email field", async () => {
  const provider = { ...PROVIDERS.google };
  const fetchImpl = async () => ({ ok: true, json: async () => ({}) });
  const out = await fetchVerifiedEmail(provider, { accessToken: "tok", fetchImpl });
  assert.equal(out.ok, false);
  assert.match(out.error, /did not return an email/);
});
