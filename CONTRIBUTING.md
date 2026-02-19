# Contributing to Aries

Thanks for your interest in contributing! Aries is an open-source project and we welcome PRs, bug reports, and feature ideas.

## Ground Rules

1. **Zero dependencies** — This is non-negotiable. Use only Node.js built-in modules (`http`, `fs`, `crypto`, `child_process`, `os`, `path`, `url`, `zlib`, `stream`, `events`, `util`, `readline`, `net`, `tls`, `https`, `cluster`, `worker_threads`). No npm packages.

2. **Keep it clean** — No credentials, API keys, or personal data in commits. Use `config.example.json` for reference configs with empty values.

3. **Test before submitting** — Run `node launcher.js` and verify your changes work. Test on at least one OS.

## How to Contribute

### Bug Reports

Open an [issue](https://github.com/dsfgsdgf33/aries/issues) with:
- What happened vs. what you expected
- Steps to reproduce
- Node.js version and OS
- Relevant error output

### Feature Requests

Open an [issue](https://github.com/dsfgsdgf33/aries/issues) with a clear description of the feature and why it's useful.

### Pull Requests

1. **Fork** the repository
2. **Branch** from `main`: `git checkout -b feat/my-feature` or `fix/my-bug`
3. **Make your changes** — keep commits focused and descriptive
4. **Test** — `node launcher.js` and exercise the feature
5. **Submit** a PR with:
   - What the change does
   - Why it's needed
   - How you tested it

### Branch Naming

- `feat/description` — new features
- `fix/description` — bug fixes
- `docs/description` — documentation changes
- `refactor/description` — code restructuring

## Code Style

- **No semicolons** are enforced, but be consistent within a file
- Use `const`/`let`, never `var`
- Prefer `async/await` over raw callbacks
- Keep functions focused — one function, one job
- Add comments for non-obvious logic
- Use descriptive variable names

## Project Structure

```
core/       — Backend modules (AI, API, RAG, scheduler, etc.)
web/        — Frontend (dashboard HTML/CSS/JS)
extensions/ — Browser extension
docs/       — Documentation
plugins/    — Plugin directory
```

## Adding a New Core Module

1. Create `core/my-module.js`
2. Export an `init(config)` function
3. Register it in the loader (see existing modules for pattern)
4. Add config options to `config.example.json`
5. Document it in the README

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
