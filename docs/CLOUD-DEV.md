# Developing ATiMs in the cloud (Claude Code on the web)

Claude Code on the web runs each task in a cloud VM that Anthropic hosts. It is **included in the Claude Pro plan**: there is no charge for the VM, and usage counts against the same Pro limits as the rest of Claude. Your PC can be off. You can start, steer and review tasks from a browser or the Claude mobile app.

Each task gets its own branch. You review the changes and click **Create PR**, then merge on GitHub. Merging to `main` deploys to Railway automatically.

## One-time setup (about 15 minutes)

### 1. Open Claude Code on the web
1. Go to **https://claude.ai/code** and sign in with the account that has your Pro plan.
2. When asked, **connect GitHub** and authorise the Claude app.

### 2. Install the Claude GitHub App on the repo
This lets cloud sessions push branches and open pull requests.
1. When claude.ai/code prompts you to install the GitHub App, click it. You can also go to **https://github.com/apps/claude** and click **Install** or **Configure**.
2. Choose your account **mealand**.
3. Select **Only select repositories** and pick **atims-sprezzint**.
4. Click **Install**.

### 3. Configure the environment
In claude.ai/code, open the **environment selector** (next to the repo picker) and edit the **Default** environment. If you prefer, create a new one called `atims`.

| Setting | Value |
|---|---|
| Network access | **Limited**, with **Allow package managers** ticked |
| Allowed domains (one per line) | `*.railway.app`<br>`atims.sprezzint.com`<br>`*.opentimestamps.org`<br>`*.eternitywall.com`<br>`ots.btc.catallaxy.com`<br>`api.resend.com` |
| Setup script | `if [ -d atims-sprezzint ]; then (cd atims-sprezzint && bash scripts/cloud-setup.sh); fi` |
| Environment variables | leave empty |

Save. The script runs from the home folder (`/home/user`) and the repo is cloned one level down, hence the `cd`. It installs dependencies, starts the VM's PostgreSQL, creates a local `atims` database, writes a throwaway `api/.env` and runs the migrations. It never touches production.

**Secrets rule:** ordinary environment variables are readable by anyone who uses the environment. When a task truly needs a real key (for example, the email API key later), add it as a **Network secret** bound to its host. Never put real keys in environment variables or in the repo, because the repo is public.

### 4. Smoke test
1. In claude.ai/code, pick the repo **mealand/atims-sprezzint** and branch **main**.
2. Send this task:
   > Run the setup script if it has not run, then run `npm test -w @atims/api` and `npm run build` and report the results. Do not change any files.
3. You should see 23 passing tests and a successful build. If the setup script fails, open the session's log and send it to Claude (locally or in a new cloud session) to fix.

## Daily workflow

1. **One task per session.** Describe the task clearly, for example "Implement the access service from the MVP plan with tests". `CLAUDE.md` in the repo gives every session the project context.
2. Claude works on its own branch and shows a **Changes** card. Review the diff.
3. Click **Create PR**. GitHub CI runs the tests on the PR.
4. Review on GitHub and **merge** when CI is green. Railway deploys `main` within a few minutes.
5. Check the live site.

Tips:
* **Several tasks can run in parallel** if they touch different files. They all draw on the same Pro limits, so limits run down faster.
* **From your phone:** open the Claude app and go to the **Code** tab to start or steer sessions.
* **Continue locally:** run `claude --teleport` in your local checkout to pull a cloud session into the terminal. The branch must be pushed and your working tree clean.
* **Start a cloud task from the terminal:** `claude --cloud "task description"`. It uses the GitHub version of your branch, so push first.
* A cloud VM pauses when idle and can be recycled. Anything started inside it, such as the database, is rebuilt by the setup script next time. That is expected.

## Limits worth knowing

* VM: about 4 CPUs, 16 GB RAM and 30 GB disk. Docker is available.
* Long commands run in the background for up to about 30 minutes.
* `gh pr` and `gh issue` commands do not work behind the cloud proxy. Use the **Create PR** button instead.
* The cloud VM has PostgreSQL 16, while production runs 18. Normal SQL works on both.
* Your local Claude Code memory and settings do not carry over to the cloud. That is why `CLAUDE.md` is in the repo.

## Fallback: GitHub Codespaces

If claude.ai/code is ever unavailable, open the repo in a GitHub Codespace (120 free core hours a month on a personal account) and install Claude Code there with `npm install -g @anthropic-ai/claude-code`. Then run `bash scripts/cloud-setup.sh` and sign in with `claude` using your Pro account. Do not set `ANTHROPIC_API_KEY` there, because that bills the API instead of your Pro plan.

Cloud environment last verified: 2026-11-20.
