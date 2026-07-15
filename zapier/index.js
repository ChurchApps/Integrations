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
  formSubmission: { id: "smpl_formsubmission", churchId: "smpl_church", formId: "smpl_form", formName: "Sample Form", contentType: "person", contentId: "smpl_person", personName: "Sample Person" }
};

// Hook payloads only contain the fields that were set when the record was saved,
// while the REST list endpoints return full DB rows. Zapier flags sample fields
// that never appear in real task history, so polling rows are projected down to
// the sample's keys.
const pick = (keys) => (row) => Object.fromEntries(keys.filter((k) => row[k] !== undefined).map((k) => [k, row[k]]));

const hookTrigger = ({ key, noun, label, description, event, listUrl, listTransform, sample }) => ({
  key,
  noun,
  display: { label, description },
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
    sample
  }
});

const byDateDesc = (field) => (rows) => [...rows].sort((a, b) => new Date(b[field] || 0) - new Date(a[field] || 0));

const triggers = {
  new_person: hookTrigger({
    key: "new_person",
    noun: "Person",
    label: "New Person",
    description: "Triggers when a person is added in B1.",
    event: "person.created",
    listUrl: "/membership/people/recent",
    sample: SAMPLES.person
  }),
  updated_person: hookTrigger({
    key: "updated_person",
    noun: "Person",
    label: "Updated Person",
    description: "Triggers when a person record is changed in B1.",
    event: "person.updated",
    listUrl: "/membership/people/recent",
    sample: SAMPLES.person
  }),
  new_donation: hookTrigger({
    key: "new_donation",
    noun: "Donation",
    label: "New Donation",
    description: "Triggers when a gift is recorded in B1 — manual entry, online, or the pending → complete transition.",
    event: "donation.created",
    listUrl: "/giving/donations",
    listTransform: byDateDesc("donationDate"),
    sample: SAMPLES.donation
  }),
  new_group_member: hookTrigger({
    key: "new_group_member",
    noun: "Group Member",
    label: "New Group Member",
    description: "Triggers when a person is added to a group in B1.",
    event: "group.member.added",
    listUrl: "/membership/groupmembers",
    sample: SAMPLES.groupMember
  }),
  new_form_submission: hookTrigger({
    key: "new_form_submission",
    noun: "Form Submission",
    label: "New Form Submission",
    description: "Triggers when a form is submitted in B1.",
    event: "form.submission.created",
    listUrl: "/membership/formsubmissions",
    sample: SAMPLES.formSubmission
  }),

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
