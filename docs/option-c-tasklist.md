# Option C — Implementation Task List

> **Goal**: ship the UI changes mocked in `docs/mockups/c-*.html` — global project switcher, normalized health/op/work status vocabulary, and management-focused project detail page.
>
> **Philosophy**: additive, incremental, reversible. Each phase ships value on its own. No data migration — display-layer only for status renames. No backend data-model changes until Phase 5.
>
> **Estimated total**: ~8 working days for a single engineer. Phase 1–2 alone (~3 days) already delivers the largest visible improvement.

---

## Phase 1 — Foundation (prereqs) · ~1.5 days

Everything else depends on these. Ship this phase before starting on any list/detail pages.

### 1.1 — Create status translation helpers
**File**: `dashboard/src/lib/status.ts` (new)
- [ ] Export `healthFromServerStatus(status)` → `'healthy' | 'at-risk' | 'critical' | 'unknown'`
- [ ] Export `healthFromDomainStatus(status)` → same shape
- [ ] Export `opStateFromServerStatus(status)` → `'up' | 'down'`
- [ ] Export `opStateFromDomainStatus(status)` → same
- [ ] Export `workStateFromFindingStatus(status)` → `'new' | 'in-progress' | 'resolved' | 'dismissed'`
- [ ] Unit tests cover every existing backend status value → new label mapping (see mapping table in `option-c-switcher-statuses.html`).
- **Acceptance**: storing stays untouched; only display labels normalize.

### 1.2 — Build chip primitives
**File**: `dashboard/src/components/status/` (new folder)
- [ ] `<HealthChip health="healthy|at-risk|critical|unknown" />`
- [ ] `<OpStateChip state="up|down" />`
- [ ] `<WorkStateChip state="new|in-progress|resolved|dismissed" />`
- [ ] Each reads from shared color tokens (green / amber / red / grey).
- [ ] Storybook-style example page at `/__design/status` (dev-only) to verify visuals.
- **Acceptance**: `<HealthChip health="at-risk" />` renders the same everywhere.

### 1.3 — Project scope URL hook
**File**: `dashboard/src/lib/useProjectScope.ts` (new)
- [ ] `useProjectScope()` returns `{ projectId: string | null, setProject: (id | null) => void }`
- [ ] Reads / writes `?project=<id>` in the current URL via `useSearchParams`.
- [ ] Preserves other query params across changes.
- [ ] Null means "all projects".
- [ ] Unit tests with `MemoryRouter`.
- **Acceptance**: switching project on /servers then navigating to /domains keeps the `?project=` param.

### 1.4 — ProjectSwitcher component
**File**: `dashboard/src/components/ProjectSwitcher.tsx` (new)
- [ ] Pill-shaped button with project name + green dot + caret, matches mockup CSS.
- [ ] Dropdown lists: "All projects" + each project from `useProjects()` + "+ New project" CTA.
- [ ] Clicking an item calls `setProject()` from `useProjectScope()`.
- [ ] Current selection persisted to `localStorage` as the default on next login.
- **Acceptance**: clicking changes `?project=` in URL and fetches re-run with the new scope.

### 1.5 — ScopeBanner component
**File**: `dashboard/src/components/ScopeBanner.tsx` (new)
- [ ] Takes `{ projectName, counts: { servers, domains, repos } }`.
- [ ] Renders only when a specific project is selected (not "All projects").
- [ ] Shows "Showing **prod** · 14 servers · 9 domains · 8 repos — View all projects" with a clear-scope link.
- **Acceptance**: appears on list pages only when scoped; hides when scope is null.

### 1.6 — Mount the switcher in AppShell
**File**: `dashboard/src/components/AppShell.tsx`
- [ ] Add `<ProjectSwitcher />` in the AppBar, left of the search input.
- [ ] Keep sidebar nav untouched.
- **Acceptance**: every authenticated page shows the switcher in the top bar.

---

## Phase 2 — List pages · ~1.5 days

All four list pages lose their per-page project filter and gain the scope banner + new chips. Each is ~2–3 hours.

### 2.1 — ServersPage
**File**: `dashboard/src/pages/Servers/ServersPage.tsx`
- [ ] Remove the Project `<Select>` dropdown (kept: Tag filter + Status cards).
- [ ] Read `projectId` from `useProjectScope()`; pass it into the server filter predicate.
- [ ] Status cards relabeled: Online→Healthy, Warning→At-risk, Critical→Critical, Offline→Unknown/Down. Counts recomputed via `healthFromServerStatus()`.
- [ ] Each card uses `<HealthChip>` in the label.
- [ ] Per-server row chips: `<HealthChip>` + `<OpStateChip>` instead of raw status string.
- [ ] Render `<ScopeBanner>` at the top when `projectId != null`.
- [ ] Keep tag-chip click-to-filter behavior.
- **Acceptance**: selecting a project in the top bar reduces the servers list; "Critical" card click filters to critical + scoped servers.

### 2.2 — DomainsPage
**File**: `dashboard/src/pages/Monitoring/DomainsPage.tsx`
- [ ] Remove Project dropdown.
- [ ] Same chip swap (`<HealthChip>` + `<OpStateChip>`).
- [ ] Same status-card relabel.
- [ ] Backend already supports `projectId` query — pass through.
- **Acceptance**: domains list reacts to top-bar scope.

### 2.3 — RepositoriesPage
**File**: `dashboard/src/pages/Repositories/RepositoriesPage.tsx`
- [ ] Same pattern.
- [ ] Repo-specific: "Healthy / At-risk / Critical / Unscanned" (map existing state; "Unscanned" = no findings yet).
- **Acceptance**: repos list reacts to top-bar scope.

### 2.4 — FindingsPage
**File**: `dashboard/src/pages/Findings/FindingsPage.tsx`
- [ ] Replace status dropdown with work-state tab row: `○ new | in-progress | resolved | ✕ dismissed` using `<WorkStateChip>`.
- [ ] Each row's status cell uses `<WorkStateChip>`.
- [ ] Scope via URL; drop per-page project filter if present.
- **Acceptance**: clicking a work-state tab changes the visible rows; scope works.

---

## Phase 3 — Detail pages · ~1.5 days

All asset detail pages get the new header chip vocabulary. No structural changes.

### 3.1 — Server detail (Monitoring + Security)
**Files**: `ServerMonitoringPage.tsx`, `ServerSecurityPage.tsx`, `ServerHeader.tsx`
- [ ] Shared header: replace raw status chip with `<HealthChip>` + `<OpStateChip>`.
- [ ] Breadcrumb in AppBar shows `Servers / <hostname>`.
- **Acceptance**: server detail header matches `c-server-detail.html`.

### 3.2 — Domain detail
**File**: `DomainDetailPage.tsx`
- [ ] Replace raw status chip; add op-state chip.
- [ ] Keep SSL grade badge untouched (separate concept).
- **Acceptance**: domain detail header matches `c-domain-detail.html`.

### 3.3 — Repository detail
**File**: `RepositoryDetailPage.tsx`
- [ ] Replace raw status with `<HealthChip>`.
- [ ] Findings table in the detail page uses `<WorkStateChip>`.
- **Acceptance**: repo detail matches `c-repo-detail.html`.

### 3.4 — Finding detail
**File**: `FindingDetailPage.tsx`
- [ ] Replace status chip with `<WorkStateChip>`.
- [ ] Action buttons: "Mark in-progress", "Mark resolved", "Dismiss…" (with reason dropdown: `not-a-risk | accepted | won't fix`).
- [ ] If finding is dismissed, show dismissal reason chip.
- **Acceptance**: work-state mutations write to backend; chip updates immediately.

---

## Phase 4 — Dashboard · ~0.5 day

### 4.1 — Dashboard uses new vocab and scope
**File**: `pages/DashboardOverview/DashboardOverviewPage.tsx`
- [ ] Use `useProjectScope()` to filter all queries.
- [ ] Status-card numbers use `<HealthChip>` labels.
- [ ] Top-risks table row chips use `<HealthChip>` / `<WorkStateChip>`.
- [ ] Render `<ScopeBanner>` when scoped.
- **Acceptance**: dashboard matches `c-dashboard.html`.

---

## Phase 5 — Project detail page rebuild · ~2 days

This is the one section that **needs new backend fields**. Rebuilds the page as a management / configuration view (matches `c-project-detail.html`).

### 5.1 — Backend: extend Project model
**File**: `platform-api/prisma/schema.prisma`
- [ ] Add `description String? @db.Text` (long-form, markdown).
- [ ] Add `color String? @db.VarChar(20)` (hex or preset token).
- [ ] Add `inheritedTags Json @default("[]") @db.JsonB` (array of `{key, value}`).
- [ ] Add `defaults Json @default("{}") @db.JsonB` (flexible bucket: domain check interval, required tag keys, repo scan frequency, auto-dismiss policy).
- [ ] Add `alertRules Json @default("[]") @db.JsonB` (per-rule toggles + delivery channels).
- [ ] `archivedAt DateTime? @map("archived_at")` for archive/delete semantics.
- [ ] Push to local DB with `prisma db push`.
- **Acceptance**: `npx prisma generate` succeeds; API compiles.

### 5.2 — Backend: project detail API
**Files**: `platform-api/src/modules/projects/*`
- [ ] `GET /api/v1/projects/:id` returns the new fields.
- [ ] `PATCH /api/v1/projects/:id` accepts all new fields with Zod validation.
- [ ] `POST /api/v1/projects/:id/archive` → sets `archivedAt`.
- [ ] `POST /api/v1/projects/:id/unarchive` → clears it.
- [ ] `DELETE /api/v1/projects/:id` — existing, but now also unassigns assets (sets `projectId = null` on servers/domains/repos/findings) rather than cascading.
- [ ] Asset creation hooks: when a server/domain/repo is created with a projectId, merge the project's `inheritedTags` into the asset's `tags`.
- [ ] Enforce `defaults.requiredTagKeys`: reject creation if missing.
- **Acceptance**: unit tests cover inherited-tag merge + required-tag enforcement.

### 5.3 — Frontend: ProjectDetailPage management sections
**File**: `pages/Projects/ProjectDetailPage.tsx`
- [ ] Header: icon (colored square) + name + edited-by line. No health chip (projects don't have health).
- [ ] At-a-glance strip: counts of servers/domains/repos + "Open scoped dashboard →" button (navigates to `/?project=<id>`).
- [ ] Tabs: **Settings** | **Alert rules** | **Defaults & policies**. (Integrations tab removed.)
- [ ] **Settings tab**:
  - [ ] Description card — prominent markdown textarea with toolbar (bold/italic/H1/H2/link/code), character counter (max 4000), save indicator, ⌘S shortcut.
  - [ ] General card — name, color picker.
  - [ ] Inherited tags card — add/remove tag chips.
  - [ ] Danger zone — Archive + Delete buttons with confirmation dialogs.
- [ ] **Alert rules tab**:
  - [ ] List of built-in rules with toggles (critical findings, SSL expiring, server health, domain down).
  - [ ] Quiet-hours scheduler.
  - [ ] "+ Add custom rule" (stub for now).
- [ ] **Defaults & policies tab**:
  - [ ] Domain check interval selector.
  - [ ] Required tag keys multi-input.
  - [ ] Repo scan frequency selector.
  - [ ] Auto-dismiss info-finding age selector.
- **Acceptance**: page matches `c-project-detail.html` layout; edits persist to backend; archive hides project from switcher.

### 5.4 — Projects list preview (optional polish)
**File**: `pages/Projects/ProjectsPage.tsx`
- [ ] Show first ~2 lines of each project's description on its card (strip markdown, no rendering — just preview).
- [ ] Hide archived projects behind a "Show archived" toggle.
- **Acceptance**: projects list feels richer; archived projects don't clutter.

---

## Phase 6 — Cleanup & tests · ~1 day

### 6.1 — Remove dead code
- [ ] Delete old status-chip styles / helpers that are no longer referenced.
- [ ] Remove per-page project `<Select>` components (already removed in Phase 2 — verify nothing imports them).
- **Acceptance**: `knip` / `ts-prune` reports zero new unused exports.

### 6.2 — E2E smoke tests (Playwright)
**File**: `dashboard/e2e/scope.spec.ts`
- [ ] Login → select `production` in switcher → navigate Servers → Domains → Repos → switcher stays on `production`.
- [ ] Select a project, reload page → scope is still selected (URL persistence).
- [ ] Click a status card on Servers → filter applies + scope preserved.
- **Acceptance**: CI runs; tests pass.

### 6.3 — Documentation update
- [ ] Update `docs/product-documentation.md` section 5.2 ("Projects") to reflect the new management-focused page.
- [ ] Add a new subsection: "Status vocabulary" with the normalized table.
- [ ] Update `docs/securitycentral-spec.md` if it references old status labels.
- **Acceptance**: docs match the shipped UI.

---

## Dependency graph

```
1.1 status helpers ─┐
1.2 chips ──────────┼──▶ 2.1 Servers list ─┐
1.3 scope hook ─────┤    2.2 Domains list  ├──▶ 3.* detail pages ─┐
1.4 switcher ───────┤    2.3 Repos list    │                      │
1.5 scope banner ───┤    2.4 Findings list ┘                      │
1.6 AppShell mount ─┘                                             │
                                                                  │
                              4.1 Dashboard polish ◀──────────────┤
                                                                  │
5.1 schema ──▶ 5.2 API ──▶ 5.3 Project detail UI ──▶ 5.4 list preview
                                                                  │
                              6.* cleanup & tests ◀───────────────┘
```

---

## Milestones for sanity checks

- **After Phase 1**: The switcher works in isolation on one page (pick ServersPage to demo). Nothing else has changed visually.
- **After Phase 2**: Every list page reacts to the top-bar scope with the new status cards/chips. This is the biggest perceived win — ship this alone if needed.
- **After Phase 3**: Asset detail pages consistent. All-in-one vocabulary everywhere.
- **After Phase 4**: Dashboard in sync. Homepage is the same "feel" as everywhere else.
- **After Phase 5**: Project detail page becomes a real management surface. Description, inherited tags, alert rules, defaults are live.
- **After Phase 6**: Green tests, green knip, green docs. Ready to merge.

---

## Out of scope (explicitly)

- **Members & access** per project — org-level RBAC is enough for MVP.
- **Project slug editing** — not exposed in the new design.
- **Integrations tab** on projects — no concrete content; merged into Alert rules instead.
- **PR auto-creation for dep fixes** — future feature, not part of this UX pass.
- **Jira/Linear ticket creation** — future.
- **Full backend migration history cleanup** — existing issue, orthogonal to this work.

---

## Risk checklist

- [ ] Does the scope switcher correctly re-fetch all queries on change? (React Query cache key must include `projectId`.)
- [ ] Does deep-linking work? `/servers?project=prod` loaded fresh should filter correctly.
- [ ] Does the switcher handle "scope was set to an archived project" gracefully? (Fall back to "All projects".)
- [ ] Does the status-card filter compose with scope? (Critical + prod = 0 critical prod servers, not all critical.)
- [ ] Does the inherited-tags merge run on agent-registered servers (not just UI-created)?
- [ ] What happens to findings on a project that's then archived? (Leave findings visible under "All projects"; quiet their alerts.)
