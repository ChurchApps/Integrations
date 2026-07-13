const { version } = require("./package.json");
// Must exactly match the zapier-platform-core version in package.json.
const platformVersion = "17.0.0";

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
      helpText: "Create one in B1Admin under **Settings → Developer → API Keys**. Include the `settings:write` scope if any of your Zaps use a B1 trigger, plus the scopes your actions need (e.g. `people:write`, `donations:write`)."
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
    const res = await z.request(`${base(bundle)}/membership/webhooks/events`);
    return { connected: true, eventCount: res.data.all ? res.data.all.length : 0 };
  },
  connectionLabel: (z, bundle) => `B1.church (${(bundle.authData.apiKey || "").split(".")[0]}…)`
};

const SAMPLES = {
  person: { id: "smpl_person", churchId: "smpl_church", name: { display: "Sample Person", first: "Sample", last: "Person" }, contactInfo: { email: "sample@example.com" } },
  donation: { id: "smpl_donation", churchId: "smpl_church", personId: "smpl_person", batchId: "smpl_batch", donationDate: "2026-01-15T00:00:00.000Z", amount: 50, currency: "USD", method: "card", status: "complete" },
  groupMember: { id: "smpl_groupmember", churchId: "smpl_church", groupId: "smpl_group", personId: "smpl_person" },
  formSubmission: { id: "smpl_formsubmission", churchId: "smpl_church", formId: "smpl_form", contentType: "person", contentId: "smpl_person" }
};

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
        return (listTransform ? listTransform(rows) : rows).filter((r) => r && r.id).slice(0, 10);
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

const creates = {
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
        { key: "personId", label: "Person", dynamic: "list_people.id.name__display", search: "find_person.id", helpText: "Leave blank for an anonymous gift." },
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
        { key: "personId", label: "Person", required: true, dynamic: "list_people.id.name__display", search: "find_person.id" }
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

const searches = {
  find_person: {
    key: "find_person",
    noun: "Person",
    display: { label: "Find Person", description: "Looks up a person by id, email, or name. Requires the `people:read` scope." },
    operation: {
      inputFields: [
        { key: "personId", label: "Person ID", helpText: "Exact id lookup (e.g. from a trigger's `personId` field). Takes precedence over email and name." },
        { key: "email", label: "Email", helpText: "Exact email match. Takes precedence over name." },
        { key: "term", label: "Name" }
      ],
      perform: async (z, bundle) => {
        const { personId, email, term } = bundle.inputData;
        if (personId) {
          const res = await z.request(`${base(bundle)}/membership/people/${encodeURIComponent(personId)}`);
          return res.data ? [res.data] : [];
        }
        const qs = email ? `email=${encodeURIComponent(email)}` : `term=${encodeURIComponent(term || "")}`;
        const res = await z.request(`${base(bundle)}/membership/people/search?${qs}`);
        return Array.isArray(res.data) ? res.data : [];
      },
      sample: SAMPLES.person
    }
  }
};

module.exports = {
  version,
  platformVersion,
  authentication,
  beforeRequest: [addAuth],
  triggers,
  creates,
  searches
};
