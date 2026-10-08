const emailPattern = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
const blockedDomains = new Set(['linkedin.com', 'indeed.com', 'glassdoor.com', 'naukri.com', 'dailyremote.com', 'greenhouse.io', 'lever.co', 'workdayjobs.com', 'myworkdayjobs.com', 'ashbyhq.com']);

function domainOf(value) {
  try {
    const host = new URL(/^https?:\/\//i.test(String(value || '')) ? value : `https://${value}`).hostname.toLowerCase().replace(/^www\./, '');
    return [...blockedDomains].some(blocked => host === blocked || host.endsWith(`.${blocked}`)) ? '' : host;
  } catch { return ''; }
}

function payload(result) {
  const entry = result?.data?.alexandria?.[0];
  if (entry?.error) throw new Error(entry.error?.message || 'Provider lookup failed');
  return entry?.data || entry?.records || result?.data || {};
}

async function callProvider(key, provider, capability, options) {
  const response = await fetch('https://api.firecrawl.dev/v2/scrape', {
    method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ alexandria: { provider, capability, options } })
  });
  const result = await response.json();
  if (!response.ok || result?.success === false) throw new Error(result?.error?.message || result?.message || `${provider} returned ${response.status}`);
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

function usableEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return emailPattern.test(email) && !email.startsWith('email_not_unlocked@') && !/@(?:gmail|yahoo|hotmail|outlook)\./.test(email) ? email : '';
}

function contact(name, role, email, source) {
  return { name, role, email, source, confidence: 'provider returned', reason: 'Likely hiring contact based on current title; role ownership is unconfirmed.' };
}

export async function lookupApolloContacts(research, env) {
  if (env.PROVIDER_LOOKUP_ENABLED !== 'true') return { contacts: [], note: 'Provider lookups are not enabled yet.' };
  const domain = domainOf(research?.analysis?.companyWebsiteUrl);
  if (!domain) return { contacts: [], note: 'The employer website could not be confirmed; provider lookup was skipped.' };
  const company = research.analysis.company;
  const jobTitle = research.analysis.jobTitle;
  const key = env.FIRECRAWL_API_KEY;
  const contacts = [];
  const notes = [];
  let reservedCredits = 0;
  let candidates = [];

  // Reserve each call's maximum possible charge before execution.
  try {
    reservedCredits += 10;
    const found = await callProvider(key, 'fullenrich', 'people/search', {
      current_company_domains: [{ value: domain, exact_match: true }],
      current_position_titles: searchTitles(jobTitle).map(value => ({ value })), limit: 2
    });
    candidates = (Array.isArray(found.people) ? found.people : [])
      .filter(person => person?.first_name && person?.last_name)
      .sort((a, b) => titleScore(b.headline || b.employment?.current?.title, jobTitle) - titleScore(a.headline || a.employment?.current?.title, jobTitle))
      .slice(0, 2);
    for (const person of candidates) {
      if (reservedCredits + 20 > 60) break;
      reservedCredits += 20;
      const result = await callProvider(key, 'fullenrich', 'contacts/work-email', {
        first_name: person.first_name, last_name: person.last_name, domain
      });
      const item = Array.isArray(result.results) ? result.results[0] : null;
      const email = usableEmail(item?.contact_info?.most_probable_work_email?.email || item?.contact_info?.most_probable_work_email);
      if (!email) continue;
      contacts.push(contact(String(person.full_name || `${person.first_name} ${person.last_name}`), String(person.headline || person.employment?.current?.title || ''), email, 'FullEnrich via Firecrawl'));
    }
  } catch (error) { notes.push(`FullEnrich unavailable: ${error instanceof Error ? error.message : 'unknown error'}`); }

  if (contacts.length < 2 && reservedCredits + 30 <= 60) {
    try {
      const preview = await callProvider(key, 'apollo', 'people/search', {
        person_titles: searchTitles(jobTitle), q_organization_domains_list: [domain], page: 1, per_page: 10
      });
      const people = (Array.isArray(preview.people) ? preview.people : [])
        .filter(person => person?.id && person.has_email)
        .sort((a, b) => titleScore(b.title, jobTitle) - titleScore(a.title, jobTitle));
      for (const person of people) {
        if (contacts.length >= 2 || reservedCredits + 30 > 60) break;
        reservedCredits += 30;
        const result = await callProvider(key, 'apollo', 'people/match', { id: person.id });
        const matched = result.person || result;
        const email = usableEmail(matched?.email);
        if (!email || !sameEmployer(matched, company, domain) || contacts.some(existing => existing.email === email)) continue;
        const name = String(matched.name || [matched.first_name, matched.last_name].filter(Boolean).join(' ')).trim();
        if (name) contacts.push(contact(name, String(matched.title || person.title || ''), email, 'Apollo via Firecrawl'));
      }
    } catch (error) { notes.push(`Apollo unavailable: ${error instanceof Error ? error.message : 'unknown error'}`); }
  }

  const knownPerson = candidates[0] || (research.analysis.contacts || []).find(person => String(person.name || '').trim().split(/\s+/).length >= 2);
  if (!contacts.length && knownPerson && reservedCredits + 50 <= 60) {
    try {
      reservedCredits += 50;
      const person = knownPerson;
      const fullName = String(person.full_name || person.name || `${person.first_name} ${person.last_name}`);
      const result = await callProvider(key, 'datalegion', 'people/enrich-base-with-contact', {
        full_name: fullName, company: domain,
        min_confidence: 'high', required_fields: 'work_email'
      });
      const match = Array.isArray(result.matches) ? result.matches[0]?.person : null;
      const email = usableEmail(match?.work_email);
      if (email) contacts.push(contact(fullName, String(person.headline || person.role || ''), email, 'Data Legion via Firecrawl'));
    } catch (error) { notes.push(`Data Legion unavailable: ${error instanceof Error ? error.message : 'unknown error'}`); }
  }
  return { contacts, note: [contacts.length < 2 ? 'Providers returned fewer than two usable work emails.' : '', ...notes].filter(Boolean).join(' ') };
}
