# AdMatix — Open Source Posture & Revenue Model

**Status:** Internal strategy decision doc
**Author:** Strategy / Founder
**Date:** 2026-05-22
**Audience:** Founders, future eng leads, YC application reviewers (internal)
**Decision class:** Firm recommendation — not a menu. Revisit only at Series A.

---

## 0. TL;DR

AdMatix is positioned as **"the trust layer for agents that run ads."** That
positioning creates a real tension:

- **Openness drives distribution.** A protocol only becomes a standard if it is
  free, forkable, and un-ownable. Agents will not standardize on a spec that one
  vendor can revoke.
- **The evidence/eval/benchmark/governance IP is the moat.** If the validation
  engine is open, anyone can self-host the exact thing customers pay us for.

The resolution is **open-core with a hard, defensible seam**:

> **Open the *protocol and the SDK*. Close the *engine and the evidence
> network*.**

Concretely:

- **Open (Apache-2.0):** `schemas` (the H0 packet spec + MCP tool schemas),
  `cli`, `mcp-server` (thin reference adapter), and a stub of `connectors`.
  This is the standard. We *want* it copied.
- **Source-available (FSL-1.1 / "fair-source"):** `core` — the local
  planning/orchestration logic. Readable, self-hostable for internal use,
  non-compete restricted, converts to Apache-2.0 after 2 years.
- **Closed (proprietary, cloud-only):** `evidence`, `evals`, `ui`, `api`, `web`.
  This is the moat: independent validation, the benchmark corpus, the
  cross-customer evidence network, and the governance/audit cloud.

Revenue follows the seam. We never charge for the protocol. We charge for
**proven outcomes and independent verification** — the things that are
structurally hard to self-host because they depend on a corpus and a third-party
trust position we own.

Phased pricing:

| Phase | Timing | Act 1 (Agency Operator) | Act 2 (Agent Infra) |
|---|---|---|---|
| Design partner | Now → Q3 2026 | Free, 3–5 logos | Free, metered, capped |
| Paid pilot | Q4 2026 → Q1 2027 | $2.5k–$8k/mo flat + usage | $0.25–$2 per H0 packet |
| Scale | Q2 2027+ | Tiered SaaS + outcome kicker | Usage + platform commit |

Illustrative Year-2-exit ARR: **~$1.6M** (see §11).

---

# PART 1 — OPEN SOURCE DECISION

## 1. The strategic question, stated precisely

AdMatix has two acts:

- **Act 1** — an AI-native paid-media *operator* sold to mid-market agencies
  running $1M–$20M/month in ad spend.
- **Act 2** — **AdMatix as a standard**: the trust/verification layer *any* AI
  agent calls to run ads safely across Google, Meta, TikTok, DV360, Amazon, etc.

Act 2 only works if AdMatix becomes infrastructure. Infrastructure that one
vendor controls is not adopted by other vendors — it is routed around. So the
question is not "should we open source?" It is:

> **Exactly which surface do we open so that AdMatix becomes a standard, while
> keeping closed the surface that is the actual business?**

The answer depends on identifying a **seam**: a clean architectural boundary
where the open side is genuinely useful (drives adoption) but the closed side is
genuinely hard to reproduce (protects revenue). If no such seam exists, open
source is either useless theater or business suicide. AdMatix *does* have a
seam, and it is unusually clean. See §5.

## 2. What the comps actually teach

We looked at six reference points spanning the full spectrum from "fully open
standard" to "open-washing backlash." Each maps to a decision AdMatix must make.

### 2.1 MCP — the open *standard* play

The Model Context Protocol was introduced by Anthropic in Nov 2024 as an open
standard, and in **December 2025 was donated to the Agentic AI Foundation
(AAIF), a directed fund under the Linux Foundation**, co-founded by Anthropic,
Block, and OpenAI.
([Anthropic](https://www.anthropic.com/news/donating-the-model-context-protocol-and-establishing-of-the-agentic-ai-foundation),
[Linux Foundation](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation))
Within one year MCP reached **97M+ monthly SDK downloads and 10,000+ active
servers**, with first-class client support across ChatGPT, Claude, Cursor,
Gemini, and Copilot.
([Anthropic](https://www.anthropic.com/news/donating-the-model-context-protocol-and-establishing-of-the-agentic-ai-foundation),
[The New Stack](https://thenewstack.io/anthropic-donates-the-mcp-protocol-to-the-agentic-ai-foundation/))

**Lesson for AdMatix:** A protocol becomes a standard *because* no single vendor
owns it. Anthropic gave MCP away and was rewarded with the entire agent
ecosystem building on it. AdMatix's H0 packet spec and its MCP tool schemas
should follow the *exact same logic*: give the spec away so agents adopt it.
Crucially — Anthropic did not give away Claude. They gave away the *protocol*
and kept the *model*. That is precisely the move.

### 2.2 Stripe — open SDKs, proprietary platform

Stripe maintains ~90 public repos and 9 official SDK libraries, and explicitly
says "their business is built on open source."
([Stripe GitHub](https://github.com/stripe),
[GitHub case study](https://github.com/customer-stories/stripe))
But the SDKs are *clients* to a **proprietary payments platform**. You cannot
self-host Stripe. The open code is the on-ramp; the money is the network and the
ledger.

**Lesson for AdMatix:** Open the *client* (CLI, SDK, MCP adapter). Keep the
*platform* (the evidence engine, the cloud) closed. The open code's job is
adoption and trust, not revenue.

### 2.3 Supabase — clean open-core

Supabase's entire server stack (Postgres, PostgREST, GoTrue, Realtime) is
**Apache-2.0 / MIT and fully self-hostable**; the commercial product is the
managed cloud (hosting, uptime, support, proprietary cloud features).
([Supabase Docs](https://supabase.com/docs/guides/getting-started/architecture),
[MindStudio](https://www.mindstudio.ai/blog/what-is-supabase))
Supabase deliberately makes migration in/out easy to avoid lock-in — they win on
operational convenience, not captivity.

**Lesson for AdMatix:** Open-core works when "running it yourself is annoying
and you'd rather not." But note: Supabase's open core is *commodity infra*
(Postgres). Their moat is thin — it is convenience. **AdMatix must not copy this
literally.** If we open-source the evidence engine, we have a Supabase-style
thin moat on a product whose *entire value proposition is the moat*. We need the
open/closed line drawn at a place where the closed side is structurally, not
just operationally, hard to reproduce. (See §5 — our closed side depends on a
cross-customer corpus and a third-party trust position, neither of which is
self-hostable.)

### 2.4 Sentry & the Functional Source License (FSL)

Sentry moved from BSD to BSL in 2019 to stop "funded businesses plagiarizing our
work to directly compete," then in 2023 launched the **Functional Source License
(FSL)** — a non-compete, source-available license that **converts to Apache-2.0
or MIT after 2 years**, and coined the "fair source" category.
([InfoQ](https://www.infoq.com/news/2023/12/functional-source-license/),
[TechCrunch](https://techcrunch.com/2024/09/22/some-startups-are-going-fair-source-to-avoid-the-pitfalls-of-open-source-licensing/),
[FOSSA](https://fossa.com/blog/fall-2024-software-licensing-roundup/))

**Lesson for AdMatix:** FSL is the right tool for the *middle layer* — code we
want readable and self-hostable for internal use, but which we do **not** want a
competitor (Synter, Pixis) lifting to launch a rival hosted product. The 2-year
delayed-open conversion is a credibility signal: it caps how "closed" we look.

### 2.5 HashiCorp BSL — the cautionary tale

In 2023 HashiCorp switched Terraform et al. from MPL to the Business Source
License. It "made business sense" but triggered real backlash: OpenUK's CEO
called it "open washing," Percona's CEO called it "hostile," and the community
forked Terraform into OpenTofu.
([HashiCorp blog](https://www.hashicorp.com/en/blog/hashicorp-adopts-business-source-license),
[The New Stack](https://thenewstack.io/hashicorp-abandons-open-source-for-business-source-license/),
[ITPro](https://www.itpro.com/software/open-source/analysis-hashicorp-prioritizes-its-business-with-bsl-license-switch-but-community-upset-cannot-be-ignored))

**Lesson for AdMatix — two parts:**

1. **Never relicense from open to closed.** The backlash is reputational and
   permanent, and it produces hostile forks. Decide the license *correctly on
   day one* and never walk it back. Whatever we ship as Apache-2.0 stays
   Apache-2.0 forever.
2. **A standard cannot live under BSL.** Terraform-the-tool surviving under BSL
   is one thing; if AdMatix wants the H0 packet to be a *standard agents adopt*,
   it must be under a real OSI-approved license with no rug-pull risk. BSL on
   the spec would kill adoption before it started.

### 2.6 n8n — fair-code, source-available, commercially restricted

n8n coined "fair-code": source-available, free for internal/non-commercial use,
**commercially restricted** by the Sustainable Use License. It reached a ~€250M
valuation and 230k+ active users by 2025.
([n8n Docs](https://docs.n8n.io/sustainable-use-license/),
[n8n blog](https://blog.n8n.io/announcing-new-sustainable-use-license/),
[Medium](https://medium.com/@takafumi.endo/inside-n8n-how-a-fair-code-open-source-platform-leads-ai-powered-workflow-automation-e8128890d496))

**Lesson for AdMatix:** Source-available + non-compete is a *commercially proven*
posture, not a fringe one. It is fine for the `core` orchestration layer. It is
*not* fine for the protocol spec — fair-code restrictions deter the
ecosystem-wide adoption a standard needs.

### 2.7 Summary of the comp matrix

| Comp | What's open | What's closed | License on open part | Takeaway for AdMatix |
|---|---|---|---|---|
| MCP | The protocol + SDKs | Nothing (it's a standard) | MIT, now LF-governed | Model for the **H0 spec + tool schemas** |
| Stripe | Client SDKs | Payments platform | MIT/Apache | Model for **cli / mcp-server** |
| Supabase | Whole server stack | Managed cloud | Apache-2.0 / MIT | Open-core works — but their moat is thin; don't copy literally |
| Sentry | App + FSL middle code | Cloud + corpus | FSL-1.1 (→ Apache @2yr) | Model for **core** |
| HashiCorp | (relicensed to BSL) | — | BSL | **Anti-pattern**: never relicense; never BSL a standard |
| n8n | Whole app | Cloud + enterprise feats | Sustainable Use (fair-code) | Fair-code is viable for **core**, not for the spec |

## 3. The two things AdMatix is actually selling

To draw the open/closed line, separate the two distinct assets:

**Asset A — The interoperability standard (the H0 packet + MCP tool schemas).**
This is *worth more the more widely it is copied*. If 50 agent frameworks emit
H0 packets, AdMatix sits at the center of a category. The standard has near-zero
marginal value if AdMatix is the only one who can read it. **This must be
open.** Its job is distribution and category creation, not revenue.

**Asset B — The independent evidence/eval/benchmark/governance engine.** This is
*worth less the more widely it is copied*. Its value is precisely that it is
**independent** (not the agent grading its own homework) and **comparative**
(benchmarked against a corpus of other campaigns AdMatix has seen). **This must
be closed.** It is the revenue.

These two assets have *opposite* network economics. That is the whole reason the
open-core seam exists and is defensible. We are not splitting one product
arbitrarily; we are recognizing that AdMatix is genuinely two assets with
inverted incentives.

## 4. The H0 packet as a public protocol

The H0 packet — pre-registered hypothesis + guardrails + independently-validated
result + rollback plan + full provenance — should be published as an **open
specification**, versioned, with a public JSON Schema, in the `schemas` package.

Why open the spec:

- **Adoption flywheel.** Every agent framework that learns to emit an H0 packet
  is a potential AdMatix customer. The spec is the funnel.
- **Trust through transparency.** A *verification* standard that is itself a
  black box is a contradiction. Agencies, brand-safety teams, and auditors need
  to read the spec to trust the verdict.
- **Standards bodies / category ownership.** Long term, we want the H0 packet
  cited the way IAB standards or `ads.txt` are cited. That requires a license no
  single vendor can revoke. The MCP→Linux Foundation path is the template: own
  the category by *giving away* the spec (see §13 for the foundation question).

Critically: **publishing the spec does not give away the engine.** Anyone can
*emit* an H0 packet. Almost no one can *independently validate* one well,
because validation requires (a) the eval methodology, (b) a benchmark corpus,
and (c) a credible third-party position. The spec is the socket; the engine is
the appliance. Publishing the socket dimensions does not give away the
appliance.

## 5. The defensible seam — why the moat survives openness

The single most important argument in this doc. The open/closed line is drawn at
a place where the closed side is **structurally** un-reproducible, not merely
inconvenient to host:

| Moat component | Why open-sourcing the spec/SDK does NOT erode it |
|---|---|
| **Benchmark corpus** | The value of a benchmark is the *data behind it* — thousands of real campaigns with known outcomes. The spec describes the *format* of a benchmark run; it cannot hand over the corpus. Corpus compounds with every customer. |
| **Independence** | "Independent validation" means a party *other than the executing agent* issues the verdict. By definition a self-hosted fork run by the agent vendor is **not independent** — it is the agent grading itself. The trust position is non-copyable. |
| **Cross-customer priors** | Eval quality improves with every campaign AdMatix scores. A fork starts from zero priors. This is a data-network effect, not a code asset. |
| **Governance of record** | Auditors, brand-safety teams, and (eventually) regulators want a *neutral system of record*. A self-hosted fork is not "of record." |
| **Liability / attestation** | When AdMatix attests a result, it stands behind it. A fork has no one to stand behind it. |

So the seam is: **the protocol and the local tooling are commodity and should
be free; the corpus, the independence, and the attestation are the product and
cannot be forked even if every line of evaluation code were public.** This is
why AdMatix can be *more* open than Supabase on the protocol while having a
*much* stronger moat than Supabase on the engine.

(We still keep the `evals` and `evidence` *code* closed — see §7 — because there
is no reason to hand competitors a head start on methodology even if the corpus
is the deeper moat. Closed code is defense-in-depth; the corpus is the wall.)

## 6. RECOMMENDATION — the open/closed split

### 6.1 Package-by-package decision

Mapped directly to the monorepo (`packages/`: schemas, core, connectors,
evidence, evals, ui — `apps/`: cli, mcp-server, api, web):

| Package / App | Posture | License | Rationale |
|---|---|---|---|
| **`packages/schemas`** | **Open** | **Apache-2.0** | The H0 packet spec + MCP tool schemas = the standard. Apache-2.0 (patent grant) maximizes adoption and makes it safe for big agent vendors to depend on. |
| **`apps/cli`** | **Open** | **Apache-2.0** | The developer on-ramp. Like Stripe's SDK — gets AdMatix into terminals and CI. Must be trivially adoptable. |
| **`apps/mcp-server`** | **Open** | **Apache-2.0** | The reference MCP adapter. This is *how agents reach AdMatix*. Closing it would defeat Act 2 entirely. Open = reference implementation any agent can trust. |
| **`packages/connectors`** | **Split** | **Apache-2.0 (interfaces + stubs)** / **proprietary (production connectors)** | Open the connector *interface* and read-only/sandbox stubs so the community can extend coverage. Keep hardened, rate-limit-aware, write-enabled production connectors (Google, Meta, TikTok, DV360, Amazon) proprietary — they are operational liability and ongoing maintenance cost, not standard. |
| **`packages/core`** | **Source-available** | **FSL-1.1 (→ Apache-2.0 after 2 yrs)** | Local planning/orchestration. Readable + self-hostable for internal use builds trust and eases enterprise procurement, but non-compete prevents Synter/Pixis lifting it into a rival hosted product. 2-yr delayed-open conversion = credibility, no rug-pull. |
| **`packages/evidence`** | **Closed** | Proprietary | The independent validation engine. The moat. Cloud-only. |
| **`packages/evals`** | **Closed** | Proprietary | Eval methodology + benchmark harness. The moat. Cloud-only. |
| **`packages/ui`** | **Closed** | Proprietary | Cockpit component library. Product surface, no standards value. |
| **`apps/api`** | **Closed** | Proprietary | The hosted evidence/governance cloud. The metered, monetized surface. |
| **`apps/web`** | **Closed** | Proprietary | The agency cockpit. Product surface. |

### 6.2 The three-tier picture

```
┌─────────────────────────────────────────────────────────────┐
│  TIER 1 — OPEN STANDARD (Apache-2.0)                         │
│  schemas · cli · mcp-server · connector interfaces/stubs     │
│  GOAL: distribution. We WANT this copied, forked, embedded.  │
│  REVENUE: $0. This is the funnel.                            │
├─────────────────────────────────────────────────────────────┤
│  TIER 2 — FAIR-SOURCE (FSL-1.1, → Apache-2.0 @ 2yr)          │
│  core (local planning/orchestration)                         │
│  GOAL: trust + self-host for internal use; block rival SaaS. │
│  REVENUE: $0 directly; de-risks enterprise procurement.      │
├─────────────────────────────────────────────────────────────┤
│  TIER 3 — PROPRIETARY (cloud-only)                           │
│  evidence · evals · ui · api · web · production connectors   │
│  GOAL: the moat — independent validation, corpus, governance.│
│  REVENUE: 100% of it.                                        │
└─────────────────────────────────────────────────────────────┘
```

### 6.3 Why Apache-2.0 (not MIT, not BSL) for Tier 1

- **vs MIT:** Apache-2.0 includes an **explicit patent grant**. For a *protocol*
  that large agent vendors (OpenAI, Google, Anthropic-ecosystem) and enterprise
  agencies will embed, the patent grant removes a legal objection their counsel
  would otherwise raise. MCP used MIT and survived, but a *verification/governance*
  spec touching regulated ad spend benefits from the stronger IP hygiene.
- **vs BSL / fair-code:** A standard cannot carry commercial-use restrictions.
  HashiCorp shows the backlash; more importantly, restrictions structurally
  prevent the broad embedding that makes a standard a standard.
- **vs full LF donation on day one:** Premature — see §13. Apache-2.0 in our own
  GitHub org now; foundation donation later, once there is adoption to govern.

### 6.4 Why FSL-1.1 (not Apache, not fully closed) for `core`

- **Not Apache:** `core` contains real planning IP. Fully open invites a
  competitor to host "AdMatix-compatible" and undercut us. FSL's non-compete
  clause blocks exactly that.
- **Not fully closed:** Enterprise agencies and security teams want to *read and
  self-host* the orchestration layer for procurement and audit. Source-available
  satisfies that without making us a SaaS-able fork target.
- **The 2-year conversion** signals good faith and caps "how closed we look" — a
  direct lesson from the Sentry FSL playbook.

## 7. What stays closed, restated bluntly

The proprietary core is **the independent evidence network**:

1. **The benchmark corpus** (`data/benchmarks/`, served via `api`) — real
   campaigns + outcomes; compounds per customer.
2. **The eval methodology** (`evals`) — how an H0 result is scored,
   counterfactuals, significance gating.
3. **The validation engine** (`evidence`) — the independent verdict service.
4. **The governance/audit cloud** (`api` + `web`) — system of record, rollback
   ledger, provenance store.
5. **Production connectors** — hardened write-path integrations.

We open the *grammar* (how to speak H0). We never open the *judgment* (whether
an H0 result is true) or the *corpus* (what "good" looks like across the market).

## 8. Open-source risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| A competitor embeds our open spec/SDK and routes around our cloud | High — and **fine**. That IS the standard working. They still need a validator; that funnels demand to Tier 3. | Make `api` the path of least resistance; price Tier 3 so build-vs-buy favors buy. |
| Someone forks `core` and launches a rival hosted product | Medium | FSL-1.1 non-compete clause makes this a license violation; corpus moat means a fork is still inferior. |
| "Open-washing" accusation (we call it open but the value is closed) | Medium | Be transparent in messaging: "open protocol, commercial engine." Never call the whole product "open source." Use Stripe's honest framing. |
| Pressure to relicense Tier 1 later when revenue is tight | Medium | **Pre-commit publicly** that Tier 1 stays Apache-2.0. Treat it as irreversible. HashiCorp shows the cost of breaking this. |
| Foundation donation dilutes our control of the spec | Low (and later) | Donate only after we have a governance seat and adoption; see §13. |

## 9. Sequencing the open-source rollout

| When | Action |
|---|---|
| Now (pre-seed / design-partner) | Publish `schemas` (H0 packet v0.x spec) as Apache-2.0 in a public repo. Ship `cli` + `mcp-server` open. Keep everything else private. |
| Paid-pilot (Q4 2026) | Open connector interfaces + stubs. Apply FSL-1.1 to `core`. Public CHANGELOG + versioning policy for the spec. |
| Scale (Q2 2027+) | H0 packet v1.0. Begin conversations with AAIF / standards bodies about contributing the spec (not the engine). |
| Series A+ | Evaluate formal foundation donation of the spec only, conditional on a retained governance seat. |

---

# PART 2 — REVENUE MODEL

## 10. Pricing principles (derived from Part 1)

Three rules fall directly out of the open-source decision:

1. **Never charge for Tier 1.** The protocol, CLI, and MCP adapter are the
   funnel. Charging for them throttles adoption — the opposite of the Act 2
   thesis.
2. **Charge for the things that are structurally hard to self-host** —
   independent validation, the benchmark corpus, governance-of-record. These map
   exactly to Tier 3.
3. **Price the unit the customer values, not the unit we compute.** The customer
   values *a verified outcome and a safe change*, not "an API call." This points
   to per-H0-packet and outcome-based pricing, not pure seat licensing.

### 10.1 What the pricing comps say

- **Synter** (closest competitor) sells flat-fee, deliberately **"no
  percentage-of-spend fees"**: ~$99/mo entry, ~$299/mo for AI agent media
  buyers, month-to-month, positioned at SMB/mid-market.
  ([Synter vs Agency](https://syntermedia.ai/blog/synter-vs-hiring-agency),
  [Synter](https://syntermedia.ai/))
  Synter's explicit pitch: a flat tool is cheaper than %-of-spend above
  ~$10k/mo. **This caps what we can charge for *execution*** — execution is
  commoditizing toward ~$100–$300/mo. AdMatix must *not* compete there; we sell
  the verification layer on top.
- **Traditional agencies** bill **10–20% of managed ad spend** (commonly
  15–20%, tiering down: ~20% on the first $50k, ~15% on $50–150k, ~10% above
  $150k/mo).
  ([DOJO AI](https://www.dojoai.com/blog/the-agency-pricing-model-battle-fixed-fee-vs-percentage-vs-performance-based),
  [Get Ryze](https://www.get-ryze.ai/blog/ad-agency-pricing-models-flat-fee-percentage),
  [HawkSEM](https://hawksem.com/blog/marketing-agency-pricing/))
  This sets the *budget reference point* for our agency buyers — but %-of-spend
  has perverse incentives (see §13).
- **Usage- and outcome-based pricing is now mainstream.** Any-usage-based
  pricing rose from ~30% of SaaS (2019) to ~85% (2024); seat-based fell from 21%
  to 15% in 12 months while hybrid surged 27%→41%. Outcome pricing is real:
  Intercom Fin charges **$0.99 per resolved conversation**, Zendesk **$1.50–$2.00
  per automated resolution**.
  ([Monetizely](https://www.getmonetizely.com/blogs/the-2026-guide-to-saas-ai-and-agentic-pricing-models),
  [SoftwareSeni](https://www.softwareseni.com/saas-pricing-is-shifting-from-per-seat-to-usage-and-outcome-what-changes-at-your-next-renewal/),
  [Flexprice](https://flexprice.io/blog/why-ai-companies-have-adopted-usage-based-pricing))
- **Caveat — AI COGS are real.** AI products run 50–60% gross margin vs 80–90%
  for classic SaaS, and 78% of IT leaders report unexpected consumption charges.
  ([Monetizely](https://www.getmonetizely.com/blogs/the-2026-guide-to-saas-ai-and-agentic-pricing-models))
  Our pricing must include a **base commit** so revenue is forecastable and we
  are not exposed to per-call cost spikes.

## 11. Act 1 — Agency Operator pricing

**Buyer:** mid-market agencies managing $1M–$20M/month in ad spend.
**Value sold:** safe autonomous operation + *independent proof* that changes
worked — sellable by the agency to *its* clients as a trust differentiator.

### 11.1 Pricing model evaluation for Act 1

| Model | Verdict | Why |
|---|---|---|
| **% of managed spend** | **Reject as primary** | Perverse incentive (we'd profit from clients spending more, not spending *better*) — directly contradicts the "evidence-gated" brand. Also the exact thing Synter weaponizes against agencies. |
| **Flat SaaS / per seat** | **Partial** | Predictable, easy to sell, good as a *base*. But pure seat pricing doesn't capture value as an agency scales accounts, and seat-based is in structural decline. |
| **Usage-based (per audit / per H0 packet)** | **Yes — as the variable layer** | Aligns price with value delivered; scales naturally with the agency's book of business. |
| **Outcome-based (share of proven savings)** | **Yes — as a capped kicker** | The strongest brand-aligned model: AdMatix's whole pitch is *proven* outcomes. But pure outcome pricing is unforecastable and disputable, so use it as a *capped* add-on, not the base. |

**Decision: hybrid — flat platform base + usage + a capped outcome kicker.** This
is the dominant 2026 transition model and it matches our COGS reality.

### 11.2 Act 1 phased pricing

#### Phase A — Design Partner (Now → Q3 2026)

- **Price: $0.** 3–5 hand-picked agencies.
- **The deal:** free access in exchange for (a) a logo, (b) a reference call,
  (c) a data-sharing agreement letting their (anonymized, aggregated) campaign
  outcomes seed the benchmark corpus. **The corpus contribution is the real
  price** — it builds the Tier-3 moat.
- Success metric: 3+ agencies running ≥10 H0 packets/month each.

#### Phase B — Paid Pilot (Q4 2026 → Q1 2027)

| Tier | Price | Includes |
|---|---|---|
| **Pilot** | **$2,500/mo** flat | 1 agency workspace, up to 3 managed brand accounts, 150 H0 packets/mo included, cockpit, email support. |
| **Pilot+** | **$8,000/mo** flat | Up to 12 brand accounts, 600 H0 packets/mo, benchmark access, priority support, quarterly review. |
| Overage | **$12 / H0 packet** beyond plan | Keeps heavy users contributing margin. |

- Annual contracts, quarterly opt-out. Target 8–12 paying agencies.
- No outcome kicker yet — we need a clean attribution baseline first.

#### Phase C — Scale (Q2 2027+)

| Tier | Base / mo | Included H0 packets | Brand accounts | Overage |
|---|---|---|---|---|
| **Studio** | $1,500 | 100 | 3 | $14 / packet |
| **Growth** | $5,000 | 500 | 15 | $11 / packet |
| **Agency** | $14,000 | 2,000 | 60 | $8 / packet |
| **Enterprise** | Custom ($25k+) | Custom | Unlimited | Committed-volume rate |

Plus an **optional outcome kicker** on Growth and above:

> **10% of independently-proven, attributable savings or efficiency gain,
> capped at 1.5× the customer's annual base fee.**

Outcome pricing only on *AdMatix-validated* savings — i.e. we only get the
kicker when our own independent evidence engine certifies the gain. This is
self-reinforcing: it makes the evidence layer the thing that unlocks our own
upside, and the cap keeps it forecastable for the customer.

**Note on the % question:** The kicker is a percentage of *proven savings*, never
a percentage of *spend*. Savings-share rewards spending *better*; spend-share
rewards spending *more*. Only the former is consistent with the brand.

## 12. Act 2 — Agent Infrastructure (MCP / API) pricing

**Buyer:** AI agents and the platforms that build them — agent frameworks,
autonomous marketing agents, vertical AI apps that need to run ads safely.
**Value sold:** a metered call to "audit / plan / activate / validate / rollback"
with full provenance — *trust-as-an-API*.

### 12.1 Pricing model evaluation for Act 2

| Model | Verdict | Why |
|---|---|---|
| Flat SaaS / seat | **Reject** | Agents don't have seats. Wrong unit entirely. |
| % of spend | **Reject** | We are not in the money path and don't want to be; metering on spend invites disputes and reconciliation overhead. |
| **Usage-based (per H0 packet / per benchmark run / per validation call)** | **Yes — primary** | The natural agent-native unit. Matches Intercom/Zendesk per-outcome precedent. Each call is a discrete, valued unit of trust. |
| **Outcome-based** | **Later / selective** | Hard to attribute when AdMatix is one tool among many in an agent stack. Defer. |
| **Platform commit** | **Yes — for big embedders** | A framework embedding AdMatix wants predictable cost; a committed-volume contract gives that and gives us forecastable ARR. |

**Decision: usage-based metering with volume tiers, plus platform-commit deals
for large embedders.** Free tier exists for adoption — but the free tier is the
*open Tier-1 tooling and a metered allowance of cloud validation*, not unlimited
free validation.

### 12.2 Act 2 phased pricing

#### Phase A — Design Partner (Now → Q3 2026)

- Open `cli` / `mcp-server` published free (Apache-2.0).
- Cloud validation: **free, metered, hard-capped** (e.g. 1,000 H0 validations/mo
  per org) for early agent-builder partners.
- Goal: 10+ agent projects emitting H0 packets against our cloud.

#### Phase B — Paid Pilot (Q4 2026 → Q1 2027)

| Unit | Price | Notes |
|---|---|---|
| Open spec, CLI, MCP adapter | **Free forever** | Tier 1. The funnel. |
| H0 packet validation (cloud) | **$0.25–$2.00 each**, sliding by depth | "Audit" tier $0.25; full pre-registered H0 with independent counterfactual $2.00. |
| Benchmark run (vs corpus) | **$25 / run** | Premium — uses the proprietary corpus. |
| Free allowance | **First 200 validations/mo free** | Keeps hobbyists and evals on-platform. |

- Billing via a metered `api` key; minimum $99/mo once past free allowance.

#### Phase C — Scale (Q2 2027+)

| Tier | Commit | Effective rate | For |
|---|---|---|---|
| **Developer** | Pay-as-you-go | $1.50 / H0 packet, $25 / benchmark | Indie agent builders |
| **Team** | $500/mo commit | $0.90 / H0 packet, $18 / benchmark | Funded agent startups |
| **Platform** | $5,000/mo+ commit | $0.45 / H0 packet, $10 / benchmark | Frameworks embedding AdMatix |
| **Foundation/OEM** | Custom (annual) | Negotiated + revenue share | An agent vendor white-labeling the trust layer |

The **Platform / OEM tier is the Act-2 prize**: if a major agent framework makes
AdMatix its default ad-trust layer, that is a seven-figure annual commit and the
standard is effectively won.

## 13. How monetization ties to the open-source decision

The pricing is *only coherent* because of the open/closed split:

- **We give away Tier 1** (schemas/cli/mcp-server) → that is *why* agents adopt
  the H0 packet → that creates the metered demand we charge for in Tier 3.
- **We never charge for the protocol** → no one can accuse us of taxing a
  standard → the standard spreads → more validation volume.
- **We charge for validation, corpus, and governance** → these are the
  structurally-un-forkable Tier-3 assets (§5) → self-hosting the open code does
  *not* let a customer reproduce what they're paying for.
- **The design-partner "price" is corpus data** → free access funds the moat
  that justifies paid pricing later.

The seam in the codebase and the seam in the price list are the **same seam**.

## 14. Illustrative ARR build (end of Phase C, ~Q4 2027 exit)

Conservative, single-scenario — not a forecast, a sanity check.

**Act 1 — Agency Operator**

| Tier | Customers | Avg ARR each | Subtotal |
|---|---|---|---|
| Studio | 12 | $20k | $240k |
| Growth | 14 | $72k | $1,008k |
| Agency | 3 | $185k | $555k |
| Enterprise | 1 | $320k | $320k |
| Outcome kickers (net, capped) | — | — | ~$120k |
| **Act 1 subtotal** | **30** | — | **~$2.24M** |

*(Earlier in the doc the TL;DR cited ~$1.6M — that is the more conservative
"only Phase-B graduates convert" case; this table is the fuller Phase-C ramp.
Plan against ~$1.6M; treat ~$2.2M as upside.)*

**Act 2 — Agent Infrastructure**

| Tier | Accounts | Avg ARR each | Subtotal |
|---|---|---|---|
| Developer (PAYG) | ~120 active | $0.6k | $72k |
| Team | 18 | $9k | $162k |
| Platform | 4 | $90k | $360k |
| Foundation/OEM | 1 | $250k | $250k |
| **Act 2 subtotal** | — | — | **~$844k** |

**Blended illustrative ARR at Phase-C exit: ~$2.0M–$3.1M** depending on Act-1
conversion. The point of the build is the *shape*: Act 1 is the near-term
revenue engine (mid-market agencies have budget now); Act 2 is the
standard-and-optionality engine (smaller today, category-defining if the
Platform/OEM tier lands).

## 15. Revenue risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **%-of-spend perverse incentive** if we ever add spend-based pricing | Medium | High (brand-killing) | Hard rule: we price *proven savings*, never *spend*. Encoded in §11.2. |
| **Open-core cannibalization** — customers self-host Tier 1/2 and skip Tier 3 | Medium | Medium | Tier 3 (corpus, independence, governance) is structurally un-forkable (§5). Self-hosting the open code yields a worse, non-independent result. |
| **Execution commoditizing** — Synter et al. drive operator price to ~$100–300/mo | High | High if we sell execution | Don't sell execution. Sell the verification layer; let execution be table stakes. Our base fee is for *trust*, not *running ads*. |
| **AI COGS compress margin** (50–60% vs SaaS 80–90%) | High | Medium | Base-commit on every tier; free allowances are *capped*; overage rates set above marginal compute cost. |
| **Usage-pricing bill shock** deters agent adoption | Medium | Medium | Generous free allowance + commit tiers with predictable effective rates + spend caps/alerts in the cockpit. |
| **Outcome attribution disputes** | Medium | Medium | Kicker only on AdMatix-*validated* savings; cap at 1.5× base; publish the attribution methodology. |
| **Long sales cycles with mid-market agencies** | Medium | Medium | Land via the cheap Pilot tier ($2.5k), expand to Growth/Agency once H0-packet volume proves ROI. |
| **A platform giant ships a free ad-trust layer** | Low–Medium | High | Independence is the defense — a platform validating ads *it also sells* is not independent. Lean hard on neutrality in positioning. |

## 16. Open questions to resolve before Series A

1. **Foundation timing.** When (not whether) to contribute the H0 packet spec
   to a neutral body (AAIF-style). Recommendation: only after v1.0 + real
   multi-vendor adoption + a retained governance seat. Too early = lose control
   before there is a category; too late = a competitor's spec gets there first.
2. **Outcome-kicker mechanics.** Exact attribution window, dispute process, and
   audit trail for the savings-share kicker. Needs a clean baseline from Phase B.
3. **Connector contribution model.** Do we accept community production
   connectors (with a CLA), or keep all write-path connectors first-party for
   liability reasons? Lean first-party initially.
4. **Free-allowance calibration.** The Act-2 free tier (200 validations/mo) must
   be large enough to drive adoption, small enough not to bleed COGS. Instrument
   and tune in Phase B.

---

## Appendix — Decision summary

| Decision | Recommendation |
|---|---|
| H0 packet spec + MCP tool schemas (`schemas`) | **Open — Apache-2.0** |
| `cli`, `mcp-server` | **Open — Apache-2.0** |
| `connectors` | **Split** — interfaces/stubs Apache-2.0, production connectors proprietary |
| `core` | **Source-available — FSL-1.1**, converts to Apache-2.0 after 2 years |
| `evidence`, `evals`, `ui`, `api`, `web` | **Closed — proprietary, cloud-only** |
| Relicensing Tier 1 later | **Forbidden** — pre-commit publicly to permanence |
| Act 1 model | Hybrid: flat base + per-H0-packet usage + capped outcome kicker on proven *savings* |
| Act 2 model | Usage-based metering ($0.25–$2 / H0 packet) + platform-commit / OEM tiers |
| % of managed spend | **Never** — perverse incentive, off-brand |
| Design-partner "price" | Benchmark corpus data, not dollars |
| Phase-C illustrative ARR | ~$1.6M plan / ~$2–3M upside |

### Sources

- [Anthropic — Donating MCP and establishing the Agentic AI Foundation](https://www.anthropic.com/news/donating-the-model-context-protocol-and-establishing-of-the-agentic-ai-foundation)
- [Linux Foundation — Formation of the Agentic AI Foundation](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation)
- [The New Stack — Anthropic Donates MCP to the AAIF](https://thenewstack.io/anthropic-donates-the-mcp-protocol-to-the-agentic-ai-foundation/)
- [Stripe on GitHub](https://github.com/stripe) · [How Stripe uses GitHub](https://github.com/customer-stories/stripe)
- [Supabase Docs — Architecture](https://supabase.com/docs/guides/getting-started/architecture) · [What Is Supabase (MindStudio)](https://www.mindstudio.ai/blog/what-is-supabase)
- [InfoQ — Sentry's Functional Source License](https://www.infoq.com/news/2023/12/functional-source-license/)
- [TechCrunch — Startups going "fair source"](https://techcrunch.com/2024/09/22/some-startups-are-going-fair-source-to-avoid-the-pitfalls-of-open-source-licensing/)
- [FOSSA — Fall 2024 Software Licensing Roundup](https://fossa.com/blog/fall-2024-software-licensing-roundup/)
- [HashiCorp — Adopts Business Source License](https://www.hashicorp.com/en/blog/hashicorp-adopts-business-source-license)
- [The New Stack — HashiCorp Abandons Open Source for BSL](https://thenewstack.io/hashicorp-abandons-open-source-for-business-source-license/)
- [ITPro — Analysis of HashiCorp BSL switch and community backlash](https://www.itpro.com/software/open-source/analysis-hashicorp-prioritizes-its-business-with-bsl-license-switch-but-community-upset-cannot-be-ignored)
- [n8n Docs — Sustainable Use License](https://docs.n8n.io/sustainable-use-license/) · [n8n — Announcing the Sustainable Use License](https://blog.n8n.io/announcing-new-sustainable-use-license/)
- [Inside n8n — fair-code platform (Medium)](https://medium.com/@takafumi.endo/inside-n8n-how-a-fair-code-open-source-platform-leads-ai-powered-workflow-automation-e8128890d496)
- [Synter — vs Hiring an Agency](https://syntermedia.ai/blog/synter-vs-hiring-agency) · [Synter homepage](https://syntermedia.ai/)
- [DOJO AI — Agency pricing models](https://www.dojoai.com/blog/the-agency-pricing-model-battle-fixed-fee-vs-percentage-vs-performance-based)
- [Get Ryze — Ad agency pricing models 2026](https://www.get-ryze.ai/blog/ad-agency-pricing-models-flat-fee-percentage)
- [HawkSEM — Marketing agency pricing](https://hawksem.com/blog/marketing-agency-pricing/)
- [Monetizely — 2026 Guide to SaaS, AI, and Agentic Pricing](https://www.getmonetizely.com/blogs/the-2026-guide-to-saas-ai-and-agentic-pricing-models)
- [SoftwareSeni — SaaS pricing shifting to usage and outcome](https://www.softwareseni.com/saas-pricing-is-shifting-from-per-seat-to-usage-and-outcome-what-changes-at-your-next-renewal/)
- [Flexprice — Why AI companies adopted usage-based pricing](https://flexprice.io/blog/why-ai-companies-have-adopted-usage-based-pricing)
