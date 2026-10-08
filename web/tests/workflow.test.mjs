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
