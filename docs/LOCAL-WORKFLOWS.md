# Local knowledge and research workflows

The `local-knowledge` mod provides a private profile-specific library of text, Markdown, imported public pages and saved research. Import content or a URL in settings; URL imports use the existing public-web fetcher, with private networks, unsupported media and oversized responses rejected. Records retain their source URLs, retrieval date and file-name or research provenance. Notes are limited to 1 MiB each, with 1000 documents and 32 MiB of content per profile. SQLite files are owner-only.

AI conversations can search and read the current profile's library with `knowledge_search` and `knowledge_read`. Tool input cannot switch profiles. Full document views preserve Markdown citations. Importing and removing knowledge are local administration actions in settings.

The `local-workflows` mod adds manual research and interval schedules. A research job uses the selected AI provider and the same local read tools used in chat, then saves its Markdown answer and observed source URLs to that profile's knowledge library. Native browser actions and ToolSearch are unavailable in this runner. Remote connector tools must explicitly advertise a boolean `readOnlyHint: true`; missing hints and write tools are excluded. The bridge checks that restriction again when executing each tool. Spark send, draft, triage, assignment, comment and calendar mutation tools are consequently unavailable to these jobs.

Schedules default to **disabled**. Enable a schedule explicitly in settings after reviewing its prompt and interval. Supported intervals range from five minutes to one year. Enabled schedules run while the custom bridge is running, using the provider currently selected at run time. Restarting the browser skips missed intervals; it does not replay a backlog. A pending run prevents overlapping runs for that schedule, with at most three research jobs active overall. Each run's status, next run and resulting knowledge document ID are persisted. No real schedules were created or enabled during implementation testing.

The settings page polls the following local administration APIs:

| Route | Method | Result |
| --- | --- | --- |
| `/api/knowledge?profileID=Work` | GET | `{documents}` |
| `/api/knowledge` | POST | Import `{profileID,title,content?,url?,fileName?}`; returns `{document}` |
| `/api/knowledge/<id>?profileID=Work` | GET / DELETE | `{documents}` / `{deleted}` |
| `/api/research` | POST | Start `{profileID,title,prompt}`; returns HTTP 202 `{job}` |
| `/api/workflows?profileID=Work` | GET | `{workflows}` |
| `/api/workflows` | POST | Save `{id?,profileID,title,prompt,intervalMinutes,enabled}`; returns `{workflow}` |
| `/api/workflows/<id>/run` | POST | Run once with `{profileID}`; returns HTTP 202 `{job}` |
| `/api/workflows/<id>?profileID=Work` | DELETE | Remove a schedule; returns `{deleted}` |
| `/api/workflows/runs?profileID=Work` | GET | `{runs}`, newest first |

These are local research and indexing features. Official Dia account and browser Sync are not involved.
