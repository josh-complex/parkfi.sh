<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

## The Living Layer / Kingdom Hearts initiative

The in-park game initiative is documented at `docs/plans/living-layer/`.
Before reading or editing anything there (docs **or** the `src/server/living/`
/ `living` router code):

- **`docs/plans/living-layer/GDD.md` is canon and wins** over the numbered
  docs and the code. Design changes update the GDD first (with a Canon
  Decision Log entry), in the same change.
- **Read the authority ladder in `docs/plans/living-layer/README.md` first.**
  Some docs there are frozen research records or unadopted proposals — they
  read like instructions but must not be followed as build orders.
- Current build status lives in **GDD §10** only; the adopted build order is
  the workstream list at the top of doc 14 (not doc 14's M-numbered sections).
