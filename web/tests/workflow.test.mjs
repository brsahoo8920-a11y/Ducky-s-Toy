import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDraft, validJobUrl, researchJob } from '../src/workflow.mjs';
import worker from '../src/worker.mjs';

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
    const result = await researchJob({ jobUrl: 'https://www.linkedin.com/jobs/view/123', resumeText: 'Recruiting experience '.repeat(20) }, { FIRECRAWL_API_KEY: 'test', AI: { run: async () => ({ response: JSON.stringify({ company: 'Company', jobTitle: 'TA role', jobStatus: 'unknown', fit: [], contacts: [{ name: '', role: 'Recruiter', sourceUrl: 'https://company.example/careers/123' }] }) }) } });
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
      return { response: calls === 1 ? JSON.stringify({ company: 'Acme', jobTitle: 'Talent Acquisition Manager', contacts: [
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
