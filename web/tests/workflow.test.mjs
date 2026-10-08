import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDraft, validJobUrl, researchJob } from '../src/workflow.mjs';
import worker from '../src/worker.mjs';
import { dailyLearn, recordFeedback, saveDraft } from '../src/learning.mjs';
import { lookupApolloContacts } from '../src/apollo.mjs';

test('Apollo lookup limits paid matches and rejects mismatched employer or locked email', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(init.body).alexandria;
    calls.push(request);
    const data = request.capability === 'people/search' ? { people: [
      { id: '1', title: 'Head of Talent Acquisition', has_email: true },
      { id: '2', title: 'Recruiter', has_email: true },
      { id: '3', title: 'Recruiter', has_email: true }
    ] } : request.options.id === '1' ? { person: { name: 'Jane Doe', title: 'Head of Talent Acquisition', email: 'jane@acme.example', organization: { primary_domain: 'acme.example' } } } :
      { person: { name: 'Other Person', title: 'Recruiter', email: 'email_not_unlocked@acme.example', organization: { primary_domain: 'acme.example' } } };
    return { ok: true, json: async () => ({ success: true, data: { alexandria: [{ data }] } }) };
  };
  try {
    const result = await lookupApolloContacts({ analysis: { company: 'Acme', jobTitle: 'Talent Acquisition Specialist', companyWebsiteUrl: 'https://acme.example/careers' } }, { ALEXANDRIA_APOLLO_ENABLED: 'true', FIRECRAWL_API_KEY: 'test' });
    assert.equal(calls.length, 3);
    assert.equal(calls[0].options.q_organization_domains_list[0], 'acme.example');
    assert.equal(result.contacts.length, 1);
    assert.equal(result.contacts[0].email, 'jane@acme.example');
  } finally { globalThis.fetch = original; }
});

test('rejects private URL targets', () => {
  assert.equal(validJobUrl('https://127.0.0.1/internal'), false);
  assert.equal(validJobUrl('https://169.254.169.254/internal'), false);
  assert.equal(validJobUrl('https://localhost/'), false);
  assert.equal(validJobUrl('https://www.linkedin.com/jobs/view/123'), true);
});

test('requires an exact source match for a claimed work email', () => {
  const input = {
    jobUrl: 'https://company.example/jobs/123', resumeText: 'Recruiting experience '.repeat(20),
    applicationStatus: 'unknown', research: { jobUrl: 'https://company.example/jobs/123', sources: [{ url: 'https://company.example/team', excerpt: 'Jane Smith: jane@company.example' }] },
    contact: { email: 'jane@company.example', source: 'https://company.example/team' }
  };
  assert.equal(validateDraft(input).ok, true);
  input.contact.email = 'other@company.example';
  assert.equal(validateDraft(input).ok, false);
});

test('research captures sources from Firecrawl v2 responses', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async url => ({ ok: true, json: async () => url.endsWith('/scrape') ?
    { data: { markdown: 'Talent Acquisition job description', metadata: { title: 'TA role' } } } :
    { data: { web: [{ url: 'https://company.example/careers/123', title: 'Careers', description: 'TA opening' }] } } });
  try {
    let aiCalls = 0;
    const result = await researchJob({ jobUrl: 'https://www.linkedin.com/jobs/view/123', resumeText: 'Recruiting experience '.repeat(20) }, { FIRECRAWL_API_KEY: 'test', AI: { run: async () => ({ response: JSON.stringify(++aiCalls === 1 ? { company: 'Company', jobTitle: 'TA role' } : { company: 'Company', jobTitle: 'TA role', jobStatus: 'unknown', fit: [], contacts: [{ name: '', role: 'Recruiter', sourceUrl: 'https://company.example/careers/123' }] }) }) } });
    assert.equal(result.sources.length, 2);
    assert.equal(result.sources[0].title, 'TA role');
    assert.equal(result.analysis.company, 'Company');
    assert.equal(result.analysis.contacts.length, 0);
  } finally { globalThis.fetch = original; }
});

test('draft endpoint adds greeting and signature without inventing a recipient', async () => {
  const input = {
    jobUrl: 'https://company.example/jobs/123', resumeText: 'Recruiting experience '.repeat(20),
    applicationStatus: 'unknown', research: { jobUrl: 'https://company.example/jobs/123', sources: [{ url: 'https://company.example/jobs/123', title: 'TA role', excerpt: 'Recruiter needed' }] },
    contact: { name: '', role: '', email: '', source: '' }
  };
  const env = { APP_ACCESS_TOKEN: 'test-code', FIRECRAWL_API_KEY: 'test', AI: { run: async () => ({ response: JSON.stringify({ subject: 'TA role', body: 'I saw the TA role and have recruiting experience.', usedResumeQuotes: [], usedSourceUrls: [] }) }) } };
  const response = await worker.fetch(new Request('https://app.example/api/draft', { method: 'POST', headers: { 'x-access-token': 'test-code' }, body: JSON.stringify(input) }), env);
  assert.equal(response.status, 200);
  const { draft } = await response.json();
  assert.match(draft.body, /^Hello,/);
  assert.match(draft.body, /Best,\nNidhi Deshpande$/);
});

test('one-click compose returns only verified contact addresses and a draft', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async url => ({ ok: true, json: async () => url.endsWith('/scrape') ?
    { data: { markdown: 'Talent Acquisition Manager role at Acme. Jane Doe jane@acme.example', metadata: { title: 'Talent Acquisition Manager at Acme' } } } :
    { data: { web: [{ url: 'https://acme.example/team', title: 'Team', description: 'Jane Doe jane@acme.example' }] } } });
  try {
    let calls = 0;
    const env = { APP_ACCESS_TOKEN: 'test-code', FIRECRAWL_API_KEY: 'test', AI: { run: async () => {
      calls++;
      return { response: calls === 1 ? JSON.stringify({ company: 'Acme', jobTitle: 'Talent Acquisition Manager' }) : calls === 2 ? JSON.stringify({ company: 'Acme', jobTitle: 'Talent Acquisition Manager', contacts: [
        { name: 'Jane Doe', role: 'Recruiter', email: 'jane@acme.example', sourceUrl: 'https://acme.example/team', confidence: 'medium' },
        { name: 'Unknown Person', role: 'Recruiter', email: 'guessed@acme.example', sourceUrl: 'https://acme.example/team', confidence: 'high' }
      ] }) : JSON.stringify({ subject: 'Talent Acquisition Manager', body: 'I saw the role and would welcome a conversation.', usedResumeQuotes: [], usedSourceUrls: [] }) };
    } } };
    const input = { jobUrl: 'https://acme.example/jobs/123', resumeText: 'Recruiting experience '.repeat(20), applicationStatus: 'unknown' };
    const response = await worker.fetch(new Request('https://app.example/api/compose', { method: 'POST', headers: { 'x-access-token': 'test-code' }, body: JSON.stringify(input) }), env);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.contacts.length, 1);
    assert.equal(result.contacts[0].email, 'jane@acme.example');
    assert.equal(result.warning.includes('Fewer than two'), true);
    assert.equal(result.sources, undefined);
    assert.match(result.draft.body, /^Hi Jane,/);
  } finally { globalThis.fetch = original; }
});

test('feedback records manual sending and prevents premature no-reply labels', async () => {
  const data = new Map();
  const env = { LEARNING: {
    put: async (key, value) => data.set(key, JSON.parse(value)),
    get: async key => data.get(key) || null
  } };
  const id = await saveDraft(env, { subject: 'This needs your attention', body: 'Since I have your attention, I saw the job.' });
  await assert.rejects(recordFeedback(env, { draftId: id, outcome: 'replied' }), /Mark the email sent/);
  assert.equal((await recordFeedback(env, { draftId: id, outcome: 'sent' })).outcome, 'sent');
  await assert.rejects(recordFeedback(env, { draftId: id, outcome: 'no_reply' }), /Wait 14 days/);
  assert.equal((await recordFeedback(env, { draftId: id, outcome: 'replied' })).outcome, 'replied');
  assert.equal(data.get(`draft:${id}`).subjectStyle, 'attention');
  assert.equal(JSON.stringify(data.get(`draft:${id}`)).includes('I saw the job'), false);
});

test('daily learning stores bounded sourced rules for future prompts', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ data: { web: [{ url: 'https://example.org/cold-email-study', title: 'Study', description: 'Specific messages may work better.' }] } }) });
  const data = new Map();
  const env = { FIRECRAWL_API_KEY: 'test', LEARNING: {
    list: async () => ({ keys: [], list_complete: true }),
    put: async (key, value) => data.set(key, JSON.parse(value))
  }, AI: { run: async () => ({ response: JSON.stringify({ rules: ['Name the exact role and one evidence-backed achievement.'], sourceUrls: ['https://example.org/cold-email-study'], outcomeNote: 'No sent outcomes yet.' }) }) } };
  try {
    const guide = await dailyLearn(env);
    assert.equal(guide.rules.length, 1);
    assert.deepEqual(guide.sourceUrls, ['https://example.org/cold-email-study']);
    assert.equal(data.get('learning:latest').counts.attention.sent, 0);
  } finally { globalThis.fetch = original; }
});
