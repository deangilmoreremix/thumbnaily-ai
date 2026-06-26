# Supabase CLI

This directory is managed by the [Supabase CLI](https://supabase.com/docs/guides/cli).

## First-time setup

```bash
# 1. Log in (opens browser)
pnpm db:link

# 2. Link to your remote project (gets the project ref from your Supabase dashboard URL)
pnpm exec supabase link --project-ref <your-project-ref>

# 3. Apply migrations to remote
pnpm db:push
```

## Common commands

| Command | Purpose |
|---|---|
| `pnpm db:start` | Boot local Supabase stack (Docker required) |
| `pnpm db:stop` | Stop local stack |
| `pnpm db:status` | Show local stack status & creds |
| `pnpm db:push` | Apply pending migrations to linked project |
| `pnpm db:reset` | Reset local DB and re-apply all migrations + seed |
| `pnpm db:diff -f <name>` | Generate a new migration from local schema drift |
| `pnpm db:new <name>` | Create an empty migration file |
| `pnpm db:types` | Regenerate TypeScript types from remote schema → `apps/web/types/supabase.ts` |

## Adding a new migration

```bash
pnpm db:new add_user_credits
# Edit supabase/migrations/<timestamp>_add_user_credits.sql
pnpm db:push    # applies to remote
```

## Local development

```bash
pnpm db:start           # boots Postgres + Studio + Auth on localhost
# ...develop...
pnpm db:diff -f my_change   # capture schema changes
pnpm db:reset           # re-apply all migrations cleanly
```
