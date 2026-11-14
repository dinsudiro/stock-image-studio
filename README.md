# Stock Image Studio — MVP v0.1

Responsive React/Vite frontend for AI stock-image production. Designed for GitHub Pages frontend and Firebase backend.

## What works now

- Responsive dashboard and navigation
- Built-in Isometric 2D and Cute Kawaii Flat Cartoon skills
- Create, edit, duplicate, and delete custom skills with master prompts
- Configure single image, multi-angle, or multi-object batch jobs
- Save generation job drafts with angles, skill, quality, and marketplace targets
- Browser-local persistence (`localStorage`)
- Firebase Email/Password and Google login and per-user Firestore save/load in Settings when configured
- Export job JSON, workspace backup JSON, and generic metadata CSV drafts
- Marketplace profiles and BYOK configuration UI placeholders

## Not yet implemented

- Real AI image generation, reference-image editing, or multi-angle consistency
- Firebase Storage / Functions / Cloud Run
- Secure BYOK credential storage and verification
- Actual PNG/JPEG processing, QC, ZIP export, platform-specific validated CSV
- Direct marketplace uploads

The app explicitly labels these as not connected. **Do not enter API secrets in this demo.**

## Run locally

```bash
npm ci
npm run dev
```

## Build

```bash
npm run build
```

## Deploy to GitHub Pages

1. Create a GitHub repository (e.g. `stock-image-studio`).
2. Push all project files to the `main` branch.
3. Under **Settings → Pages**, select **GitHub Actions** as source.
4. Workflow `.github/workflows/deploy.yml` builds and publishes the Vite app.
5. Visit `https://YOUR_USERNAME.github.io/stock-image-studio/` after successful deployment.

The workflow sets Vite's base path automatically to the repository name. For a custom domain, adjust this configuration.

## Firebase configuration

Copy the public Web App configuration from Firebase Project settings. Set the four
variables in `.env.example` as GitHub Actions repository variables for Pages, or in
`.env.local` for local use. Enable Email/Password and Google sign-in and authorize
the Pages domain in Firebase Authentication.

Merge the `/studioWorkspaces/{uid}` match in `firestore.rules` into your existing
Firestore rules. Check overlapping rules so other users and guests cannot read
or write those documents. Publish the merged rules in Firebase Console.

In Settings, use **Save to cloud** to replace your online copy, or **Load cloud
copy** to replace the drafts in your browser. Download a workspace backup first
if you want to retain both versions. Browser drafts remain on the device after
sign-out.

AI provider secrets belong in a backend. Vite variables are visible to site visitors.

### Safety and marketplace compliance

Generated raster assets must not be mislabeled as editable vectors. Platform-specific rules and AI disclosure must be versioned and verified against current official requirements. Human QC and licensing review are required before submission. Multi-angle generative outputs are not guaranteed geometrically identical.

## OpenAI BYOK

Deploy the `studioOpenAI` HTTPS function to `stock-image-studio` using an
authorized Firebase account. Firebase requires the Blaze plan for Cloud
Functions. The deploy targets the function only and leaves existing Firestore
rules in place.

```bash
npm ci --prefix functions
firebase deploy --project stock-image-studio --only functions:studioOpenAI
```

The function accepts Firebase ID tokens and forwards requests only to OpenAI.
Enter an OpenAI project API key in **Settings → OpenAI · BYOK** after Firebase
sign-in. The key is held in memory, cleared on sign-out or reload, and sent
over HTTPS only to the function per request. Verification checks model
metadata without generating an image. The Generator can create and download
one PNG at a time. Save larger jobs as drafts. Images stay in the current tab
until downloaded. Model access, billing and quotas depend on the OpenAI project.
