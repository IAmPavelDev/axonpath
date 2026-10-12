# Axon — Analytics & Observability handbook

> Created 2026-10-10. What is measured, where each signal lands, and how to
> display it. Backend AI metrics = Postgres (`AiAttempt`); user behavior =
> Firebase Analytics; infra = CloudWatch (see DEPLOY_AWS_SERVERLESS.md §2a).

## The three surfaces

| Surface | Data | Login | Free forever |
|---|---|---|---|
| **Grafana Cloud** (recommended add) | `AiAttempt` SQL panels via Neon Postgres datasource + Lambda metrics/logs via CloudWatch datasource | Built-in users/orgs | Yes — 3 users, 10k series, 50 GB logs ([limits](https://grafana.com/docs/grafana-cloud/account-management/usage-limits/)) |
| **Firebase console** | Behavior events, DAU/engagement, funnels, retention, geo, device | Google account (project axon-9e88e) | Yes, unlimited events |
| **psql / Neon SQL editor** | Ad-hoc queries against the query pack below | Neon credentials | Yes |

## Lane 1 — behavior events (Firebase Analytics, mobile)

Wired in `apps/mobile/lib/analytics.ts` (`track`, `trackScreen`); userId bound
in `store/auth.store.ts`. Auto-collected with zero code: app_open/session
frequency, engagement seconds, DAU/MAU/retention, country/city, device model,
OS version, app version, language.

| Event | Params | Fired at |
|---|---|---|
| `screen_view` | route name | `app/_layout.tsx` on every pathname change (signed-in only) |
| `class_view` | class_id, skill_id | class screen mounts (`app/class/[classId]/index.tsx`) |
| `conspect_read` | class_id, seconds, scroll_progress (0..1) | conspect→quiz tab flip or leaving the screen mid-read |
| `quiz_opened` | class_id, seconds_since_class_view | conspect→quiz tab flip (<10 s ⇒ jumped straight to quiz) |
| `quiz_completed` | class_id, seconds, correct, total | grading fully resolved after a submit; also fills `Answer.timeSpentMs` (evenly distributed per answer) |
| `lesson_opened` | class_id, seconds_since_created | ClassList tap (server `createdAt` is truth; <60 s ⇒ opened immediately) |
| `generation_requested` | skill_id | manual direction commit in NewClassOptions |

Firebase setup that pays off: Events → mark `seconds`, `scroll_progress`,
`seconds_since_created` as custom dimensions (50 free) to see distributions;
Funnels: `class_view → quiz_opened → quiz_completed`. Optional: link Firebase
→ BigQuery (free) for raw event SQL.

## Lane 2 — AI attempt metrics (Neon, `AiAttempt` table)

One row per provider call attempt, written fire-and-forget by the injected
`recordAiAttempt` dep (impl: `modules/tutoring/infrastructure/ai-attempt.repo.ts`),
wired into all five operations (init_skill, skill_description, next_class,
class_options, grade_open, qa_answer) plus container + loop-test fakes.

- `PROMPT_VERSION` (`domain/prompts.ts`) and `PARSER_VERSION`
  (`domain/parse.ts`) — **bump on every prompt/parser change**; effectiveness
  = compare outcome rates across versions.
- `outcome`: `ok | parse_failed | empty | length_capped | transport_error |
  balance_error` (1113 = z.ai balance exhausted).
- Raw outputs remain in the audit events (SKILL_CREATED, QA_ANSWERED, …) for
  output-quality diffs; `stats.report` already totals cost per operation.

### Query pack (Neon SQL editor or psql)

```sql
-- Daily success rate per operation
SELECT operation, date_trunc('day', "createdAt") AS day,
       count(*) FILTER (WHERE outcome = 'ok') AS ok,
       count(*) FILTER (WHERE outcome = 'parse_failed') AS parse_failed,
       count(*) FILTER (WHERE outcome IN ('transport_error','balance_error')) AS errored,
       round(100.0 * count(*) FILTER (WHERE outcome = 'ok') / count(*), 1) AS ok_pct
FROM "AiAttempt" GROUP BY 1, 2 ORDER BY 2 DESC, 1;

-- Effectiveness by prompt/parser version (the prompt-change scoreboard)
SELECT operation, "promptVersion", "parserVersion", outcome,
       count(*) AS n,
       round(avg("latencyMs")) AS avg_ms,
       round(avg("rawChars")) AS avg_raw_chars
FROM "AiAttempt" GROUP BY 1, 2, 3, 4 ORDER BY 1, 2, 3, 4;

-- Attempts-to-success: how many tries does an operation need?
SELECT operation, attempt, outcome, count(*)
FROM "AiAttempt" GROUP BY 1, 2, 3 ORDER BY 1, 2;

-- Slow calls (p50/p95 per operation, last 7 days)
SELECT operation,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY "latencyMs") AS p50,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY "latencyMs") AS p95
FROM "AiAttempt" WHERE "createdAt" > now() - interval '7 days'
GROUP BY 1;
```

### Learner metrics (Grafana "Learners" row)

Vocabulary: a **Skill** is what the UI calls a "class" (a topic card);
each **Class** is a "lesson" (conspect + quiz).

```sql
-- Total users + new users per week
SELECT count(*) AS users FROM "User";
SELECT date_trunc('week', "createdAt") AS week, count(*) AS new_users
FROM "User" GROUP BY 1 ORDER BY 1;

-- Classes (skills) per user, average + per-user
SELECT round(avg(cnt), 2) AS avg_classes_per_user FROM
  (SELECT count(*) AS cnt FROM "Skill" GROUP BY "userId") t;
SELECT u.id AS user_id, count(s.id) AS classes
FROM "User" u LEFT JOIN "Skill" s ON s."userId" = u.id
GROUP BY u.id ORDER BY classes DESC;

-- Lessons per class (topic)
SELECT "skillId" AS class_id, count(*) AS lessons
FROM "Class" GROUP BY 1 ORDER BY lessons DESC;

-- Lessons per user
SELECT s."userId" AS user_id, count(c.id) AS lessons
FROM "Class" c JOIN "Skill" s ON s.id = c."skillId"
GROUP BY 1 ORDER BY lessons DESC;

-- New lessons per user per week
SELECT s."userId" AS user_id, date_trunc('week', c."createdAt") AS week,
       count(*) AS new_lessons
FROM "Class" c JOIN "Skill" s ON s.id = c."skillId"
GROUP BY 1, 2 ORDER BY 2 DESC, 1;

-- New classes (skills) per user per week
SELECT "userId" AS user_id, date_trunc('week', "createdAt") AS week,
       count(*) AS new_classes
FROM "Skill" GROUP BY 1, 2 ORDER BY 2 DESC, 1;
```

Logins per user per week live in **Firebase**, not Postgres (auth never
touches the backend): the `login` event fires on real sign-ins
(`app/login.tsx`, email + Google) with a `method` param. Console:
Analytics → Events → `login` (totals per day). Per-user-per-week breakdown
needs the free Firebase → BigQuery export (`Events_<date>` table,
`user_id` + event name).

### Grafana Cloud setup (one-time, ~15 min)

1. grafana.com → free account (org slug of your choice) → 3 users included.
2. Connections → **Postgres**: host = `ep-jolly-boat-b1hgyqni-pooler.c-5.eu-central-1.aws.neon.tech`, port `5432`, database `neondb`, user = a **read-only** role. Create it once in the Neon SQL editor:
   ```sql
   CREATE ROLE grafana_reader LOGIN PASSWORD '<generate-a-long-password>';
   GRANT USAGE ON SCHEMA public TO grafana_reader;
   GRANT SELECT ON ALL TABLES IN SCHEMA public TO grafana_reader;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO grafana_reader;
   ```
   (Neon requires TLS — enable the SSL/TLS toggle in the datasource.)
3. Connections → **CloudWatch**: AWS IAM role with `cloudwatch:GetMetricData`,
   `logs:StartQuery/GetQueryResults` on the `axon-*` log groups → panels for
   `Axon/Api Requests`, `Axon/Api Server5xx`, `Axon/Backend Errors`.
4. Dashboards: "AI effectiveness" (the query-pack panels, variables on
   operation + version), "API health" (requests/5xx/latency), "Learners"
   (Firebase panels are console-side; BigQuery datasource can join them later
   on `user_id` = Firebase uid).
