# Nidhi job outreach web app

This Cloudflare Worker serves a small browser app. Its one-click flow reads a job link, identifies the employer, searches its careers pages and hiring contacts with Firecrawl, identifies up to two likely contacts with work emails literally present in the research, and uses Cloudflare Workers AI to draft an email. The page shows only the contacts and copy-ready email; sources remain internal for validation. Nidhi copies the result into her mail client and attaches her latest resume. The app never accesses Gmail or sends mail.

## Daily learning and outcome feedback

The Worker has a daily Cron Trigger at 03:30 UTC (09:00 India time). It reads a few public cold outreach search results through Firecrawl, summarizes bounded writing rules with Workers AI, and saves them in Workers KV. Future drafts include the latest rules as suggestions beneath the permanent truth and privacy rules. This updates prompt guidance, not model weights. If Firecrawl credits run out or research fails, the previous guide remains; there is no paid fallback.

The page has a manual outcome tracker. Nidhi marks when she sends a copied email, then records a reply, a useful next step, or no reply after 14 days. KV stores only an anonymous draft ID, coarse subject/opening style labels, dates, and outcome. It does not store the recipient, resume, job description, subject, body, or mailbox messages. The browser keeps a small local list of recent draft IDs and role labels so Nidhi can return later. The daily job compares styles only when each compared style has at least ten sent messages; smaller samples are descriptive, not proof that a tactic works.

**Live app:** https://nidhi-job-outreach.brsahoo8920.workers.dev/

## Set up on a free plan

1. Create a Cloudflare account with Workers AI enabled and a Firecrawl account with available free credits. These are independent from the Firecrawl connector in Codex; the deployed app needs its own API key. Free allowances may change or be exhausted.
2. In Cloudflare, create a Worker from this repository with root directory `web`, or deploy locally with Wrangler from `web/`.
3. Add two Worker secrets: `APP_ACCESS_TOKEN` (a long random code shared only with Nidhi) and `FIRECRAWL_API_KEY`. Do not commit either secret. The `LEARNING` KV namespace is provisioned from `wrangler.toml` on deploy.
4. Deploy with `npx wrangler deploy` from `web/`. The `wrangler.toml` file binds Workers AI and serves `public/` as static assets. Cloudflare provides the resulting `*.workers.dev` URL.

The access code prevents casual visitors from spending the free allowance. Keep the GitHub repo private; the deployed site is still reachable by URL, but API calls require the code. The resume is extracted locally in the browser, then its text is sent to Cloudflare Workers AI when Nidhi requests research or a draft. The text is not stored by this app. Firecrawl receives the public job URL, job description snippet and search terms, but never the resume. PDF extraction uses a pinned PDF.js build from cdnjs.

Research results are evidence candidates, not a guarantee that the job is open or that a person owns the vacancy. The app accepts a work email only if it is visible in a research result. It does not guess email patterns or promise 100% or 90% certainty. If fewer than two addresses can be substantiated, the remaining slot says so. If the listing is inaccessible, paste the job description. Review the contact and every claim before sending.

Apollo, Lusha, and ZoomInfo connections inside Codex cannot be used automatically by this independent Cloudflare Worker. Direct provider searches require separate provider API credentials and account entitlements; none are configured in this deployment. The one-click flow currently uses Firecrawl public research. Do not describe an address as provider-verified unless a provider integration actually returned it.

## Local checks

Run `node --test tests/*.test.mjs` from `web/`. A live end-to-end test needs configured Cloudflare and Firecrawl accounts.
