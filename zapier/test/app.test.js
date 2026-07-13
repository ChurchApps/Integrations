const { test } = require("node:test");
const assert = require("node:assert");
const App = require("../index.js");

const bundle = { authData: { apiKey: "cak_abcd1234.secret" }, targetUrl: "https://hooks.zapier.com/hooks/catch/1/x" };
const fakeZ = (responses) => {
  const calls = [];
  return {
    calls,
    request: async (opts) => {
      const o = typeof opts === "string" ? { url: opts, method: "GET" } : opts;
      calls.push(o);
      return { data: responses[calls.length - 1] };
    }
  };
};

test("app surface matches the support docs", () => {
  assert.deepEqual(
    Object.keys(App.triggers).sort(),
    ["list_funds", "list_groups", "list_people", "new_donation", "new_form_submission", "new_group_member", "new_person", "updated_person"]
  );
  assert.deepEqual(Object.keys(App.creates).sort(), ["add_donation", "add_group_member", "create_person"]);
  assert.deepEqual(Object.keys(App.searches), ["find_person"]);
  for (const key of ["new_person", "updated_person", "new_donation", "new_group_member", "new_form_submission"]) {
    assert.equal(App.triggers[key].operation.type, "hook", key);
  }
});

test("subscribe registers the documented webhook and unsubscribe deletes it", async () => {
  const z = fakeZ([{ id: "wh1", secret: "s" }]);
  const sub = await App.triggers.new_donation.operation.performSubscribe(z, bundle);
  assert.equal(z.calls[0].method, "POST");
  assert.equal(z.calls[0].url, "https://api.churchapps.org/membership/webhooks");
  assert.deepEqual(z.calls[0].body, { name: "Zapier — donation.created", url: bundle.targetUrl, events: ["donation.created"] });
  assert.equal(sub.id, "wh1");

  const z2 = fakeZ([{}]);
  await App.triggers.new_donation.operation.performUnsubscribe(z2, { ...bundle, subscribeData: { id: "wh1" } });
  assert.equal(z2.calls[0].method, "DELETE");
  assert.equal(z2.calls[0].url, "https://api.churchapps.org/membership/webhooks/wh1");
});

test("perform unwraps the B1 envelope", () => {
  const envelope = { event: "person.created", churchId: "c1", occurredAt: "2026-01-01T00:00:00Z", data: { id: "p1", name: { first: "A" } } };
  const out = App.triggers.new_person.operation.perform(null, { cleanedRequest: envelope });
  assert.deepEqual(out, [{ id: "p1", name: { first: "A" } }]);
});

test("performList falls back to empty (→ static sample) when the key lacks a read scope", async () => {
  const z = { request: async () => { throw new Error("403"); } };
  const out = await App.triggers.new_person.operation.performList(z, bundle);
  assert.deepEqual(out, []);
});

test("add_donation writes the fund allocation when a fund is chosen", async () => {
  const z = fakeZ([[{ id: "d1", amount: 25 }], [{ id: "fd1" }]]);
  const out = await App.creates.add_donation.operation.perform(z, { ...bundle, inputData: { amount: 25, fundId: "f1", personId: "p1" } });
  assert.equal(z.calls[1].url, "https://api.churchapps.org/giving/funddonations");
  assert.deepEqual(z.calls[1].body, [{ donationId: "d1", fundId: "f1", amount: 25 }]);
  assert.equal(out.fundId, "f1");
});

test("find_person prefers email over name and respects a custom apiUrl", async () => {
  const z = fakeZ([[{ id: "p1" }]]);
  const b = { authData: { apiKey: "cak_x.y", apiUrl: "http://localhost:8084/" }, inputData: { email: "a@b.com", term: "ignored" } };
  await App.searches.find_person.operation.perform(z, b);
  assert.equal(z.calls[0].url, "http://localhost:8084/membership/people/search?email=a%40b.com");
});

test("find_person does an exact id lookup when personId is given", async () => {
  const z = fakeZ([{ id: "p9", name: { display: "X" } }]);
  const out = await App.searches.find_person.operation.perform(z, { ...bundle, inputData: { personId: "p9", email: "ignored@b.com" } });
  assert.equal(z.calls[0].url, "https://api.churchapps.org/membership/people/p9");
  assert.deepEqual(out, [{ id: "p9", name: { display: "X" } }]);
});
