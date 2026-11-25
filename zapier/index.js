const { version } = require("./package.json");
// Must exactly match the zapier-platform-core version in package.json.
const platformVersion = "19.0.0";

const base = (bundle) => (bundle.authData.apiUrl || "https://api.churchapps.org").replace(/\/+$/, "");

const addAuth = (request, z, bundle) => {
  if (bundle.authData.apiKey) request.headers.Authorization = `Bearer ${bundle.authData.apiKey}`;
  return request;
};

const authentication = {
  type: "custom",
  fields: [
    {
      key: "apiKey",
      label: "API Key",
      type: "password",
      required: true,
      helpText: "Create one in B1Admin under **Settings → Developer → API Keys** ([instructions](https://support.churchapps.org/docs/developer/api/api-keys)). Include the `settings:write` scope if any of your Zaps use a B1 trigger, plus the scopes your actions need (e.g. `people:write`, `donations:write`)."
    },
    {
      key: "apiUrl",
      label: "API URL",
      type: "string",
      required: false,
      helpText: "Leave blank for hosted B1 (`https://api.churchapps.org`). Only set this for a self-hosted installation."
    }
  ],
  // Triggers need settings:write anyway, so validating against the webhook
  // catalog both proves the key works and catches the most common bad key early.
  test: async (z, bundle) => {
    const apiUrl = (bundle.authData.apiUrl || "").trim();
    if (apiUrl && !/^https?:\/\/[^/\s]+\.[^/\s]+/.test(apiUrl)) {
      throw new z.errors.Error("API URL must be a full URL starting with https:// (e.g. https://api.example.com), or left blank for hosted B1.", "InvalidApiUrl");
    }
    const res = await z.request(`${base(bundle)}/membership/webhooks/events`);
    return { connected: true, eventCount: res.data.all ? res.data.all.length : 0 };
  },
  connectionLabel: (z, bundle) => `B1.church (${(bundle.authData.apiKey || "").split(".")[0]}…)`
};

const SAMPLES = {
  person: { id: "smpl_person", churchId: "smpl_church", name: { display: "Sample Person", first: "Sample", last: "Person" }, contactInfo: { email: "sample@example.com" } },
  // ponytail: sample keys must be a subset of every delivered payload (Zapier T004) — batchId/method/currency vary by entry path, so they stay out.
  donation: { id: "smpl_donation", churchId: "smpl_church", personId: "smpl_person", personName: "Sample Person", donationDate: "2026-01-15T00:00:00.000Z", amount: 50, status: "complete" },
  groupMember: { id: "smpl_groupmember", churchId: "smpl_church", groupId: "smpl_group", groupName: "Sample Group", personId: "smpl_person", personName: "Sample Person" },
  formSubmission: { id: "smpl_formsubmission", churchId: "smpl_church", formId: "smpl_form", formName: "Sample Form", contentType: "person", contentId: "smpl_person", personName: "Sample Person" },
  // The samples below hold only what the Api emits: the emit() payload plus the names and email WebhookDispatcher adds.
  deletedPerson: { id: "smpl_person", churchId: "smpl_church", email: "sample@example.com" },
  group: { id: "smpl_group", churchId: "smpl_church", name: "Sample Group", categoryName: "Sample Category" },
  joinRequest: { id: "smpl_joinrequest", churchId: "smpl_church", groupId: "smpl_group", groupName: "Sample Group", personId: "smpl_person", personName: "Sample Person", personEmail: "sample@example.com", status: "pending" },
  household: { id: "smpl_household", churchId: "smpl_church", name: "Sample Household" },
  attendance: { id: "smpl_visit", churchId: "smpl_church", personId: "smpl_person", personName: "Sample Person", personEmail: "sample@example.com", visitDate: "2026-01-18T00:00:00.000Z", checkinTime: "2026-01-18T15:00:00.000Z" },
  // Checkout payloads are visit rows read back from the database, which carry no churchId.
  checkout: { id: "smpl_visit", personId: "smpl_person", personName: "Sample Person", personEmail: "sample@example.com", visitDate: "2026-01-18T00:00:00.000Z", checkinTime: "2026-01-18T15:00:00.000Z", checkoutTime: "2026-01-18T16:30:00.000Z", checkedOutBy: "Sample Parent" },
  session: { id: "smpl_session", churchId: "smpl_church", groupId: "smpl_group", groupName: "Sample Group", sessionDate: "2026-01-18T00:00:00.000Z" },
  event: { id: "smpl_event", churchId: "smpl_church", groupId: "smpl_group", title: "Sample Event", start: "2026-01-18T15:00:00.000Z", end: "2026-01-18T16:00:00.000Z" },
  registration: { id: "smpl_registration", churchId: "smpl_church", eventId: "smpl_event", personId: "smpl_person", status: "confirmed", registeredDate: "2026-01-15T00:00:00.000Z", totalAmount: 25, amountPaid: 25, members: [{ id: "smpl_registrationmember", registrationId: "smpl_registration", personId: "smpl_person", firstName: "Sample", lastName: "Person" }] },
  // List payloads have no id or churchId of their own.
  listMember: { listId: "smpl_list", listName: "Sample List", personId: "smpl_person", personName: "Sample Person", personEmail: "sample@example.com" }
};

const deleted = (id) => ({ id, churchId: "smpl_church" });

// Hook payloads only contain the fields that were set when the record was saved,
// while the REST list endpoints return full DB rows. Zapier flags sample fields
// that never appear in real task history, so polling rows are projected down to
// the sample's keys.
const pick = (keys) => (row) => Object.fromEntries(keys.filter((k) => row[k] !== undefined).map((k) => [k, row[k]]));

// Subscribing always needs settings:write; listScope is what listUrl needs to return live test data.
const hookTrigger = ({ key, noun, label, description, event, listUrl, listScope, listTransform, sample, outputFields }) => ({
  key,
  noun,
  display: { label, description: `${description} Requires the \`settings:write\` scope${listScope ? ` (plus \`${listScope}\` to test with real records)` : ""}.` },
  operation: {
    type: "hook",
    performSubscribe: async (z, bundle) => {
      const res = await z.request({
        method: "POST",
        url: `${base(bundle)}/membership/webhooks`,
        body: { name: `Zapier — ${event}`, url: bundle.targetUrl, events: [event] }
      });
      return res.data;
    },
    performUnsubscribe: async (z, bundle) => {
      await z.request({ method: "DELETE", url: `${base(bundle)}/membership/webhooks/${bundle.subscribeData.id}` });
      return { id: bundle.subscribeData.id };
    },
    perform: (z, bundle) => [bundle.cleanedRequest.data],
    performList: async (z, bundle) => {
      // Public hook triggers must have a performList; events with no list endpoint serve the static sample.
      if (!listUrl) return [sample];
      try {
        const res = await z.request(`${base(bundle)}${listUrl}`);
        const rows = Array.isArray(res.data) ? res.data : [];
        return (listTransform ? listTransform(rows) : rows)
          .filter((r) => r && r.id)
          .slice(0, 10)
          .map(pick(Object.keys(sample)));
      } catch (e) {
        return []; // key may lack a read scope — Zapier falls back to the static sample
      }
    },
    ...(outputFields && { outputFields }),
    sample
  }
});

const byDateDesc = (field) => (rows) => [...rows].sort((a, b) => new Date(b[field] || 0) - new Date(a[field] || 0));

// With no id in the payload, Zapier needs to be told what identifies a list member.
const LIST_MEMBER_KEY = [
  { key: "listId", label: "List ID", primary: true },
  { key: "personId", label: "Person ID", primary: true }
];

// One row per webhook event (Api: src/shared/webhooks/WebhookEvents.ts), in that file's order.
// listUrl is set only where a REST list returns rows shaped like the hook payload.
const TRIGGERS = [
  { key: "new_person", noun: "Person", label: "New Person", event: "person.created", description: "Triggers when a person is added in B1.", listUrl: "/membership/people/recent", listScope: "people:read", sample: SAMPLES.person },
  { key: "updated_person", noun: "Person", label: "Updated Person", event: "person.updated", description: "Triggers when a person record is changed in B1.", listUrl: "/membership/people/recent", listScope: "people:read", sample: SAMPLES.person },
  { key: "deleted_person", noun: "Person", label: "Deleted Person", event: "person.destroyed", description: "Triggers when a person is deleted or anonymized in B1.", sample: SAMPLES.deletedPerson },

  { key: "new_group", noun: "Group", label: "New Group", event: "group.created", description: "Triggers when a group is created in B1.", listUrl: "/membership/groups", sample: SAMPLES.group },
  { key: "updated_group", noun: "Group", label: "Updated Group", event: "group.updated", description: "Triggers when a group's settings are changed in B1.", listUrl: "/membership/groups", sample: SAMPLES.group },
  { key: "deleted_group", noun: "Group", label: "Deleted Group", event: "group.destroyed", description: "Triggers when a group is deleted in B1.", sample: deleted("smpl_group") },

  { key: "new_group_member", noun: "Group Member", label: "New Group Member", event: "group.member.added", description: "Triggers when a person is added to a group in B1.", listUrl: "/membership/groupmembers", listScope: "groups:read", sample: SAMPLES.groupMember },
  { key: "removed_group_member", noun: "Group Member", label: "Removed Group Member", event: "group.member.removed", description: "Triggers when a person is removed from a group in B1.", sample: { ...SAMPLES.groupMember, personEmail: "sample@example.com" } },
  { key: "new_group_join_request", noun: "Group Join Request", label: "New Group Join Request", event: "group.member.requested", description: "Triggers when a person asks to join a group that needs approval in B1.", sample: SAMPLES.joinRequest },

  { key: "new_household", noun: "Household", label: "New Household", event: "household.created", description: "Triggers when a household is created in B1.", listUrl: "/membership/households", listScope: "people:read", sample: SAMPLES.household },
  { key: "updated_household", noun: "Household", label: "Updated Household", event: "household.updated", description: "Triggers when a household is edited in B1.", listUrl: "/membership/households", listScope: "people:read", sample: SAMPLES.household },
  { key: "deleted_household", noun: "Household", label: "Deleted Household", event: "household.destroyed", description: "Triggers when a household is deleted in B1.", sample: deleted("smpl_household") },

  { key: "new_donation", noun: "Donation", label: "New Donation", event: "donation.created", description: "Triggers when a gift is recorded in B1 — manual entry, online, or the pending → complete transition.", listUrl: "/giving/donations", listScope: "donations:read", listTransform: byDateDesc("donationDate"), sample: SAMPLES.donation },
  { key: "updated_donation", noun: "Donation", label: "Updated Donation", event: "donation.updated", description: "Triggers when an existing donation is edited in B1.", listUrl: "/giving/donations", listScope: "donations:read", listTransform: byDateDesc("donationDate"), sample: { ...SAMPLES.donation, personEmail: "sample@example.com" } },

  { key: "new_attendance_record", noun: "Attendance Record", label: "New Attendance Record", event: "attendance.recorded", description: "Triggers when a person's attendance is recorded in B1, by check-in or by marking them present.", sample: SAMPLES.attendance },
  { key: "new_attendance_checkout", noun: "Attendance Checkout", label: "New Attendance Checkout", event: "attendance.checkout", description: "Triggers when a person is checked out of a service or class in B1.", sample: SAMPLES.checkout },

  { key: "new_attendance_session", noun: "Attendance Session", label: "New Attendance Session", event: "session.created", description: "Triggers when an attendance session (a group or service meeting on a date) is created in B1.", sample: SAMPLES.session },

  { key: "new_form_submission", noun: "Form Submission", label: "New Form Submission", event: "form.submission.created", description: "Triggers when a form is submitted in B1.", listUrl: "/membership/formsubmissions", listScope: "forms:write", sample: SAMPLES.formSubmission },

  { key: "new_event", noun: "Event", label: "New Event", event: "event.created", description: "Triggers when a calendar event is created in B1.", sample: SAMPLES.event },
  { key: "updated_event", noun: "Event", label: "Updated Event", event: "event.updated", description: "Triggers when a calendar event is changed in B1.", sample: SAMPLES.event },
  { key: "deleted_event", noun: "Event", label: "Deleted Event", event: "event.destroyed", description: "Triggers when a calendar event is deleted in B1.", sample: deleted("smpl_event") },

  { key: "new_registration", noun: "Registration", label: "New Registration", event: "registration.created", description: "Triggers when someone registers for an event in B1.", sample: SAMPLES.registration },
  { key: "cancelled_registration", noun: "Registration", label: "Cancelled Registration", event: "registration.cancelled", description: "Triggers when an event registration is cancelled in B1.", sample: { ...SAMPLES.registration, status: "cancelled", cancelledDate: "2026-01-16T00:00:00.000Z" } },

  { key: "new_list_member", noun: "List Member", label: "New List Member", event: "list.member.added", description: "Triggers when the nightly refresh adds a person to an auto-refreshing list in B1.", outputFields: LIST_MEMBER_KEY, sample: SAMPLES.listMember },
  { key: "removed_list_member", noun: "List Member", label: "Removed List Member", event: "list.member.removed", description: "Triggers when the nightly refresh removes a person from an auto-refreshing list in B1.", outputFields: LIST_MEMBER_KEY, sample: SAMPLES.listMember }
];

const triggers = {
  ...Object.fromEntries(TRIGGERS.map((t) => [t.key, hookTrigger(t)])),

  // Hidden polling triggers that power dynamic dropdowns.
  list_groups: {
    key: "list_groups",
    noun: "Group",
    display: { label: "List Groups", description: "Powers the group dropdown.", hidden: true },
    operation: {
      perform: async (z, bundle) => (await z.request(`${base(bundle)}/membership/groups`)).data,
      sample: { id: "smpl_group", name: "Sample Group" }
    }
  },
  list_funds: {
    key: "list_funds",
    noun: "Fund",
    display: { label: "List Funds", description: "Powers the fund dropdown.", hidden: true },
    operation: {
      perform: async (z, bundle) => (await z.request(`${base(bundle)}/giving/funds`)).data,
      sample: { id: "smpl_fund", name: "General Fund" }
    }
  },
  list_people: {
    key: "list_people",
    noun: "Person",
    display: { label: "List People", description: "Powers the person dropdown.", hidden: true },
    operation: {
      perform: async (z, bundle) => (await z.request(`${base(bundle)}/membership/people/recent`)).data,
      sample: SAMPLES.person
    }
  }
};

// An action rather than a search: searches can't be a Zap's last step, which
// makes them untestable on free (2-step) plans. No match = explicit task error.
const findPerson = {
  key: "find_person",
  noun: "Person",
  display: { label: "Find Person", description: "Looks up a person by id, email, or name. Fails the task if nobody matches. Requires the `people:read` scope." },
  operation: {
    inputFields: [
      { key: "personId", label: "Person", dynamic: "list_people.id.name__display", helpText: "Exact id lookup — pick a person or map a trigger's `personId` field. Takes precedence over email and name." },
      { key: "email", label: "Email", helpText: "Exact email match. Takes precedence over name." },
      { key: "term", label: "Name" }
    ],
    perform: async (z, bundle) => {
      const { personId, email, term } = bundle.inputData;
      if (personId) {
        const res = await z.request(`${base(bundle)}/membership/people/${encodeURIComponent(personId)}`);
        if (!res.data) throw new z.errors.Error(`No person found with id "${personId}".`, "PersonNotFound", 404);
        return res.data;
      }
      const qs = email ? `email=${encodeURIComponent(email)}` : `term=${encodeURIComponent(term || "")}`;
      const res = await z.request(`${base(bundle)}/membership/people/search?${qs}`);
      const matches = Array.isArray(res.data) ? res.data : [];
      if (!matches.length) throw new z.errors.Error(`No person found matching ${email ? `email "${email}"` : `name "${term || ""}"`}.`, "PersonNotFound", 404);
      return matches[0];
    },
    sample: SAMPLES.person
  }
};

const creates = {
  find_person: findPerson,
  create_person: {
    key: "create_person",
    noun: "Person",
    display: { label: "Create Person", description: "Adds a new person to B1. Requires the `people:write` scope." },
    operation: {
      inputFields: [
        { key: "firstName", label: "First Name", required: true },
        { key: "lastName", label: "Last Name", required: true },
        { key: "email", label: "Email" },
        { key: "mobilePhone", label: "Mobile Phone" }
      ],
      perform: async (z, bundle) => {
        const { firstName, lastName, email, mobilePhone } = bundle.inputData;
        const res = await z.request({
          method: "POST",
          url: `${base(bundle)}/membership/people`,
          body: [{ name: { first: firstName, last: lastName }, contactInfo: { email, mobilePhone } }]
        });
        return res.data[0];
      },
      sample: SAMPLES.person
    }
  },
  add_donation: {
    key: "add_donation",
    noun: "Donation",
    display: { label: "Add Donation", description: "Records a donation in B1. Requires the `donations:write` scope." },
    operation: {
      inputFields: [
        { key: "amount", label: "Amount", type: "number", required: true },
        { key: "personId", label: "Person", dynamic: "list_people.id.name__display", helpText: "Leave blank for an anonymous gift." },
        { key: "fundId", label: "Fund", dynamic: "list_funds.id.name" },
        { key: "donationDate", label: "Donation Date", type: "datetime", helpText: "Defaults to now." },
        { key: "method", label: "Method", helpText: "e.g. Cash, Check, Card" },
        { key: "notes", label: "Notes" }
      ],
      perform: async (z, bundle) => {
        const { amount, personId, fundId, donationDate, method, notes } = bundle.inputData;
        const res = await z.request({
          method: "POST",
          url: `${base(bundle)}/giving/donations`,
          body: [{ amount, personId, donationDate: donationDate || new Date().toISOString(), method, notes }]
        });
        const donation = res.data[0];
        if (fundId) {
          await z.request({
            method: "POST",
            url: `${base(bundle)}/giving/funddonations`,
            body: [{ donationId: donation.id, fundId, amount }]
          });
        }
        return { ...donation, fundId };
      },
      sample: SAMPLES.donation
    }
  },
  add_group_member: {
    key: "add_group_member",
    noun: "Group Member",
    display: { label: "Add Group Member", description: "Adds a person to a group in B1. Requires the `groups:write` scope." },
    operation: {
      inputFields: [
        { key: "groupId", label: "Group", required: true, dynamic: "list_groups.id.name" },
        { key: "personId", label: "Person", required: true, dynamic: "list_people.id.name__display" }
      ],
      perform: async (z, bundle) => {
        const { groupId, personId } = bundle.inputData;
        const res = await z.request({
          method: "POST",
          url: `${base(bundle)}/membership/groupmembers`,
          body: [{ groupId, personId }]
        });
        return res.data[0];
      },
      sample: SAMPLES.groupMember
    }
  }
};

module.exports = {
  version,
  platformVersion,
  // Empty inputs reach perform as-is; every perform uses truthy checks, so no auto-cleaning needed.
  flags: { cleanInputData: false },
  authentication,
  beforeRequest: [addAuth],
  triggers,
  creates
};
