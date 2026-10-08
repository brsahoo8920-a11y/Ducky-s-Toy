const $ = id => document.getElementById(id);
let resumeFilename = 'the latest resume';
const setStatus = message => { $('status-message').textContent = message; };
const getInput = () => ({
  jobUrl: $('job-url').value.trim(), resumeText: $('resume-text').value.trim(),
  jobDescription: $('jd').value.trim(), applicationStatus: $('status').value
});
const historyKey = 'nidhi-outreach-feedback-v1';
const readHistory = () => { try { return JSON.parse(localStorage.getItem(historyKey) || '[]'); } catch { return []; } };
const writeHistory = items => { localStorage.setItem(historyKey, JSON.stringify(items.slice(0, 30))); renderHistory(); };

function renderHistory() {
  const items = readHistory();
  $('feedback-panel').hidden = !items.length;
  $('feedback-list').replaceChildren(...items.map(item => {
    const li = document.createElement('li');
    const label = document.createElement('strong');
    label.textContent = `${item.role || 'Job outreach'} · ${new Date(item.createdAt).toLocaleDateString()} · ${item.outcome.replaceAll('_', ' ')}`;
    li.append(label);
    const actions = item.outcome === 'draft' ? [['sent', 'I sent it']] : [['replied', 'Got a reply'], ['useful_next_step', 'Useful next step'], ['no_reply', 'No reply after 14 days']];
    for (const [value, title] of actions) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = title; button.className = 'feedback-action';
      button.addEventListener('click', () => updateOutcome(item.id, value)); li.append(button);
    }
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Hide from this device'; remove.className = 'feedback-action';
    remove.addEventListener('click', () => writeHistory(readHistory().filter(saved => saved.id !== item.id))); li.append(remove);
    return li;
  }));
}

async function updateOutcome(id, outcome) {
  try {
    await callApi('/api/feedback', { draftId: id, outcome });
    writeHistory(readHistory().map(item => item.id === id ? { ...item, outcome } : item));
    setStatus('Outcome saved. Future daily writing guidance can use this feedback.');
  } catch (error) { setStatus(error.message); }
}

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
  button.disabled = true;
  button.textContent = 'Finding contacts and writing…';
  $('draft-result').hidden = true;
  setStatus('Checking the role, hiring contacts, work addresses and resume match…');
  try {
    const result = await callApi('/api/compose', input);
    const [primary, secondary] = result.contacts;
    $('empty-state').hidden = true;
    $('draft-result').hidden = false;
    $('role-summary').textContent = [result.role, result.company].filter(Boolean).join(' · ');
    $('primary-contact').textContent = primary ? `${primary.name} · ${primary.role} · ${primary.email}` : 'No verified work email found';
    $('secondary-contact').textContent = secondary ? `${secondary.name} · ${secondary.role} · ${secondary.email}` : 'No second verified work email found';
    $('contact-warning').textContent = result.warning || 'These are likely contacts, not a guarantee that either owns this vacancy.';
    $('draft-subject').textContent = result.draft.subject;
    $('draft-body').textContent = result.draft.body;
    $('attachment-reminder').textContent = `Before sending: attach ${resumeFilename} manually and verify the contact and claims.`;
    $('copy-button').dataset.email = primary?.email || '';
    if (result.draftId) writeHistory([{ id: result.draftId, role: [result.role, result.company].filter(Boolean).join(' · '), createdAt: new Date().toISOString(), outcome: 'draft' }, ...readHistory()]);
    setStatus('Email ready to copy. No email has been sent.');
  } catch (error) { setStatus(error.message); }
  finally { button.disabled = false; button.innerHTML = 'Find contacts and write email <span aria-hidden="true">→</span>'; }
});

$('copy-button').addEventListener('click', async () => {
  const address = $('copy-button').dataset.email;
  await navigator.clipboard.writeText(`${address ? `To: ${address}\n` : ''}Subject: ${$('draft-subject').textContent}\n\n${$('draft-body').textContent}`);
  setStatus('Email copied. Remember to attach the resume manually.');
});

renderHistory();
