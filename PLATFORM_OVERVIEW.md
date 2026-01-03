# Xenon Platform Overview

**Document Purpose:** Canonical reference for all developers and AI instances working on this project.
**Last Updated:** 2026-01-03
**Status:** Authoritative

---

## Executive Summary

**This is a platform, not an app. The privacy isn't a feature - it's the entire value proposition.**

Xenon is a privacy-preserving behavioral identity platform that enables deep personalization without identity exposure. Users get genuine value from companies who understand them. Companies get legitimate access to engaged users. Neither can exploit the other because the architecture makes exploitation impossible.

---

## Core Philosophy

### The Problem We Solve

Today's internet forces a false choice:
- **Option A:** Give up your identity and behavior to companies who exploit both
- **Option B:** Stay private but get generic, impersonal experiences

### Our Solution

A third option:
> Companies can understand you deeply and engage you meaningfully, but they can never know WHO you are unless you explicitly choose to reveal yourself.

### The Fundamental Promise

**User identity will NEVER meet user data.**

- Identity = email, name, payment info, user_id (WHO you are)
- Data = behavioral patterns, traits, motivations, fingerprint (WHAT you're like)

These exist in completely separate systems with no technical ability to correlate them. This isn't a policy - it's architecture.

---

## Platform Architecture

### Three Independent Services

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   GATEKEEPER    │     │   FINGERPRINT   │     │      GOALS      │
│                 │     │                 │     │                 │
│  Identity Vault │     │ Interpretation  │     │   Engagement    │
│                 │     │     Engine      │     │     Layer       │
│  Knows WHO      │     │  Knows WHAT     │     │  Knows ACTIONS  │
│  you are        │     │  you're like    │     │  you take       │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         │    ┌─────────────────┐│                       │
         └───►│      USER       │◄───────────────────────┘
              │                 │
              │ Only the user   │
              │ holds all three │
              │ together        │
              └─────────────────┘
```

### Service Definitions

#### Gatekeeper (Identity Vault)
- **Purpose:** Secure authentication without leaking identity to apps
- **Knows:** Email, password/passkey, payment info, subscription status
- **Never knows:** What users do, their behavioral patterns, their fingerprint
- **Outputs:** Blind tokens that prove "valid user at tier X" without revealing identity
- **Repository:** https://github.com/mazzuckelli/gatekeeper
- **Infrastructure:** Separate Supabase project, separate Vercel deployment

#### Fingerprint (Interpretation Engine)
- **Purpose:** Store and interpret behavioral data encoded as symbols
- **Knows:** TSO7s (True Sets of 7), I-Ching hexagram patterns, derived traits
- **Never knows:** Who the user is - only ghost_id
- **Outputs:** Answers to questions ("Is focus > 70?"), not raw data exports
- **Key insight:** Scores are DERIVED on demand, not stored. The symbols require interpretation.
- **Repository:** To be created (currently embedded in Goals)
- **Infrastructure:** Will need separate Supabase project, separate Vercel deployment

#### Goals (Engagement Layer)
- **Purpose:** Where users take actions and companies engage with users
- **Knows:** Events, quests, activities - all tied to ghost_id only
- **Never knows:** User identity
- **Outputs:** Behavioral signals to Fingerprint, engagement interface for companies
- **Repository:** https://github.com/mazzuckelli/xenon-engine-web
- **Infrastructure:** Separate Supabase project (current), Vercel deployment (current)

### Why Three Separate Services?

**Architectural isolation enforces privacy guarantees:**

| If combined... | Risk |
|----------------|------|
| Gatekeeper + Fingerprint | Could correlate identity with behavioral profile |
| Fingerprint + Goals | Less critical, but breaks clean separation |
| All three | Single breach exposes everything |

**Separation requirements:**
- Separate Git repositories
- Separate Supabase projects (mandatory - different databases)
- Separate Vercel deployments (different domains, env vars)
- Communication only via defined APIs with blind tokens

---

## The TSO7 System (True Sets of 7)

### What It Is

User behavior is not stored as raw data or simple scores. It's encoded as **TSO7s** - True Sets of 7 symbols derived from I-Ching hexagrams.

```
User Input → AI Interpretation → TSO7 (7 hexagram symbols) → AI Interpretation → Traits
```

### Why This Matters

1. **Semantic encoding:** Human behavior expressed in ancient symbolic language
2. **Interpretation-dependent:** TSO7s are meaningless without the AI interpretation layer
3. **Non-exportable:** Can't just dump a user profile - it requires interpretation
4. **Re-interpretable:** Same symbols can yield evolving understanding as AI improves

### Privacy Implication

Traditional systems:
```
Database: focus_score = 87
Query: SELECT focus_score → Returns raw exploitable data
```

Xenon system:
```
Database: TSO7 symbols
Query: "Is focus > 70?" → Returns YES/NO (interpretation, not data)
```

The Fingerprint service answers questions without exposing underlying data. This is similar to zero-knowledge proofs but achieved through architecture rather than cryptography.

---

## Authentication Flow

### Current State (Transitional)

Goals currently uses direct Supabase Auth with JWT tokens. This creates identity exposure:
- user_id visible in Edge Functions
- user_bridges table links user_id to ghost_id
- Identity and behavior can be correlated through logs

### Target State (Gatekeeper-Only)

```
1. User clicks "Login" in Goals
         ↓
2. Redirect to Gatekeeper (gatekeeper.app/authorize)
         ↓
3. User authenticates at Gatekeeper (email/passkey)
         ↓
4. Gatekeeper issues blind token containing:
   - ghost_id (app-specific)
   - tier (subscription level)
   - expiration
   - NO user_id, NO email, NO identity
         ↓
5. User returns to Goals with blind token
         ↓
6. Goals validates blind token, extracts ghost_id
         ↓
7. All Goals operations use ghost_id only
         ↓
8. Goals NEVER sees user_id or email
```

### Blind Token Contents

```json
{
  "iat": 1704300000,
  "exp": 1704303600,
  "app_id": "goals-prod",
  "ghost_id": "4b2a43cf-6772-40d2-ed65-20046dadec00",
  "tier": "free",
  "nonce": "unique-token-id"
}
```

**What's NOT in the token:** user_id, email, name, or any identifying information.

---

## Current State Assessment

### What Exists

**Goals (xenon-engine-web):**
- Full web application with dashboard, quests, achievements, fingerprint visualization
- Event queue system for processing user inputs
- Cosmic Orchestrator (AI processing engine)
- TSO7 generation and trait derivation
- CSP-compliant frontend with security hardening
- Edge Functions for queue processing

**Gatekeeper:**
- Separate repository created
- Basic blind token issuance infrastructure
- User profiles and subscription management schema
- Passkey authentication scaffolding

### Known Issues Requiring Resolution

| Issue | Severity | Resolution |
|-------|----------|------------|
| Hardcoded user secrets in profile.js | CRITICAL | Move to Gatekeeper server-side for migration |
| user_id in passkey-auth-verify response | HIGH | Resolved when Gatekeeper-only auth implemented |
| user_id logging in Edge Functions | HIGH | Resolved when JWT auth paths removed |
| user_bridges table in Goals | STRUCTURAL | Remove after Gatekeeper migration |
| Gatekeeper CORS allows wildcard | HIGH | Restrict to specific origins |
| Session security tables have user_id | MEDIUM | Move to Gatekeeper or remove |

### What Doesn't Exist Yet

- Fingerprint as standalone service (currently embedded in Goals)
- Gatekeeper ↔ Goals integration
- Gatekeeper ↔ Fingerprint integration
- Company/developer access APIs
- User consent management UI
- Bundle installer for consumer deployment

---

## Business Model

### Value Proposition

**For Users:**
- Get personalized experiences without sacrificing privacy
- Control who sees what about you
- Revoke access anytime
- Never be the product

**For Companies:**
- Access deeply understood users for personalization
- Regulatory-compliant (never touch identity)
- Higher engagement from willing participants
- Future-proof against privacy regulation

### How It Works

```
Company: "We want to engage users with high Creativity and low Consistency"
         ↓
Fingerprint: Identifies matching ghost_ids (no identity)
         ↓
Goals: Surfaces engagement opportunity to matching users
         ↓
User: Chooses to engage (or not)
         ↓
Company: Gets engagement, never learns user identity
         ↓
User: Can reveal identity IF they choose to (earns trust)
```

### Revenue Streams (Planned)

1. **Subscription tiers** for users (premium features in Goals)
2. **API access** for companies (query Fingerprint, engage via Goals)
3. **Enterprise deployment** (self-hosted bundles)

---

## Development Priorities

### Phase 1: Gatekeeper Integration (Current)

**Objective:** Goals authenticates exclusively through Gatekeeper

**Tasks:**
1. Define Gatekeeper ↔ Goals API contract
2. Build auth module for Goals (redirect flow, token handling)
3. Build token issuance endpoint in Gatekeeper
4. Remove direct Supabase Auth from Goals
5. Remove user_bridges table
6. Remove all user_id references from Goals Edge Functions

**Success Criteria:** New user can sign up, authenticate via Gatekeeper, use Goals - and Goals never sees their email or user_id.

### Phase 2: Fingerprint Separation

**Objective:** Extract Fingerprint into standalone service

**Tasks:**
1. Create fingerprint repository
2. Create fingerprint Supabase project
3. Migrate TSO7 storage and trait tables
4. Build interpretation API endpoints
5. Build query API ("Is focus > 70?")
6. Update Goals to call Fingerprint service
7. Update Cosmic Orchestrator to write to Fingerprint

**Success Criteria:** TSO7s and traits live in Fingerprint service. Goals only sends events, receives interpreted results.

### Phase 3: Company Access Layer

**Objective:** Enable companies to engage users through the platform

**Tasks:**
1. Company registration in Gatekeeper
2. Scoped Fingerprint access (with user consent)
3. Engagement API in Goals
4. User consent management UI
5. Analytics dashboard for companies (anonymous metrics only)

**Success Criteria:** A company can query for users matching behavioral criteria, engage them through Goals, without ever learning identity.

### Phase 4: Bundle & Distribution

**Objective:** Packageable consumer product

**Tasks:**
1. Desktop app shell (Electron or Tauri)
2. Service orchestration (run all three locally)
3. Control panel UI
4. Installer for Windows/Mac/Linux
5. Mobile app (React Native) with same architecture

**Success Criteria:** User downloads one package, installs three isolated services, controls everything from one interface.

---

## Technical Standards

### Security Requirements

- All services use separate Supabase projects (mandatory)
- No user_id ever transmitted to Goals or Fingerprint
- Blind tokens signed with app-specific secrets
- All external scripts use SRI hashes
- CSP headers on all pages
- Rate limiting on all auth endpoints
- Constant-time comparison for all secret validation

### Code Organization

- Shared protocol types published as npm package
- Each service has its own repository
- Migrations never contain hardcoded production URLs
- Console logging never includes identity information
- All Edge Functions validate blind tokens, not JWTs

### API Design Principles

- Endpoints return answers, not raw data (where possible)
- ghost_id is the only user identifier outside Gatekeeper
- App-specific ghost_ids (user has different ghost in each app)
- Token refresh handled transparently
- Revocation propagates immediately

---

## For AI Instances

### When Working on This Project

1. **Read this document first** - It's the canonical reference
2. **Understand the three-service split** - Don't mix identity and behavior
3. **ghost_id is sacred** - It's the only identifier Goals/Fingerprint should ever see
4. **No logging user_id** - Ever, anywhere, even truncated
5. **TSO7s require interpretation** - Don't treat them as raw data

### Key Files to Understand

**Goals (xenon-engine-web):**
- `supabase/functions/cosmic-orchestrator/` - AI processing engine
- `supabase/functions/queue-enqueue/` - Event intake
- `supabase/functions/_shared/blind-token.ts` - Token validation
- `js/fingerprint.js` - Visualization (will move to Fingerprint service)

**Gatekeeper:**
- `supabase/functions/blind-token-issue/` - Token generation
- `migrations/` - Identity schema

### Questions to Ask Before Making Changes

1. Does this change expose user_id outside Gatekeeper?
2. Does this create correlation between identity and behavior?
3. Does this log anything that could identify a user?
4. Is this going in the right service (Gatekeeper vs Fingerprint vs Goals)?

---

## Glossary

| Term | Definition |
|------|------------|
| **Blind Token** | JWT that proves authentication without containing identity |
| **ghost_id** | Anonymous identifier used in Goals/Fingerprint. App-specific. |
| **user_id** | Supabase Auth identifier. ONLY exists in Gatekeeper. |
| **TSO7** | True Set of 7. Seven I-Ching hexagrams encoding behavioral data. |
| **Fingerprint** | Derived behavioral profile from TSO7 interpretation |
| **Gatekeeper** | Identity service. Knows WHO, issues blind tokens. |
| **Goals** | Engagement layer. Where users act and companies engage. |

---

## Contact & Coordination

**Primary Developer:** @mazzuckelli
**Repositories:**
- Goals: https://github.com/mazzuckelli/xenon-engine-web
- Gatekeeper: https://github.com/mazzuckelli/gatekeeper
- Fingerprint: (To be created)

**When starting work on any machine:**
1. Pull latest from all relevant repos
2. Read this PLATFORM_OVERVIEW.md
3. Check documentation/ folder for specific implementation details
4. Coordinate on contract changes across services

---

*This document should be updated whenever the platform architecture evolves.*
