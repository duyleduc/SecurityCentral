# SecurityCentral SMB Product Spec (v1)

**Purpose:** Define a focused, sellable SMB offering with fast time-to-value and predictable cost.
**Audience:** Small and mid-size teams with limited security/infrastructure capacity.

## Positioning
SecurityCentral helps small and mid-size teams see and fix their riskiest infrastructure and code issues fast — without managing multiple tools or complex rules.

## Primary Wedge (Day-1 Value)
Prevent outages and security incidents with one setup: server health + certificate expiry + basic code risk.

## Core Outcomes
- Know what assets exist (servers, repos, certs).
- Get alerted only on high-impact risks.
- See a prioritized “what to fix this week.”

## MVP Feature Set (SMB-Ready)
**1) Asset Discovery**
- Servers: agent installs and auto-registers.
- Repos: GitHub/GitLab integration.
- Certificates: discovery + expiry alerts.

**2) Scanning**
- Server package vulnerabilities and critical misconfigs.
- Dependency vulnerabilities (SCA) and secret detection.
- SAST as “beta” or “advanced.”

**3) Actionability**
- Weekly risk report.
- Top 10 critical findings with remediation steps.
- SLA-style alerting: “expiring in 14/7/3 days.”

**4) Integrations**
- Slack + email.
- GitHub or GitLab only (choose one to start).

**5) Onboarding**
- Guided wizard.
- One script for agent install.
- One click to connect repo.

## Explicit Non-Goals (SMB v1)
- Complex policy engines.
- Custom rule management.
- Deep compliance frameworks.
- Multi-cloud within the same org.

## Pricing Model (Simple, Predictable)
**Starter** — $199/month  
- 25 servers  
- 20 repos  
- 50 certs  
- 1 cloud account  
- Email + Slack alerts  

**Growth** — $599/month  
- 200 servers  
- 100 repos  
- 500 certs  
- 3 cloud accounts  
- Priority support  

**Enterprise** — Custom  
- Unlimited assets  
- SSO  
- Audit exports  
- Custom data retention  

**Pricing metric:** Per asset (server/repo/cert), not per vulnerability.

## Onboarding Flow (15-Minute Target)
1. Create org + connect GitHub/GitLab.
2. Install agent (one-line script).
3. Auto-scan starts.
4. First report in 30–60 minutes.

## SMB-Friendly UX
- One dashboard: “Today’s risks.”
- Default scan schedule and alert thresholds.
- “Fix-it checklist” instead of raw data.

## Sales & Distribution
- Product-led growth: free trial with limited assets.
- Channel: MSPs and boutique cloud consultancies.

## Success Metrics
- Time-to-first-finding under 30 minutes.
- First remediation within 7 days.
- 70%+ retention after trial.
