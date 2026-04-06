# SecurityCentral SMB UI/UX Spec (v1)

**Goal:** Deliver fast time-to-value for SMBs with a clear “what to fix this week” workflow, minimal configuration, and predictable usage aligned to pricing tiers.

## UX Principles
1. Time-to-value in one session.
2. One dashboard that answers “what’s risky now.”
3. Simple, predictable limits tied to pricing.
4. Minimal choices; safe defaults.
5. Action over analysis.

---

## Information Architecture
- **Home** (Today’s Risks)
- **Assets** (Servers, Repos, Certificates)
- **Findings** (Prioritized, fix-oriented)
- **Reports** (Weekly summary)
- **Integrations** (GitHub/GitLab, Slack, Email)
- **Billing** (Plan + Usage)

---

## Global Navigation
**Top Nav**
- Left: Logo + product name
- Center: Primary nav tabs (Home, Assets, Findings, Reports)
- Right: Alerts bell, Plan badge, Account menu

**Plan Badge**
- Shows plan tier (Starter/Growth/Enterprise)
- On hover: asset usage summary + “Upgrade” link

---

## Onboarding Wizard (First Run)
**Step 1: Connect Code**
- One CTA: “Connect GitHub” or “Connect GitLab”
- OAuth flow, auto-import repos

**Step 2: Install Agent**
- One-line install command with copy button
- Small “Why this is needed” tooltip (assets + vuln scans)

**Step 3: Alerts**
- Toggle Slack + Email
- Default: Email on, Slack optional

**Step 4: Live Progress**
- Progress indicator (Discovering assets → Scanning → First findings)
- First findings appear in real time with “Go to Home”

---

## Home — “Today’s Risks”
**Top Summary Row**
- Critical risks (count)
- Expiring certs (next 14 days)
- Servers with critical CVEs
- Repos with leaked secrets

**Primary Card: Fix-It Checklist**
- 3–7 high-impact items
- Each item shows:
  - Severity badge
  - Asset name
  - Risk summary
  - Primary action (View fix or Create ticket)

**Secondary Cards**
- “Newest findings”
- “Assets not scanned in 7+ days”
- “Upcoming cert expirations”

**Usage Indicator**
- Subtle bar for asset usage (Servers/Repos/Certs)
- Text: “You’re at 68% of Starter plan”

---

## Assets
**Tabs:** Servers | Repos | Certificates

**Servers List**
- Columns: Hostname, Status, Last scan, Critical count, Risk score
- Actions: View details, Scan now

**Repos List**
- Columns: Repo, Provider, Last scan, Critical count
- Actions: View findings, Trigger scan

**Certificates List**
- Columns: Domain, Expires in, Issuer, Status
- Actions: View details, Renew guidance

**Asset Detail Page**
- Summary card (status, last scan, risk score)
- Findings list filtered to asset
- “Fix-it” suggestions

---

## Findings
**Default view:** High impact only (Critical + High)

**Filters**
- Severity
- Asset type
- Status (Open / In progress / Resolved)

**Finding Card**
- Title + severity badge
- Asset context (server/repo/cert)
- Clear remediation guidance
- Actions: “Mark in progress,” “Resolve,” “Create ticket/PR”

---

## Reports
**Weekly Summary**
- Risk trend chart
- Top 10 issues
- Resolved this week
- Export PDF button

---

## Integrations
**Supported (SMB v1)**
- GitHub OR GitLab
- Slack
- Email

**Layout**
- Connection status card
- Simple connect/disconnect
- Alert routing toggles

---

## Billing
**Plan Overview**
- Current plan, next billing date
- Usage bars for servers, repos, certs
- Forecast: “At current pace, you’ll hit limit in 12 days”

**Upgrade CTA**
- Clear, non-intrusive
- Single button: “Upgrade to Growth”

---

## Visual Style (Guidelines)
- Bright, clean, friendly
- Clear severity colors (Critical red, High orange, Medium yellow, Low blue)
- Card-based layout with strong primary CTA
- Minimal form complexity, step-by-step flows

---

## Copy Guidelines
- Short, action-focused
- Avoid jargon unless necessary
- Always include “what to do next”
