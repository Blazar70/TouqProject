# Schema — the rules of this map

## Card types

| `type:` | Lives at | Carries |
|---|---|---|
| object | `objects/<cluster>/<slug>.md` | one noun: why, shape, connections, Hits / Does not hit |
| process | `processes/<slug>.md` | one real movement: Input, Movement, Output, steps with citations |

## Labels

`type`, `cluster` (people / care / money / platform), `universe` (live / leftover / ghost), `status` (stub / verified / stale), `entity` (owning source path).

## Naming

- Slugs: kebab-case, singular, matching the table name where there is one (`pets.md`, `medical-records.md`).
- Clusters follow how an editor asks a question, not folder layout.
- Citations are `path:line`, relative to the project root.
