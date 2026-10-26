# Install, one-time setup and diagnostics

[← README](../README.md)

## Requirements

- **macOS** for the official installer; Node.js >= 22.19.0, npm and Git
- [Pi](https://github.com/earendil-works/pi), tmux and [workmux](https://workmux.dev/)
- Homebrew is used by the **official installer only when a dependency is missing**. It will not install Homebrew itself, replace a version-manager Node installation, alter PATH/shell startup files or overwrite unrelated `pic` executables.
- Pi provider authentication and model selection are still handled by Pi using `/login` and `/model`.

## Path A — official main branch

```bash
curl -fsSL https://raw.githubusercontent.com/SEONGMINY/pi-compose/main/scripts/install.sh | bash
```

This script resolves and installs the current **main HEAD**, not the draft PR #3 version. It installs missing CLI dependencies, avoids overwriting existing Pi versions/settings, and verifies the global `pic` command. Its new one-time setup instructions take effect **after this PR is merged**, not before.

## Path B — current draft PR #3

**Preferred:** run the guarded installer from the PR #3 branch, with an explicit branch override. This offers the same missing dependency preparation and executable conflict checks as the official main installer, but resolves **PR #3**, not main.

```bash
curl -fsSL https://raw.githubusercontent.com/SEONGMINY/pi-compose/feat/task-hub-ghostty/scripts/install.sh \
  | PIC_COMPOSE_REF=feat/task-hub-ghostty bash
```

**Alternative:** install the development branch directly with npm if Pi, Git, tmux and workmux are already installed:

```bash
npm install -g --ignore-scripts --no-audit --no-fund \
  "git+https://github.com/SEONGMINY/pi-compose.git#feat/task-hub-ghostty"
```

The **direct npm command** requires compatible Node, Pi, tmux and workmux to already be installed, and it does not offer the install script's collision checks. To pin an exact release candidate, replace `feat/task-hub-ghostty` with the final 40-character PR #3 commit SHA. Both routes support first-run setup. The direct command intentionally uses `--ignore-scripts`; setup lives in **`pic`, not npm postinstall**, so both install paths behave the same.

## First interactive launch

```bash
cd ~/projects/my-app
pic
```

For first-time users without the recommended Pi Packages/Hook, the terminal displays roughly:

```text
Pi Compose recommended setup (one-time):
Child Pi navigation: new Pi package
Handoff + Verify: new Pi package
workmux Pi Hook: optional workmux setup
Pi packages affect normal pi too.
Prepare the missing recommended features? [Y/n]
```

- **Y / Enter:** `pi install` adds missing local Navigation and Handoff/Verify Packages to Pi's global settings; any existing Pi package settings, skills, models and themes are preserved.
- **N:** skip optional setup. Core Launch/Compose remains available. This decision is remembered to avoid nagging.
- If the Pi status Hook was not detected, a **separate [y/N]** question offers `workmux setup`. This can also offer configuration for other detected coding agents: review its own prompts carefully and choose Pi only if desired.
- Installed Packages are also visible in normal **`pi`** sessions, not only `pic`. This is why first-time setup explicitly asks permission.
- Pi's current process may need `/reload` after setup. Pi opened **after** setup loads the new Extensions without reloading.

No Agent, Git branch, Worktree or model login is created by initial setup.

## Already installed / upgrading

- **Existing Pi:** existing settings and registered Extension/Skill/Theme stay in place. Only an expressly approved missing Package is installed.
- **Existing Pi Compose:** the first run of the new wrapper offers the recommended setup once if components are missing. If packages were installed earlier, they are not reinstalled. Existing `pi config` resource exclusions are left unchanged.
- **Partial setup:** `pic setup` inspects missing steps and can install only those after consent. A failed step does not roll back successfully completed earlier steps.
- **Project-scoped Pi packages:** previously configured `.pi/settings.json` sources are detected as `project-only` and not silently duplicated into global Pi settings. Another Git Worktree might not inherit that project's package declaration; choose an explicit global Navigation install if you need cross-worktree access.
- **Repeat installs:** the official installer reinstalls Pi Compose at the resolved commit only; it doesn't reset onboarding or the Pi resource filters. Direct PR #3 updates use `npm install -g` with the newer SHA/branch, again without postinstall.
- **Previously declined:** no repeated prompt on future launches; run `pic setup` explicitly when ready.
- **Existing running Pi sessions:** enter `/reload` to load newly configured Extensions; starting a new agent/session loads them without user intervention.

## Check state and fix problems

```bash
pic doctor    # read-only, including versions, Pi packages and Pi Hook detection
pic setup     # interactively repair missing recommended components
pic config    # Pi's own per-extension enable/disable UI
```

`pic doctor` distinguishes **configured**, **missing**, and **custom resource filters**. A configured package or a detected workmux status file is not proof that a running Pi process actually loaded that Extension. Use `pi config` to see detailed enabled/disabled resources and `/reload` to apply changes to a running Pi.

```bash
pic navigation disable   # explicitly remove child navigation from Pi settings
pic navigation enable    # explicitly add it again
pic features             # open Pi's own optional feature configuration
```

To remove Handoff/Verify Package entirely, use Pi's built-in package manager (`pi list` to view its exact installed source, then `pi remove <source>`), or disable individual resources in `pi config`.

### Troubleshooting

| Problem | What to check |
| --- | --- |
| `pic: command not found` | `npm config get prefix` and its `bin` on PATH, and executable conflicts |
| Node version unsupported | Node >= 22.19.0 selected in the existing version manager |
| Pi/tmux/workmux missing | Run official installer or install the missing binary; `pic doctor` reports failures |
| Global `pi install` permission error | Pi settings file location (`PI_CODING_AGENT_DIR` if set), folder access; retry `pic setup` |
| `/compose` missing in Child Pi | `pic doctor`, verify Navigation via `pi config`, then `/reload` or restart child Pi |
| workmux Dashboard empty | `pic doctor` Hook state; `pic setup` → consent to `workmux setup` and Pi integration; Dashboard still cannot prove development completion |
| `/compose-handoff` missing | `pi config` whether Handoff/Verify resource is enabled, then `/reload` |
| setup partially failed | `pic doctor` then `pic setup`. Do not remove existing folders, sessions or worktrees |
| Pi settings cannot be parsed | Correct malformed Pi settings using Pi's own commands/manual inspection; setup refuses to rewrite the file |
| No setup prompt | This is expected after accepting/declining once; `pic setup` always opens explicit configuration |

## After installation

Continue with [five realistic project scenarios](SCENARIOS.md) or the [command guide](USAGE.md).