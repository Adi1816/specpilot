# Deployment Guide

This document is the clean deployment handoff for SpecPilot.

## Overview

SpecPilot is a standard Next.js App Router application with server-side route handlers for:

- spec analysis
- test plan generation
- suite execution
- markdown report generation
- bundled demo API routes

There is no database dependency and no background worker setup required.

## Before You Deploy

Make sure you have:

1. A Git repository with the project pushed.
2. A Vercel account connected to that repository.
3. An optional Gemini API key if you want the enhanced AI planner in production.

## Environment Variables

Set these in Vercel only if you want Gemini planner support:

| Variable | Required | Notes |
| --- | --- | --- |
| `GEMINI_API_KEY` | No | Enables the optional Gemini planner |
| `GEMINI_MODEL` | No | Defaults to `gemini-2.5-flash` if omitted |

If `GEMINI_API_KEY` is not set, the app still works and falls back to deterministic planning.

## Vercel Deployment Steps

### 1. Import the repository

Create a new Vercel project and import the SpecPilot repository.

### 2. Confirm framework detection

Vercel should automatically detect the project as Next.js.

Recommended defaults:

- Framework preset: `Next.js`
- Install command: `npm install`
- Build command: `npm run build`
- Output setting: default Next.js output

### 3. Add environment variables

If you want the enhanced AI planner:

- add `GEMINI_API_KEY`
- optionally add `GEMINI_MODEL`

### 4. Deploy

Trigger the first production deployment.

## What Works Immediately After Deploy

The bundled demo flow works in production too, because the demo API routes are deployed with the app.

That means a reviewer can:

1. open the deployed site
2. load the demo spec
3. analyze the spec
4. generate a test plan
5. run the suite
6. copy the markdown report

This is ideal for portfolio reviews because it gives a self-contained live demo.

## Production Smoke Test

Run this exact smoke test on the deployed URL:

1. Open the homepage and verify the UI loads cleanly.
2. Click `Load demo spec`.
3. Click `Analyze spec`.
4. Confirm that endpoint selection unlocks.
5. Click `Generate test plan`.
6. Confirm the generated suite appears.
7. Click `Run suite`.
8. Confirm the execution board populates with pass or fail results.
9. Confirm the markdown handoff is generated.
10. Click `Copy report` and verify the clipboard confirmation appears.

If `GEMINI_API_KEY` is configured, also confirm the plan includes the enhanced planner path.

## Production Readiness Checklist

- `npm run typecheck` passes
- `npm run lint` passes
- `npm run build` passes
- The bundled demo flow works on the deployed domain
- The copy-to-clipboard action succeeds in the browser
- The enhanced strategy is tested with and without the Gemini key
- The README clearly explains the project and local setup

## Important Deployment Notes

### 1. Test execution happens server-side

The suite runs through the server route handler at `/api/tests/run`, so the browser is not directly calling the target API.

That means:

- browser CORS is not the main concern
- the target API must be reachable from the deployment environment

### 2. Private internal APIs need extra planning

If you point SpecPilot at a private, VPN-only, or local-only API, a public Vercel deployment will not be able to reach it unless that API is exposed to the deployment environment.

### 3. Base URL quality matters

For external targets, use the real API base path, including versioned prefixes when needed.

Good example:

```text
https://api.example.com/v1
```

Less reliable example:

```text
https://api.example.com
```

if the actual endpoints live under `/v1`.

## Common Issues

### The AI planner is missing

Likely cause:

- `GEMINI_API_KEY` is not set
- the API key is invalid
- the model call failed and the app fell back gracefully

This does not block the rest of the product.

### The suite cannot reach a target API

Likely cause:

- wrong base URL
- target API unavailable from the deployment environment
- auth token missing or invalid

### The demo works locally but not in production

Check:

- that the deployment includes the Next.js API routes
- that no custom config is stripping server route behavior

## Recommended Post-Deploy Assets

After the live site is working, add:

1. one homepage screenshot
2. one execution board screenshot
3. one markdown handoff screenshot
4. a short demo GIF or 30 to 60 second walkthrough video

That turns the repo from a good project into a strong public portfolio artifact.
