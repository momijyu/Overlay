<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Overlay project rules

Before making changes, read `PROJECT.md` and `software_creation_plan.txt`.
When they conflict, follow `PROJECT.md` and the user's latest instruction.

Keep application code in TypeScript. Use the single Next.js application for both
frontend and backend responsibilities, with Route Handlers under `src/app/api`.
Use Tailwind CSS and daisyUI for general UI, and avoid implementing features from
future development phases before they are requested.
