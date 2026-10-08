# Nidhi job outreach web app

This Cloudflare Worker serves a small browser app and two API endpoints. It reads a job link, researches public sources with Firecrawl, and uses Cloudflare Workers AI to draft an email. Nidhi copies the result into her mail client and attaches her latest resume. The app never accesses Gmail or sends mail.

## Set up on a free plan

1. Create a Cloudflare account with Workers AI enabled and a Firecrawl account with available free credits. These are independent from the Firecrawl connector in Codex; the deployed app needs its own API key. Free allowances may change or be exhausted.
2. In Cloudflare, create a Worker from this repository with root directory `web`, or deploy locally with Wrangler from `web/`.
3. Add two Worker secrets: `APP_ACCESS_TOKEN` (a long random code shared only with Nidhi) and `FIRECRAWL_API_KEY`. Do not commit either secret.
4. Deploy with `npx wrangler deploy` from `web/`. The `wrangler.toml` file binds Workers AI and serves `public/` as static assets. Cloudflare provides the resulting `*.workers.dev` URL.

The access code prevents casual visitors from spending the free allowance. Keep the GitHub repo private; the deployed site is still reachable by URL, but API calls require the code. The resume is extracted locally in the browser, then its text is sent to Cloudflare Workers AI when Nidhi requests a draft. The text is not stored by this app. Firecrawl receives the public job URL, job description snippet and search terms, but never the resume.

Research results are evidence candidates, not a guarantee that the job is open or that a person owns the vacancy. The app accepts a work email only if it is visible in a cited research result. It does not guess email patterns. If the listing is inaccessible, paste the job description. Review every claim and source before sending.

## Local checks

Run `node --test tests/*.test.mjs` from `web/`. A live end-to-end test needs configured Cloudflare and Firecrawl accounts.
