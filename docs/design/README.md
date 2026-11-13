# Bauherr design system

The design system is one file: [`DESIGN.md`](../../DESIGN.md) at the repository root (tokens, principles, components, Product patterns).

This folder keeps what it does not hold:

- `tokens.json`: source of the tokens; `pnpm --filter server tokens` compiles it to `tokens.css`, `pnpm --filter server design:check` checks that `DESIGN.md` equals it.
- `components/{Button,Cover,Gate,StatusChip}`: component guidelines and previews. The previews expect the compiled token variables (`--<token>`) and the type-style classes.
- `assets/`: logos and brand images.
