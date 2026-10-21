import assert from "node:assert/strict";
import test from "node:test";
import { computeQuote, confirmLicense, computeSplits } from "../skills/mermail-licensing-desk/scripts/quote.mjs";

const card = () => ({
  owner: "Example creator", version: "v1", currency: "USDC",
  items: { work: { title: "Example work", base: 1800, floor: 100, uses: ["sync"], exclusive_available: false } },
  multipliers: { media: { web: 1 }, territory: { us: 1 }, term: { "1y": 1 }, exclusivity: { non_exclusive: 1 } },
});
const request = { item: "work", use: "sync", media: "web", territory: "us", term: "1y", exclusivity: "non_exclusive", audience: 1 };
const payment = { paid: "1800.00", currency: "USDC", paymentRef: "owner-confirmed-example" };
const sheet = { chain: "base", asset: "USDC", decimals: 6, collaborators: [{ name: "Example", address: `0x${"1".repeat(40)}`, share_bps: 2500 }] };

test("confirmation binds price, currency, quote identity and unchanged hashed content", () => {
  const quote = computeQuote(card(), request);
  const confirmed = confirmLicense(quote, payment);
  assert.equal(confirmed.status, "licensed");
  assert.equal(confirmed.paid, "1800.00");
  assert.equal(confirmed.currency, "USDC");
  assert.deepEqual(confirmed.terms, quote.terms);
  assert.throws(() => confirmLicense({ ...quote, price: "0.01" }, { ...payment, paid: "0.01" }), /terms/);
  for (const changed of [{ ...quote, price: undefined }, { ...quote, currency: "USD" }, { ...quote, quote_id: "Q-other" }, { ...quote, terms: { ...quote.terms, territory: "worldwide" } }]) {
    assert.throws(() => confirmLicense(changed, payment));
  }
  assert.throws(() => confirmLicense(quote, { ...payment, currency: "USD" }), /currency/);
  assert.throws(() => confirmLicense(quote, { ...payment, currency: undefined }), /currency/);
  assert.throws(() => confirmLicense(quote, { ...payment, paid: "1799.99" }), /below/);
  assert.equal(confirmLicense(quote, { ...payment, paid: "1800.01" }).paid, "1800.01");
});

test("payment and split amounts reject malformed, signed, exponent, numeric and excess-precision input", () => {
  const quote = computeQuote(card(), request);
  for (const paid of ["10.0.99", "-1", "+1", "1e3", "Infinity", "NaN", " 1800", "1800.", ".01", "01", "0", 1800, "1800.001", "1".repeat(65)]) {
    assert.throws(() => confirmLicense(quote, { ...payment, paid }));
  }
  for (const amount of ["10.0.99", "-1", "+1", "1e3", "NaN", "Infinity", " 10", "10.", ".01", "01", "0", 10, "0.0000001", "1".repeat(65)]) {
    assert.throws(() => computeSplits(sheet, amount));
  }
  for (const decimals of [-1, 19, 6.5, Infinity, "6"]) assert.throws(() => computeSplits({ ...sheet, decimals }, "10"));
});

test("split arithmetic preserves exact units, zero-decimal assets and owner rounding remainder", () => {
  const result = computeSplits(sheet, "10.000001");
  assert.equal(result.payouts[0].amount_decimal, "2.5");
  assert.equal(result.owner_retains, "7.500001");
  const integer = computeSplits({ ...sheet, decimals: 0 }, "10");
  assert.equal(integer.payouts[0].amount_decimal, "2");
  assert.equal(integer.owner_retains, "8");
  const huge = computeSplits(sheet, "9007199254740993");
  assert.equal(huge.payouts[0].amount_decimal, "2251799813685248.25");
  assert.equal(huge.owner_retains, "6755399441055744.75");
});

test("pricing rounds exact decimal multipliers half up, respects floor and rejects overflow", () => {
  const rate = card(); rate.items.work.base = 1.25; rate.items.work.floor = 0;
  rate.multipliers.media.web = 1.14;
  assert.equal(computeQuote(rate, request).price, "1.43");
  rate.items.work.floor = 2;
  assert.equal(computeQuote(rate, request).price, "2.00");
  for (const value of [Infinity, NaN, 1e20, 1.005]) {
    const invalid = card(); invalid.items.work.base = value;
    assert.throws(() => computeQuote(invalid, request));
  }
  const overflow = card(); overflow.multipliers.media.web = 1e14;
  assert.throws(() => computeQuote(overflow, request), /range/);
  for (const factor of [Infinity, NaN, -1, 0]) {
    const invalid = card(); invalid.multipliers.audience = [{ max: null, factor }];
    assert.throws(() => computeQuote(invalid, request));
  }
});

test("conflicting or unavailable terms cannot produce a quote", () => {
  assert.throws(() => computeQuote(card(), { ...request, use: "merch" }));
  assert.throws(() => computeQuote(card(), { ...request, exclusivity: "exclusive" }));
  assert.throws(() => computeQuote(card(), { ...request, term: ["1y", "3y"] }));
  assert.throws(() => computeQuote(card(), { ...request, audience: Number.MAX_SAFE_INTEGER + 1 }));
  const unavailable = card(); unavailable.multipliers.media.web = null;
  assert.throws(() => computeQuote(unavailable, request));
});
