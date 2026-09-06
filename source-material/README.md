# source-material

Drop the NCERT PDFs referenced in `manifest.json` here before running
`npm run migrate:vectors`. This folder (except `manifest.json` and this file)
is git-ignored — PDFs are large binary assets and should not be bundled into
the frontend build or the git repo. Store the PDFs themselves in Cloudflare R2
or your own storage once migrated, per `VECTOR_MIGRATION.md`.
