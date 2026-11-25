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

// key, label, noun, event — one per event in the Api's WebhookEvents.ts.
const HOOKS = [
  ["new_person", "New Person", "Person", "person.created"],
  ["updated_person", "Updated Person", "Person", "person.updated"],
  ["deleted_person", "Deleted Person", "Person", "person.destroyed"],
  ["new_group", "New Group", "Group", "group.created"],
  ["updated_group", "Updated Group", "Group", "group.updated"],
  ["deleted_group", "Deleted Group", "Group", "group.destroyed"],
  ["new_group_member", "New Group Member", "Group Member", "group.member.added"],
  ["removed_group_member", "Removed Group Member", "Group Member", "group.member.removed"],
  ["new_group_join_request", "New Group Join Request", "Group Join Request", "group.member.requested"],
  ["new_household", "New Household", "Household", "household.created"],
  ["updated_household", "Updated Household", "Household", "household.updated"],
  ["deleted_household", "Deleted Household", "Household", "household.destroyed"],
  ["new_donation", "New Donation", "Donation", "donation.created"],
  ["updated_donation", "Updated Donation", "Donation", "donation.updated"],
  ["new_attendance_record", "New Attendance Record", "Attendance Record", "attendance.recorded"],
  ["new_attendance_checkout", "New Attendance Checkout", "Attendance Checkout", "attendance.checkout"],
  ["new_attendance_session", "New Attendance Session", "Attendance Session", "session.created"],
  ["new_form_submission", "New Form Submission", "Form Submission", "form.submission.created"],
  ["new_event", "New Event", "Event", "event.created"],
  ["updated_event", "Updated Event", "Event", "event.updated"],
  ["deleted_event", "Deleted Event", "Event", "event.destroyed"],
  ["new_registration", "New Registration", "Registration", "registration.created"],
  ["cancelled_registration", "Cancelled Registration", "Registration", "registration.cancelled"],
  ["new_list_member", "New List Member", "List Member", "list.member.added"],
  ["removed_list_member", "Removed List Member", "List Member", "list.member.removed"]
];
// Triggers whose test data comes from a REST list, and the scope that list needs (null = any key).
const LISTS = {
  new_person: ["/membership/people/recent", "people:read"],
  updated_person: ["/membership/people/recent", "people:read"],
  new_group: ["/membership/groups", null],
  updated_group: ["/membership/groups", null],
  new_group_member: ["/membership/groupmembers", "groups:read"],
  new_household: ["/membership/households", "people:read"],
  updated_household: ["/membership/households", "people:read"],
  new_donation: ["/giving/donations", "donations:read"],
  updated_donation: ["/giving/donations", "donations:read"],
  new_form_submission: ["/membership/formsubmissions", "forms:write"]
};

test("app surface matches the support docs", () => {
  assert.deepEqual(
    Object.keys(App.triggers).sort(),
    [...HOOKS.map(([key]) => key), "list_funds", "list_groups", "list_people"].sort()
  );
  assert.deepEqual(Object.keys(App.creates).sort(), ["add_donation", "add_group_member", "create_person", "find_person", "remove_group_member", "update_person"]);
  assert.deepEqual(Object.keys(App.searches).sort(), ["find_group", "find_person"]);
  assert.deepEqual(Object.keys(App.searchOrCreates), ["find_person"]);
});

test("there is one hook trigger per webhook event, following Zapier's publishing conventions", () => {
  assert.equal(new Set(HOOKS.map(([, , , event]) => event)).size, 25);
  for (const [key, label, noun] of HOOKS) {
    const trigger = App.triggers[key];
    assert.match(key, /^[a-z]+(_[a-z]+)*$/, key);
    assert.equal(trigger.key, key);
    assert.equal(trigger.noun, noun, key);
    assert.equal(trigger.display.label, label, key);
    assert.match(trigger.display.label, /^([A-Z][a-z]+)( [A-Z][a-z]+)*$/, key);
    assert.match(trigger.display.description, /^Triggers when .+ Requires the `settings:write` scope( \(plus `[a-z]+:[a-z]+` to test with real records\))?\.$/, key);
    assert.equal(trigger.operation.type, "hook", key);
  }
});

test("the five original triggers keep their keys and output fields", () => {
  const fields = (key) => Object.keys(App.triggers[key].operation.sample);
  assert.deepEqual(fields("new_person"), ["id", "churchId", "name", "contactInfo"]);
  assert.deepEqual(Object.keys(App.triggers.new_person.operation.sample.name), ["display", "first", "last"]);
  assert.deepEqual(Object.keys(App.triggers.new_person.operation.sample.contactInfo), ["email"]);
  assert.deepEqual(fields("updated_person"), fields("new_person"));
  assert.deepEqual(fields("new_donation"), ["id", "churchId", "personId", "personName", "donationDate", "amount", "status"]);
  assert.deepEqual(fields("new_group_member"), ["id", "churchId", "groupId", "groupName", "personId", "personName"]);
  assert.deepEqual(fields("new_form_submission"), ["id", "churchId", "formId", "formName", "contentType", "contentId", "personName"]);
});

test("every trigger subscribes to its own event and unsubscribes by webhook id", async () => {
  for (const [key, , , event] of HOOKS) {
    const z = fakeZ([{ id: "wh1", secret: "s" }]);
    const sub = await App.triggers[key].operation.performSubscribe(z, bundle);
    assert.equal(z.calls[0].method, "POST", key);
    assert.equal(z.calls[0].url, "https://api.churchapps.org/membership/webhooks", key);
    assert.deepEqual(z.calls[0].body, { name: `Zapier — ${event}`, url: bundle.targetUrl, events: [event] }, key);
    assert.equal(sub.id, "wh1", key);

    const z2 = fakeZ([{}]);
    await App.triggers[key].operation.performUnsubscribe(z2, { ...bundle, subscribeData: { id: "wh1" } });
    assert.equal(z2.calls[0].method, "DELETE", key);
    assert.equal(z2.calls[0].url, "https://api.churchapps.org/membership/webhooks/wh1", key);
  }
});

test("every trigger unwraps the B1 envelope", () => {
  for (const [key, , , event] of HOOKS) {
    const data = { ...App.triggers[key].operation.sample };
    const out = App.triggers[key].operation.perform(null, { cleanedRequest: { event, churchId: "c1", occurredAt: "2026-01-01T00:00:00Z", data } });
    assert.deepEqual(out, [data], key);
  }
});

test("every trigger has a sample with ISO dates and something that identifies the record", () => {
  const isoDate = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  for (const [key] of HOOKS) {
    const { sample, outputFields } = App.triggers[key].operation;
    const primary = (outputFields || []).filter((f) => f.primary).map((f) => f.key);
    for (const field of primary.length ? primary : ["id"]) assert.ok(sample[field], `${key}.${field}`);
    for (const [field, value] of Object.entries(sample)) {
      if (/(Date|Time)$/.test(field) || field === "start" || field === "end") assert.match(value, isoDate, `${key}.${field}`);
    }
  }
  assert.deepEqual(App.triggers.new_list_member.operation.outputFields.filter((f) => f.primary).map((f) => f.key), ["listId", "personId"]);
});

test("triggers with a list endpoint poll it for test data, projected to the sample's keys", async () => {
  for (const [key, [url]] of Object.entries(LISTS)) {
    const { sample, performList } = App.triggers[key].operation;
    const row = { ...sample, id: "live1", notInTheHookPayload: true };
    const z = fakeZ([[row, { noId: true }]]);
    const out = await performList(z, bundle);
    assert.equal(z.calls[0].url, `https://api.churchapps.org${url}`, key);
    assert.deepEqual(out, [{ ...sample, id: "live1" }], key);
  }
});

test("trigger descriptions name the scope their list endpoint needs", () => {
  for (const [key] of HOOKS) {
    const scope = (LISTS[key] || [])[1];
    const mentioned = (App.triggers[key].display.description.match(/plus `([a-z]+:[a-z]+)`/) || [])[1];
    assert.equal(mentioned, scope || undefined, key);
  }
});

test("triggers without a list endpoint serve their static sample as test data", async () => {
  const z = { request: async () => { throw new Error("should not call the API"); } };
  for (const [key] of HOOKS.filter(([k]) => !LISTS[k])) {
    const { sample, performList } = App.triggers[key].operation;
    assert.deepEqual(await performList(z, bundle), [sample], key);
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

test("performList projects rows down to the sample's keys", async () => {
  const row = { id: "d1", churchId: "c1", amount: 10, currency: "USD", notes: "n", transactionId: "t1", methodDetails: "x", donationDate: "2026-01-02T00:00:00Z" };
  const z = fakeZ([[row]]);
  const [out] = await App.triggers.new_donation.operation.performList(z, bundle);
  assert.deepEqual(out, { id: "d1", churchId: "c1", amount: 10, donationDate: "2026-01-02T00:00:00Z" });
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

const fullPerson = () => ({
  id: "p1",
  churchId: "c1",
  name: { display: "Old Name", first: "Old", last: "Name", middle: null, nick: null, prefix: null, suffix: null },
  contactInfo: { email: "old@b.com", mobilePhone: "555-0100", homePhone: "555-0199", address1: "1 Main St" },
  birthDate: "1990-06-15T00:00:00.000Z",
  householdId: "h1",
  membershipStatus: "Visitor",
  formSubmissions: [{ id: "fs1" }]
});

test("update_person sends the whole record back with only the given fields changed", async () => {
  const z = fakeZ([fullPerson(), [{ id: "p1", name: { display: "New Name" } }]]);
  z.errors = { Error: class extends Error {} };
  const inputData = { personId: "p1", firstName: "New", lastName: "", email: "new@b.com", mobilePhone: "", membershipStatus: "Member" };
  const out = await App.creates.update_person.operation.perform(z, { ...bundle, inputData });
  assert.equal(z.calls[0].url, "https://api.churchapps.org/membership/people/p1");
  assert.equal(z.calls[1].method, "POST");
  assert.equal(z.calls[1].url, "https://api.churchapps.org/membership/people");
  const { formSubmissions, ...unchanged } = fullPerson();
  assert.deepEqual(z.calls[1].body, [{
    ...unchanged,
    membershipStatus: "Member",
    name: { ...unchanged.name, first: "New" },
    contactInfo: { ...unchanged.contactInfo, email: "new@b.com" }
  }]);
  assert.deepEqual(out, { id: "p1", name: { display: "New Name" } });
});

test("update_person never sends a null first or last name, which the Api would write into the display name", async () => {
  const person = { ...fullPerson(), name: { display: "Cher", first: "Cher", last: null } };
  const z = fakeZ([person, [person]]);
  z.errors = { Error: class extends Error {} };
  await App.creates.update_person.operation.perform(z, { ...bundle, inputData: { personId: "p1", email: "cher@b.com" } });
  assert.deepEqual(z.calls[1].body[0].name, { display: "Cher", first: "Cher", last: "" });
});

test("update_person fails the task, without saving, when the person is missing or only partly readable", async () => {
  const perform = App.creates.update_person.operation.perform;
  const missing = fakeZ([null]);
  missing.errors = { Error: class extends Error {} };
  await assert.rejects(perform(missing, { ...bundle, inputData: { personId: "nope", firstName: "New" } }), /No person found with id "nope"/);
  assert.equal(missing.calls.length, 1);

  const limited = fakeZ([{ id: "p1", name: { display: "Old Name" }, contactInfo: {} }]);
  limited.errors = { Error: class extends Error {} };
  await assert.rejects(perform(limited, { ...bundle, inputData: { personId: "p1", firstName: "New" } }), /can't read the full person record/);
  assert.equal(limited.calls.length, 1);
});

test("remove_group_member looks up the membership and deletes it", async () => {
  const memberships = [
    { id: "gm1", churchId: "c1", groupId: "g1", personId: "p1", leader: false, group: { id: "g1", name: "One" } },
    { id: "gm2", churchId: "c1", groupId: "g2", personId: "p1", leader: false, group: { id: "g2", name: "Two" } }
  ];
  const z = fakeZ([memberships, {}]);
  z.errors = { Error: class extends Error {} };
  const out = await App.creates.remove_group_member.operation.perform(z, { ...bundle, inputData: { groupId: "g2", personId: "p1" } });
  assert.equal(z.calls[0].url, "https://api.churchapps.org/membership/groupmembers?personId=p1");
  assert.equal(z.calls[1].method, "DELETE");
  assert.equal(z.calls[1].url, "https://api.churchapps.org/membership/groupmembers/gm2");
  assert.deepEqual(out, { id: "gm2", churchId: "c1", groupId: "g2", personId: "p1" });
  assert.deepEqual(Object.keys(out), Object.keys(App.creates.remove_group_member.operation.sample));
});

test("remove_group_member fails the task, without deleting, when the person is not in the group", async () => {
  const z = fakeZ([[{ id: "gm1", churchId: "c1", groupId: "g1", personId: "p1" }]]);
  z.errors = { Error: class extends Error {} };
  await assert.rejects(
    App.creates.remove_group_member.operation.perform(z, { ...bundle, inputData: { groupId: "g2", personId: "p1" } }),
    /not a member/
  );
  assert.equal(z.calls.length, 1);
});

test("find_person prefers email over name and respects a custom apiUrl", async () => {
  const z = fakeZ([[{ id: "p1", contactInfo: { email: "a@b.com" } }]]);
  z.errors = { Error: class extends Error {} };
  const b = { authData: { apiKey: "cak_x.y", apiUrl: "http://localhost:8084/" }, inputData: { email: "a@b.com", term: "ignored" } };
  const out = await App.creates.find_person.operation.perform(z, b);
  assert.equal(z.calls[0].url, "http://localhost:8084/membership/people/search?email=a%40b.com");
  assert.deepEqual(out, { id: "p1", contactInfo: { email: "a@b.com" } });
});

test("find_person fails the task rather than return a partial email match or the first person for a blank lookup", async () => {
  const z = fakeZ([[{ id: "p2", contactInfo: { email: "joann@example.com" } }]]);
  z.errors = { Error: class extends Error {} };
  const perform = App.creates.find_person.operation.perform;
  await assert.rejects(perform(z, { ...bundle, inputData: { email: "ann@example.com" } }), /No person found matching email "ann@example.com"/);
  await assert.rejects(perform(z, { ...bundle, inputData: { email: "", term: "" } }), /No person found/);
  assert.equal(z.calls.length, 1);
});

test("find_person does an exact id lookup when personId is given", async () => {
  const z = fakeZ([{ id: "p9", name: { display: "X" } }]);
  z.errors = { Error: class extends Error {} };
  const out = await App.creates.find_person.operation.perform(z, { ...bundle, inputData: { personId: "p9", email: "ignored@b.com" } });
  assert.equal(z.calls[0].url, "https://api.churchapps.org/membership/people/p9");
  assert.deepEqual(out, { id: "p9", name: { display: "X" } });
});

test("find_person fails the task when nobody matches", async () => {
  const z = fakeZ([[]]);
  z.errors = { Error: class extends Error {} };
  await assert.rejects(
    App.creates.find_person.operation.perform(z, { ...bundle, inputData: { email: "nobody@b.com" } }),
    /No person found/
  );
});

test("searches follow Zapier's conventions and Find or Create Person pairs a real search with a real create", () => {
  for (const [key, search] of Object.entries(App.searches)) {
    assert.equal(search.key, key);
    assert.ok(search.noun, key);
    assert.match(search.display.label, /^Find [A-Z][a-z]+$/, key);
    assert.match(search.display.description, /^Finds .+ scope\.$/, key);
    assert.ok(search.operation.sample.id, key);
  }
  const pair = App.searchOrCreates.find_person;
  assert.equal(pair.key, "find_person");
  assert.equal(pair.display.label, "Find or Create Person");
  assert.match(pair.display.description, /`people:write` scope\.$/);
  assert.ok(App.searches[pair.key]);
  assert.ok(App.searches[pair.search]);
  assert.ok(App.creates[pair.create]);
});

test("find_person search returns the person for an id, and nothing when the id is unknown", async () => {
  const z = fakeZ([{ id: "p9", name: { display: "X" } }, null]);
  const perform = App.searches.find_person.operation.perform;
  assert.deepEqual(await perform(z, { ...bundle, inputData: { personId: "p9", email: "ignored@b.com" } }), [{ id: "p9", name: { display: "X" } }]);
  assert.equal(z.calls[0].url, "https://api.churchapps.org/membership/people/p9");
  assert.deepEqual(await perform(z, { ...bundle, inputData: { personId: "nope" } }), []);
});

test("find_person search keeps exact email matches only, so Find or Create never reuses a near match", async () => {
  const ann = { id: "p1", contactInfo: { email: "Ann@Example.com" } };
  const joann = { id: "p2", contactInfo: { email: "joann@example.com" } };
  const z = fakeZ([[joann, ann], [joann]]);
  const perform = App.searches.find_person.operation.perform;
  assert.deepEqual(await perform(z, { ...bundle, inputData: { email: " ann@example.com ", term: "ignored" } }), [ann]);
  assert.equal(z.calls[0].url, "https://api.churchapps.org/membership/people/search?email=ann%40example.com");
  assert.deepEqual(await perform(z, { ...bundle, inputData: { email: "ann@example.com" } }), []);
});

test("find_person search by name returns every match, and a blank lookup finds nobody without calling the API", async () => {
  const z = fakeZ([[{ id: "p1" }, { id: "p2" }]]);
  const perform = App.searches.find_person.operation.perform;
  assert.deepEqual(await perform(z, { ...bundle, inputData: { term: "Sam Smith" } }), [{ id: "p1" }, { id: "p2" }]);
  assert.equal(z.calls[0].url, "https://api.churchapps.org/membership/people/search?term=Sam%20Smith");
  assert.deepEqual(await perform(z, { ...bundle, inputData: { personId: "", email: " ", term: "" } }), []);
  assert.equal(z.calls.length, 1);
});

test("find_group matches the exact name, ignoring case, and skips partial matches", async () => {
  const groups = [{ id: "g1", name: "Youth Leaders" }, { id: "g2", name: "Youth" }, { id: "g3", name: null }];
  const z = fakeZ([groups, groups]);
  const perform = App.searches.find_group.operation.perform;
  assert.deepEqual(await perform(z, { ...bundle, inputData: { name: " youth " } }), [{ id: "g2", name: "Youth" }]);
  assert.equal(z.calls[0].url, "https://api.churchapps.org/membership/groups");
  assert.deepEqual(await perform(z, { ...bundle, inputData: { name: "Yout" } }), []);
  assert.deepEqual(await perform(z, { ...bundle, inputData: { name: "" } }), []);
  assert.equal(z.calls.length, 2);
});
