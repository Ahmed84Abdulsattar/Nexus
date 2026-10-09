# Getting started: Nexus with Claude Code in VS Code

This file covers setting up your machine, creating the repo, checking the agents, and starting the first sprint. `PROMPTS.md` has the prompts to use after that.

## Pending
- **Docker engine not running yet** on Ahmed's laptop: the Windows "Virtual Machine Platform" feature is off (needs admin or Innovo IT, plus a restart). Once Docker Desktop shows **"Engine running"**, run the schema check: start a throwaway `postgres:16` container, apply `db/schema.sql` then `db/roles.sql`, report the result, then remove the container. Do this before Prompt 2 (local database).

---

## Step 1: Install the tools (once per machine; you and your colleague both do this)
| Tool | Why | How |
|---|---|---|
| **VS Code 1.94 or later** | Editor | code.visualstudio.com |
| **Git** (Windows: **Git for Windows**) | Repo; lets Claude Code use Bash on Windows | git-scm.com |
| **Node.js 22 LTS** | Runs the project | nodejs.org (or `nvm`) |
| **pnpm** | Package manager for the monorepo | `corepack enable` then `corepack prepare pnpm@latest --activate` |
| **Docker Desktop** | Local PostgreSQL 16 | docker.com |
| **Claude account** | Claude Code needs a paid plan: **Pro, Max, Team or Enterprise** (or a Claude Console account). The free plan has no Claude Code. | claude.ai |

## Step 2: Install Claude Code in VS Code
1. In VS Code press **Ctrl+Shift+X** (Mac: Cmd+Shift+X), search **"Claude Code"** (publisher Anthropic) and click **Install**.
   If it doesn't appear afterwards: Command Palette → **Developer: Reload Window**.
2. **Recommended: also install the standalone CLI.** You need it to run `claude` in VS Code's terminal. The panel offers only a subset of commands, and the terminal has all of them (for example `/agents`):
   - Windows PowerShell: `irm https://claude.ai/install.ps1 | iex`
   - macOS / Linux / WSL: `curl -fsSL https://claude.ai/install.sh | bash`
   - Then open a new terminal and run `claude --version` to check it.
3. The extension and the CLI share conversation history. You can continue an extension chat in the terminal with `claude --resume`.

## Step 3: Create the repo and add the pack
1. Create a **private** GitHub repo called `nexus` (in Innovo's GitHub organisation if there is one) and clone it:
   ```
   git clone https://github.com/<org>/nexus.git
   cd nexus
   ```
2. Unzip `nexus-agent-pack.zip` and copy **everything inside the `nexus-agent-pack` folder** into the repo root, including the hidden `.claude/` folder and `.gitignore`.
   You should see `CLAUDE.md`, `GETTING-STARTED.md`, `PROMPTS.md`, `.claude/`, `docs/` and `db/`.
3. Commit and push:
   ```
   git add .
   git commit -m "docs: Nexus agent pack (docs, agents, schema)"
   git push
   ```
4. On GitHub, protect `main`: require a pull request and 1 review before merging.
5. Your colleague clones the same repo on his machine and does Steps 1, 2 and 4.

## Step 4: Open the project in VS Code and sign in
1. **File → Open Folder → `nexus`.** Open the folder itself, not a parent folder, so Claude finds `CLAUDE.md` and `.claude/`.
2. Open Claude Code: click the **Spark icon** in the editor toolbar (top-right, shown when a file is open) or in the Activity Bar (left).
3. The first time, click **Sign in** and finish in the browser.

## Step 5: Check that Claude sees the project and the agents
In the Claude panel, type:
```
Read CLAUDE.md and docs/00-README.md. In 5 lines, tell me what Nexus is and list the project agents you can use.
```
It should name the 8 agents: **architect, datoms-integration, backend-api, database, frontend, devops, qa, security-reviewer**.
- In the prompt box you can type `@agent-` to see them in the autocomplete list.
- In the terminal (`claude`), the command `/agents` lists and edits them.
- If an agent is missing, run **Developer: Reload Window**. A brand-new `.claude/agents` folder is picked up only after a restart.

## Step 6: How to talk to the agents
- **Call an agent by name:** "Use the architect agent to …". **To make sure** that agent is used: `@agent-architect …`.
- **Plan first** for anything big: type `/plan <task>`, or switch the mode at the bottom of the prompt box to **Plan**. Claude shows its plan, and you approve or edit it before any code is written.
- **Permission mode:** keep **Ask before edits** for the first few tasks so you see every change. Switch to auto-accept edits once you trust the flow. `.claude/settings.json` already allows lint/test/build commands without asking, and **blocks reading and editing `.env` files**.
- **Give context with @:** `@docs/09-map-arcgis.md` or `@apps/web/src/components/map/` to point at files.
- **One task per conversation.** Open a new tab per backlog task, so each task starts with a clean context.
- **Checkpoints:** hover over a message and use the rewind button to undo Claude's file edits back to that point.
- **Several agents at once:** Claude can run agents in parallel. The agent count at the bottom of the prompt box opens a map of running agents. Example: "Use the qa agent and the security-reviewer agent in parallel to review this branch."

## Step 7: First day, in order
| # | Do | Prompt (from PROMPTS.md) | You check |
|---|---|---|---|
| 1 | Architecture check | **Prompt A** | Read the concerns. Accept or reject each one; update the docs if you change anything. |
| 2 | Plan sprint S0 | **Prompt B** with `S0` | `docs/sprints/S0.md` has tasks, owners and acceptance checks |
| 3 | Repo skeleton | **Prompt 1** | `pnpm install`, `pnpm dev`, `pnpm test` and `pnpm build` all work |
| 4 | Local database | `docker compose up -d`, then **Prompt 2** | `pnpm db:migrate` and `pnpm db:check` pass, and the seed timings look like docs/06 section 6 |
| 5 | Commit | — | One PR per task, with the backlog ID in the title |

Your colleague starts on the frontend shell (**Prompt 7**) as soon as the skeleton from item 3 is merged. He works against MSW mocks until the API exists.

## Step 8: Daily workflow (each task)
```
git checkout main && git pull
git checkout -b S2-03-portfolio-map
```
1. **Plan:** `/plan` + "Use the architect agent: break down S2-03 from docs/sprints/S2.md."
2. **Build:** "Use the frontend agent to implement S2-03 as planned." (or backend-api, datoms-integration, …)
3. **Test:** "Use the qa agent to check S2-03 against its acceptance check."
4. **Security** (auth, access, secrets, infra, export): "Use the security-reviewer agent on this branch."
5. **You review the diff** in VS Code's Source Control view. Run the app yourself.
6. Commit, push, open a PR, and the other person reviews it. Merge.

## Step 9: Rules that keep it working
- **Secrets:** the DATOMS token and ArcGIS key go only in your local `.env` (git-ignored, blocked for Claude) and in Key Vault for the cloud. Never paste them into the chat.
- **Docs are the source of truth.** If you decide something new, ask the architect agent to update the doc or write an ADR in the same PR.
- **When Claude repeats a mistake,** add one line to `CLAUDE.md` so every agent learns it.
- **Open questions** (`docs/open-questions.md`): update them when DATOMS or Innovo answers, then tell the architect agent to update the affected docs.
- **Sprint sheet changes:** regenerate `docs/source/backlog.md` from the sheet with `python scripts/gen-backlog.py` (needs `python -m pip install --user openpyxl` once), then check `git diff docs/source/backlog.md` shows only the rows you changed.
- **Two sessions at once on one machine** (optional): use git worktrees so they don't edit the same files:
  ```
  git worktree add ../nexus-s3-worker -b S3-03-live-poll
  ```
  Open that folder in a second VS Code window.

## Before cloud work (ask Innovo IT; not needed for local work)
- An Azure subscription / resource group in **UAE North**, plus permission to create resources.
- Entra ID app registrations `nexus-api` and `nexus-web`, and the security groups (docs/08).
- An ArcGIS account or organisation (open question Q4) and an API key.
- A DATOMS token, plus a test organisation if possible (Q7).
