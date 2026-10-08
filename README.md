# Nidhi job outreach agent

## Web app

The runnable app is in [`web/`](web/). It takes a job link and the latest resume, researches public sources, compares the role with the resume, and writes a copy-ready email. It never opens Gmail or sends email. See [`web/README.md`](web/README.md) for free-tier deployment requirements and the manual setup steps.

This repository also includes the Codex-local workflow below. The web app and Codex workflow share the same evidence and writing rules, but the deployed web app needs its own Cloudflare Workers AI binding and Firecrawl API key.

This repository contains a Codex-native workflow for turning a manually supplied job link and Nidhi's latest resume into a researched, copy-ready cold email. The writing rules are in [`nidhi_hiring_outreach_playbook.md`](nidhi_hiring_outreach_playbook.md); the operational workflow is in [`agent/WORKFLOW.md`](agent/WORKFLOW.md). `agent.py` records the resume version and validates the final proposal before producing `draft.md` for Nidhi to paste into her mail app.

## Use in Codex

The repo-local Codex skill lives at `.agents/skills/nidhi-job-agent/SKILL.md`; `AGENTS.md` also routes job-link requests to the workflow. Share a LinkedIn job link and the current resume, then ask: “Run the Nidhi job outreach agent for this role.” Codex researches the role, company, and probable recruiting owner with available connectors, writes `proposal.json`, validates it, and gives Nidhi a copy-ready email. It does not access Gmail or send email.

LinkedIn may not expose a full job description to public search. In that case, paste the job description or supply it as a text file. The workflow uses the employer's official job posting to check role details and status. It does not scrape a logged-in LinkedIn session.

## Local commands

Requires macOS, Python 3.9+, and the system Swift/PDFKit installation. No paid API or Python package is required for the local intake and validation commands.

```bash
python3 agent.py init \
  --job-url 'https://www.linkedin.com/jobs/view/...' \
  --resume '/absolute/path/to/latest-resume.pdf' \
  --jd-file '/absolute/path/to/job-description.txt'

python3 agent.py validate '/absolute/path/to/runs/<run-id>/proposal.json'
```

The first command creates a private `runs/<run-id>/` directory with the resume text, job description if supplied, file fingerprint, and input metadata. Codex researches and writes the proposal using the schema in `agent/WORKFLOW.md`. The second command rejects an inconsistent or unsupported proposal and writes `draft.md` with the verified recipient, subject, body, and a reminder to attach the current resume. `runs/` is Git ignored.

## Research connectors

- Firecrawl is used for bounded web research through the connected plugin and its available free allowance. No separate Firecrawl API key is needed for this Codex workflow.
- Lusha, Apollo, and ZoomInfo are optional for a professional work email, subject to existing free or account entitlements. The agent checks before using credits and leaves the recipient unresolved when it cannot verify an address.
- Quartr is optional for public-company research. Cargo is not required; its free trial is not a durable zero-cost dependency.

Nidhi copies the draft into her own mail account and attaches the current resume herself. The tool does not include Gmail access or a send command.
