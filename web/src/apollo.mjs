const emailPattern = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
const blockedDomains = new Set(['linkedin.com', 'indeed.com', 'greenhouse.io', 'lever.co', 'workdayjobs.com', 'myworkdayjobs.com', 'ashbyhq.com']);

function domainOf(value) {
  try {
    const host = new URL(/^https?:\/\//i.test(String(value || '')) ? value : `https://${value}`).hostname.toLowerCase().replace(/^www\./, '');
    return [...blockedDomains].some(blocked => host === blocked || host.endsWith(`.${blocked}`)) ? '' : host;
  } catch { return ''; }
}

function payload(result) {
  const entry = result?.data?.alexandria?.[0];
  if (entry?.error) throw new Error(entry.error?.message || 'Apollo lookup failed');
  return entry?.data || entry?.records || result?.data || {};
}

async function callApollo(key, capability, options) {
  const response = await fetch('https://api.firecrawl.dev/v2/scrape', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ alexandria: { provider: 'apollo', capability, options } })
  });
  const result = await response.json();
  if (!response.ok || result?.success === false) throw new Error(result?.error?.message || result?.message || `Apollo lookup returned ${response.status}`);
  return payload(result);
}

function titleScore(title, role) {
  const t = String(title || '').toLowerCase();
  const r = String(role || '').toLowerCase();
  let score = /head of|director|manager|lead/.test(t) ? 2 : 0;
  if (/recruit|talent acquisition|hiring/.test(t)) score += 3;
  if (/recruit|talent/.test(r) && /talent acquisition|recruit/.test(t)) score += 2;
  if (/engineer|software|developer/.test(r) && /engineering|software/.test(t)) score += 2;
  if (/sales|business development/.test(r) && /sales|business development/.test(t)) score += 2;
  return score;
}

function searchTitles(role) {
  const r = String(role || '').toLowerCase();
  if (/recruit|talent acquisition/.test(r)) return ['Head of Talent Acquisition', 'Talent Acquisition Manager', 'Recruitment Manager', 'Recruiter'];
  if (/engineer|software|developer/.test(r)) return ['Engineering Manager', 'Director of Engineering', 'Technical Recruiter'];
  if (/sales|business development/.test(r)) return ['Sales Manager', 'Head of Sales', 'Talent Acquisition Manager'];
  return ['Talent Acquisition Manager', 'Recruitment Manager', 'Recruiter'];
}

function sameEmployer(person, company, domain) {
  const org = person?.organization || {};
  const foundDomain = domainOf(org.website_url || org.website || org.primary_domain || org.domain);
  if (foundDomain) return foundDomain === domain;
  const expected = String(company || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const actual = String(org.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return expected.length >= 4 && actual === expected;
}

export async function lookupApolloContacts(research, env) {
  if (env.ALEXANDRIA_APOLLO_ENABLED !== 'true') return { contacts: [], note: 'Apollo lookup is awaiting provider terms and credit approval.' };
  const domain = domainOf(research?.analysis?.companyWebsiteUrl);
  if (!domain) return { contacts: [], note: 'The employer website could not be confirmed; Apollo lookup was skipped.' };
  const company = research.analysis.company;
  const jobTitle = research.analysis.jobTitle;
  try {
    const preview = await callApollo(env.FIRECRAWL_API_KEY, 'people/search', {
      person_titles: searchTitles(jobTitle), q_organization_domains_list: [domain], page: 1, per_page: 10
    });
    const people = Array.isArray(preview.people) ? preview.people : Array.isArray(preview) ? preview : [];
    const shortlist = people.filter(person => person?.id && person.has_email)
      .sort((a, b) => titleScore(b.title, jobTitle) - titleScore(a.title, jobTitle)).slice(0, 2);
    const contacts = [];
    for (const person of shortlist) {
      const result = await callApollo(env.FIRECRAWL_API_KEY, 'people/match', { id: person.id });
      const matched = result.person || result;
      const email = String(matched?.email || '').trim().toLowerCase();
      if (!emailPattern.test(email) || email.startsWith('email_not_unlocked@') || !sameEmployer(matched, company, domain)) continue;
      const name = String(matched.name || [matched.first_name, matched.last_name].filter(Boolean).join(' ')).trim();
      if (!name) continue;
      contacts.push({ name, role: String(matched.title || person.title || ''), email, source: 'Apollo via Firecrawl', confidence: 'provider returned', reason: 'Likely hiring contact based on current title; role ownership is unconfirmed.' });
    }
    return { contacts, note: contacts.length < 2 ? 'Apollo returned fewer than two usable current work emails.' : '' };
  } catch (error) {
    return { contacts: [], note: `Apollo lookup unavailable: ${error instanceof Error ? error.message : 'unknown error'}` };
  }
}
