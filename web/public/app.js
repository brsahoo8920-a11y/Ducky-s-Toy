const $ = id => document.getElementById(id);
let research = null;
let resumeFilename = 'the latest resume';
const setStatus = message => { $('status-message').textContent = message; };
const getInput = () => ({
  jobUrl: $('job-url').value.trim(), resumeText: $('resume-text').value.trim(),
  jobDescription: $('jd').value.trim(), applicationStatus: $('status').value
});

$('resume-file').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  resumeFilename = file.name;
  $('file-note').textContent = `Reading ${file.name} locally…`;
  try {
    let text;
    if (file.name.toLowerCase().endsWith('.pdf')) {
      const pdfjs = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
      const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
      const pages = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        pages.push(content.items.map(item => item.str).join(' '));
      }
      text = pages.join('\n\n');
    } else if (file.name.toLowerCase().endsWith('.txt')) text = await file.text();
    else throw new Error('Choose a PDF or plain text file.');
    if (text.trim().length < 200) throw new Error('The file does not contain enough readable text. Paste resume text below.');
    $('resume-text').value = text;
    $('file-note').textContent = `${file.name} read in your browser. Review the text below.`;
  } catch (error) { $('file-note').textContent = error.message; setStatus(error.message); }
});

async function callApi(path, body) {
  const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-access-token': $('access').value }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

$('agent-form').addEventListener('submit', async event => {
  event.preventDefault();
  const input = getInput();
  if (input.resumeText.length < 200) return setStatus('Please upload or paste a readable resume.');
  const button = $('research-button');
  button.disabled = true; button.textContent = 'Researching…'; setStatus('Looking for the role, official sources and recruiting contacts…');
  try {
    research = await callApi('/api/research', input);
    $('empty-state').hidden = true;
    $('research-result').hidden = false;
    $('draft-result').hidden = true;
    $('warning').textContent = research.warning + ' ' + research.contactNote;
    const analysis = research.analysis || {};
    $('analysis-summary').textContent = `${analysis.jobTitle || 'Role title uncertain'} · ${analysis.company || 'Company uncertain'} · Status: ${analysis.jobStatus || 'unknown'}`;
    $('fit-list').replaceChildren(...(analysis.fit || []).map(item => listItem(`${item.requirement}: ${item.resumeQuote}`, item.assessment)));
    $('company-list').replaceChildren(...(analysis.companyFacts || []).map(item => listItem(item.fact, item.sourceUrl)));
    $('contact-list').replaceChildren(...(analysis.contacts || []).map(item => listItem(`${item.name} · ${item.role} · ${item.confidence} confidence`, item.reason)));
    const firstContact = (analysis.contacts || [])[0];
    $('contact-name').value = firstContact?.name || '';
    $('contact-role').value = firstContact?.role || '';
    $('contact-email').value = firstContact?.email || '';
    $('contact-source').value = firstContact?.email ? firstContact.sourceUrl : '';
    $('gaps').hidden = !(analysis.gaps || []).length;
    $('gaps').textContent = (analysis.gaps || []).join(' · ');
    $('sources').replaceChildren(...research.sources.map(source => {
      const li = document.createElement('li');
      const a = document.createElement('a'); a.href = source.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = source.title || source.url;
      const small = document.createElement('small'); small.textContent = source.excerpt.slice(0, 230);
      li.append(a, small); return li;
    }));
    setStatus(`Found ${research.sources.length} sources. Review them before drafting.`);
  } catch (error) { setStatus(error.message); }
  finally { button.disabled = false; button.innerHTML = 'Research this role <span aria-hidden="true">→</span>'; }
});

function listItem(title, detail) {
  const li = document.createElement('li');
  const strong = document.createElement('strong'); strong.textContent = title || '';
  const small = document.createElement('small'); small.textContent = detail || '';
  li.append(strong, small); return li;
}

$('draft-button').addEventListener('click', async () => {
  const email = $('contact-email').value.trim();
  const source = $('contact-source').value.trim();
  if (email && (!source || !/^https:\/\//.test(source))) return setStatus('A verified work email needs an HTTPS evidence URL. Leave the email blank if unverified.');
  const button = $('draft-button'); button.disabled = true; button.textContent = 'Writing…'; setStatus('Comparing the role with the resume and writing the email…');
  try {
    const payload = { ...getInput(), research, contact: { name: $('contact-name').value.trim(), role: $('contact-role').value.trim(), email, source } };
    const data = await callApi('/api/draft', payload);
    $('draft-result').hidden = false;
    $('draft-to').textContent = email || 'Recipient unresolved — verify before sending';
    $('draft-subject').textContent = data.draft.subject;
    $('draft-body').textContent = data.draft.body;
    $('attachment-reminder').textContent = `Before sending: attach ${resumeFilename} manually and verify every claim.`;
    $('used-sources').replaceChildren(...data.draft.usedSourceUrls.map(url => { const li = document.createElement('li'); const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = url; li.append(a); return li; }));
    setStatus('Draft ready for review and copy. No email has been sent.');
  } catch (error) { setStatus(error.message); }
  finally { button.disabled = false; button.innerHTML = 'Create the email draft <span aria-hidden="true">→</span>'; }
});

$('copy-button').addEventListener('click', async () => {
  await navigator.clipboard.writeText(`Subject: ${$('draft-subject').textContent}\n\n${$('draft-body').textContent}`);
  setStatus('Subject and message copied. Remember to attach the resume manually.');
});
