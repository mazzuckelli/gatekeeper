# Xenon Platform Development Plan

**Created:** 2026-01-04
**Revised:** 2026-01-04
**Status:** Draft - Pending Approval

---

## Philosophy

### Why Isolated Development

This system, in the wrong hands, becomes the most powerful surveillance tool ever created. The only protection against that outcome is **architectural** - building a system where betrayal is impossible, not just against policy.

The moment an investor, partner, or employee with different incentives touches this during development, the architecture becomes negotiable. "We can't look" becomes "we choose not to look" becomes "we looked just this once."

Isolated development ensures:
- Privacy guarantees are baked into immutable architecture
- No one can ask "can we just add a little tracking" because the system can't do it
- The corruption points are eliminated before anyone with motive arrives

This is not MVP development. This is **final form** development in isolation, so that when it sees the world, it's already incorruptible.

---

## Architecture Overview

### The Three-Service Split

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   GATEKEEPER    │     │    DAWG TAG     │     │      GOALS      │
│    (Server)     │     │ (User's Device) │     │    (Server)     │
│                 │     │                 │     │                 │
│  Identity Vault │     │  Sovereign Key  │     │   Engagement    │
│                 │     │  + Data Hub     │     │     Layer       │
│                 │     │  + Glyph Display│     │                 │
│                 │     │                 │     │                 │
│  Knows:         │     │  Knows:         │     │  Knows:         │
│  - user_id      │     │  - ghost_secret │     │  - ghost_id     │
│  - email        │     │  - linked svcs  │     │  - TSO7s        │
│  - password     │     │  - OAuth tokens │     │  - activities   │
│  - subscription │     │  - sensor data  │     │  - behavior     │
│                 │     │                 │     │                 │
│  Never knows:   │     │  Never stores:  │     │  Never knows:   │
│  - which apps   │     │  - user_id      │     │  - user_id      │
│  - ghost_id     │     │  - ghost_ids    │     │  - email        │
│  - behavior     │     │    (computed    │     │  - real name    │
│                 │     │     on demand)  │     │  - which external│
│                 │     │                 │     │    services     │
└────────┬────────┘     └────────┬────────┘     └─────────────────┘
         │                       │
         │  user_id              │  ghost_id + data
         │  (transient)          │  (tagged for Goals)
         ▼                       ▼
    Dawg Tag receives       Goals receives
    user_id in RAM,         only ghost_id,
    discards immediately    never knows source
```

### The Fundamental Rule

**User identity and user behavior must NEVER meet except on the user's own physical device.**

This is not policy. It is architecture. The system makes betrayal impossible.

---

## Service Definitions

### 1. Gatekeeper (Server)

**Purpose:** Identity vault. Authentication only.

**What it does:**
- Authenticates users (email/password, passkey)
- Returns user_id to Dawg Tag upon successful auth
- Manages subscriptions and billing
- Nothing else

**What it holds:**
- user_id
- Email
- Password/passkey credentials
- Subscription status
- Account settings

**What it NEVER knows:**
- ghost_secret
- ghost_id
- Which apps user accesses
- What user does in any app
- Which external services user links

**Key constraint:** Gatekeeper receives NO information about which app triggered authentication. It only knows "user authenticated."

### 2. Dawg Tag (Mobile App → Future Physical Device)

**Purpose:** User's sovereign key, data hub, and identity display. The ONLY place where identity and behavior can be linked.

**Core Functions:**

#### 2.1 Identity Vault
- Stores `ghost_secret` in secure hardware (Keystore/Secure Enclave)
- Generates unique `ghost_id` per app: `hash(user_id + ghost_secret + app_id)`
- Receives `user_id` transiently from Gatekeeper (RAM only, immediately discarded)
- Never persists `user_id` or computed `ghost_ids`

#### 2.2 Authentication Bridge
- Receives auth requests from Xenon ecosystem apps
- Calls Gatekeeper to authenticate (Gatekeeper doesn't know which app)
- Computes app-specific ghost_id
- Returns ghost_id directly to requesting app
- Manages consent for third-party apps (popup approval)

#### 2.3 External Service Hub
- Stores OAuth tokens for linked external services (PSN, Spotify, Fitbit, etc.)
- Manages service connections (link, unlink, re-authorize)
- User can see all linked services in one place
- External services are DATA SOURCES, not Xenon apps (no ghost_id for them)

#### 2.4 Data Sync Engine
- Runs scheduled background tasks (daily or configurable)
- Pulls data from each linked external service using stored OAuth tokens
- Strips source-identifying information
- Tags all data with ghost_id_goals
- Pushes to Goals API
- Goals never knows which external services user has linked

#### 2.5 Sensor Collection
- GPS location (background)
- Accelerometer (movement patterns)
- Gyroscope (activity detection)
- Future: biometric proximity (is device on user's body)
- Data tagged with ghost_id_goals, synced to Goals for challenge verification

#### 2.6 Consent Manager
- Shows user which Xenon apps they've authorized
- Shows user which external services they've linked
- Allows revoking access to any app or service
- Third-party Xenon apps trigger consent popup here

#### 2.7 Backup & Recovery
- Export ghost_secret as encrypted QR code (password protected)
- Import ghost_secret on new device
- Recovery path for device loss

#### 2.8 Contextual Glyph Display
- Renders activity-based visual glyph on screen
- **Contextual:** Changes based on current activity/location
- **Earned:** Reflects actual completed activities from Goals data
- **Skill-based:** Shows level/rank in specific domain (running, dancing, gaming, etc.)

**Glyph Generation:**
```
Input:  ghost_secret + activity category + experience aggregate from Goals
Output: Visual glyph representing skill level in that activity

Examples:
- At 5K race → Advanced runner glyph (many completed running events)
- At dance class → Novice dancer glyph (one prior event)
- At gaming meetup → Intermediate gamer glyph (moderate achievements)
```

**Glyph Properties:**
| Property | Description |
|----------|-------------|
| Contextual | Changes based on where you are / what you're doing |
| Earned | Reflects actual completed activities, not self-reported |
| Skill-based | Shows level/rank in that specific domain |
| Verifiable | Others can trust it - derived from real data |
| Private | Shows rank without identity or full history |
| Social | Visual proof of experience without revealing who you are |

#### 2.9 Physical Device Readiness

Everything built in the mobile app transfers to the physical device:
- ghost_secret → Dedicated secure chip
- Authentication → NFC tap
- External OAuth → Bluetooth to phone for complex flows
- Data sync → WiFi module or Bluetooth to phone
- Sensors → Built-in or paired
- Glyph display → Small e-ink or OLED screen

**What Dawg Tag stores:**

| Data | Stored | Notes |
|------|--------|-------|
| ghost_secret | Yes, secure hardware | Never leaves device except QR backup |
| Authorized Xenon apps | Yes, local list | For consent management UI |
| Linked external services | Yes, with OAuth tokens | For data sync |
| Activity aggregates | Yes, synced from Goals | For glyph generation |
| Sensor data | Temporarily | Synced to Goals, then discarded |
| user_id | **NEVER** | Transient in RAM only during auth |
| ghost_ids | **NEVER persisted** | Computed on demand, discarded |

### 3. Goals (Server + Web + Mobile)

**Purpose:** Engagement layer. Where users take actions, earn rewards, and build their behavioral fingerprint.

**What it does:**
- Captures user inputs and activities
- Generates TSO7s via Cosmic Orchestrator
- Stores behavioral data tied to ghost_id only
- Manages challenges, quests, achievements
- Processes data synced from Dawg Tag (external services, sensors)
- Renders fingerprint visualization (client-side)
- Calculates activity aggregates for glyph generation

**What it holds (by ghost_id only):**
- TSO7s (True Sets of Seven)
- cosmic_ledger (event history)
- Globs (interpreted TSO7 structures)
- Activity completions and experience per category
- Quests, achievements, rewards
- Subscription tier (synced from Gatekeeper via token)

**What it NEVER knows:**
- user_id
- Email
- Real name
- Which external services user has linked (just receives "gaming data", "fitness data", etc.)

---

## Authentication Flow

```
1. User opens Goals app
              ↓
2. Goals → Dawg Tag: "I need auth, app_id = 'goals'"
              ↓
3. Dawg Tag → Gatekeeper: "Authenticate user"
   (NO app_id sent - Gatekeeper doesn't know Goals exists)
              ↓
4. Gatekeeper presents login UI (email/password or passkey)
              ↓
5. User authenticates successfully
              ↓
6. Gatekeeper returns user_id to Dawg Tag
   (Gatekeeper's job is DONE - it knows nothing else)
              ↓
7. Dawg Tag receives user_id in RAM (never persisted)
              ↓
8. Dawg Tag computes: ghost_id = hash(user_id + ghost_secret + "goals")
              ↓
9. Dawg Tag DISCARDS user_id from memory
              ↓
10. Dawg Tag → Goals: returns ghost_id directly
              ↓
11. Goals creates session using ghost_id
              ↓
12. User is logged in
```

---

## External Service Linking Flow

```
1. User in Goals taps "Link PlayStation"
              ↓
2. Goals → Dawg Tag: "User wants to link PSN"
              ↓
3. Dawg Tag opens PSN OAuth (Sony's login page)
              ↓
4. User authenticates with Sony directly
              ↓
5. Sony returns OAuth token to Dawg Tag
              ↓
6. Dawg Tag stores locally:
   - PSN OAuth token
   - "psn" in list of linked services
              ↓
7. Dawg Tag → Goals: "PSN linked successfully"
              ↓
8. Goals shows "PlayStation Connected ✓"
   (Goals does NOT store any PSN identifier)
```

---

## External Service Sync Flow

```
1. Dawg Tag background task wakes up (daily schedule)
              ↓
2. Dawg Tag checks linked services → [PSN, Spotify, Fitbit]
              ↓
3. For each service:
   - Fetch data using stored OAuth token
   - Strip source-identifying information
   - Tag with ghost_id_goals
   - Categorize (gaming, music, fitness)
              ↓
4. Dawg Tag → Goals API:
   {
     ghost_id: "abc123",
     source_category: "gaming",  // NOT "psn"
     events: [
       {type: "trophy", name: "Mass Effect Platinum", date: "..."},
       {type: "playtime", hours: 40, period: "week"}
     ]
   }
              ↓
5. Goals stores activities by category
   Goals NEVER knows it came from PSN specifically
              ↓
6. Goals updates activity aggregates
              ↓
7. Next time user opens Dawg Tag, glyph reflects new data
```

---

## Ephemeral Request IDs (Critical Privacy Feature)

### The Problem

When Goals calls external AI APIs (Claude, GPT, Grok, Gemini) for TSO7 interpretation, including `ghost_id` creates a correlation point at the AI provider.

### The Solution

Strip `ghost_id` from all outbound API calls. Use ephemeral `request_id` that exists only in RAM.

```typescript
// CRITICAL: Never log or persist this mapping

const requestId = crypto.randomUUID();
const pendingRequests = new Map<string, string>();
pendingRequests.set(requestId, ghostId);

// Outbound - NO ghost_id
const response = await callExternalAI({
  request_id: requestId,
  tso7: rawTso7,
  prompt: interpretationPrompt
});

// Re-associate and destroy mapping
const originalGhostId = pendingRequests.get(response.request_id);
pendingRequests.delete(requestId);

await storeTso7(originalGhostId, response.interpretation);
```

### What Each Party Sees

| Party | Sees |
|-------|------|
| AI provider | request_id + TSO7 (orphaned, uncorrelatable) |
| Goals | ghost_id + TSO7 (anonymous) |
| Gatekeeper | user_id + email (no behavior) |
| Subpoena (all parties) | **No chain connecting identity → behavior** |

---

## Enclave Boundaries (Future)

Mark all code handling plaintext TSO7s/globs with:

```typescript
// ENCLAVE BOUNDARY - Future: move to secure enclave
// This code handles plaintext behavioral data
```

Future state: TSO7s encrypted at rest, decrypted only inside AWS Nitro Enclave or equivalent. Goals becomes architecturally blind to behavioral data - can only ask questions, never see raw answers.

---

## Subpoena/Breach Protection Matrix

| Threat | What's Exposed | What's Protected |
|--------|----------------|------------------|
| Goals breach | ghost_ids + behavioral data | Real identity, external service links |
| Gatekeeper breach | user_ids + emails | Behavior, ghost_ids, which apps used |
| AI provider breach | Orphaned symbolic data | ghost_id, identity |
| Dawg Tag device theft | One user's ghost_secret | All other users, server data |
| Subpoena all three servers | No chain exists to produce | Identity ↔ behavior correlation |
| Future SST corruption | Architecturally blind (with enclave) | All plaintext behavioral data |

The only way to link identity to behavior: **Seize the user's physical device and extract ghost_secret.**

---

## Development Phases

### Phase 1: Gatekeeper Simplification

**Objective:** Strip Gatekeeper to auth-only service.

**Remove:**
- ghost_id generation code (ghostKeys.ts)
- Blind token issuance
- App registration and secrets
- User-app connections
- QR backup functionality

**Keep:**
- User registration/login
- Password reset
- Passkey authentication
- Profile management
- Subscription/billing (Stripe)
- Account deletion

**Create:**
- Simple auth endpoint that returns user_id to Dawg Tag only
- Device attestation to verify legitimate Dawg Tag requests

**Success Criteria:** Gatekeeper authenticates users and returns user_id. Nothing else.

### Phase 2: Dawg Tag (Full Product)

**Objective:** Build complete Dawg Tag mobile app - not MVP, full product.

**Repository:** `dawg-tag` (new)

#### 2.1 Core Identity
- React Native / Expo
- Secure storage for ghost_secret (Keystore/Secure Enclave)
- ghost_id computation: `hash(user_id + ghost_secret + app_id)`
- QR backup/restore with password encryption

#### 2.2 Authentication Bridge
- Deep link handler for app auth requests
- Gatekeeper communication (receive user_id, discard immediately)
- Return ghost_id to requesting app
- Third-party consent popup UI

#### 2.3 External Services
- OAuth flow handling for PSN, Spotify, Fitbit, etc.
- Secure token storage
- Service management UI (link, unlink, view status)

#### 2.4 Data Sync Engine
- Background task scheduling
- Fetch from all linked services
- Strip identifiers, tag with ghost_id_goals
- Push to Goals API
- Configurable sync frequency

#### 2.5 Sensor Collection
- GPS background tracking
- Accelerometer integration
- Gyroscope integration
- Data packaging and sync to Goals

#### 2.6 Consent Manager UI
- List of authorized Xenon apps
- List of linked external services
- Revocation controls
- Clear activity history option

#### 2.7 Glyph System
- Activity category taxonomy (fitness/running, fitness/cycling, gaming, social/dance, etc.)
- Experience level calculation per category
- Glyph generation algorithm
- Context detection (GPS, event check-in, manual selection)
- Glyph renderer (visual display)
- Full-screen glyph display mode for showing others

#### 2.8 Settings & Recovery
- Backup ghost_secret to QR
- Restore from QR
- Account settings
- Privacy controls

**Success Criteria:** Complete, production-quality app that handles all identity, sync, and glyph functions.

### Phase 3: Goals Integration

**Objective:** Goals authenticates via Dawg Tag, receives synced data.

**Remove from Goals:**
- Direct Supabase Auth
- Login/registration UI
- user_bridges table
- All user_id references in Edge Functions

**Add to Goals:**
- Dawg Tag auth flow (deep link out, receive ghost_id back)
- API endpoints for Dawg Tag data sync
- Activity categorization for incoming data
- Activity aggregate calculations (for glyph generation)
- Endpoint for Dawg Tag to fetch activity aggregates

**Implement:**
- Ephemeral request_id for all AI API calls
- ENCLAVE BOUNDARY comments on TSO7/glob handling

**Success Criteria:**
- New user downloads Dawg Tag and Goals
- Creates account via Gatekeeper (through Dawg Tag)
- Uses Goals with ghost_id only
- Links PSN, sees gaming data in Goals
- Dawg Tag displays contextual glyph based on Goals activity data

### Phase 4: Production Hardening

**Objective:** Security, reliability, polish.

- Device attestation (Gatekeeper verifies Dawg Tag requests)
- Rate limiting across all services
- Audit logging (identity-free in Goals, behavior-free in Gatekeeper)
- Recovery flow testing
- Performance optimization
- Error handling and edge cases
- Documentation

---

## Repository Structure

```
xenon-platform/
├── gatekeeper/              # Identity vault (server) - Auth only
│   ├── app/                 # React web UI (login, account mgmt)
│   └── supabase/            # Edge Functions, migrations
│
├── dawg-tag/                # User's sovereign key (mobile) - NEW
│   ├── src/
│   │   ├── identity/        # ghost_secret, ghost_id computation
│   │   ├── auth/            # Gatekeeper bridge, app auth
│   │   ├── services/        # External OAuth, token storage
│   │   ├── sync/            # Background data sync engine
│   │   ├── sensors/         # GPS, accelerometer, gyroscope
│   │   ├── consent/         # App/service management UI
│   │   ├── glyph/           # Context detection, generation, display
│   │   ├── backup/          # QR export/import
│   │   └── ui/              # Screens and components
│   └── ...
│
├── xenon-engine-web/        # Goals (server + web)
│   ├── supabase/            # Edge Functions, migrations
│   └── js/                  # Web frontend
│
└── documentation/
    ├── PLATFORM_OVERVIEW.md
    ├── MASTER_PLAN.md
    └── GATEKEEPER_PLAN.md   # This document
```

---

## Glyph System Design

### Activity Taxonomy

```
fitness/
  ├── running
  ├── cycling
  ├── swimming
  ├── weightlifting
  ├── yoga
  └── general

gaming/
  ├── playstation
  ├── xbox
  ├── pc
  ├── mobile
  └── tabletop

social/
  ├── dance
  ├── music
  ├── art
  └── community

professional/
  ├── speaking
  ├── leadership
  └── technical

creative/
  ├── writing
  ├── visual
  ├── audio
  └── performance
```

### Experience Levels

| Level | Name | Criteria (example for running) |
|-------|------|--------------------------------|
| 0 | None | No recorded activity |
| 1 | Novice | 1-5 events completed |
| 2 | Beginner | 6-15 events |
| 3 | Intermediate | 16-50 events |
| 4 | Advanced | 51-150 events |
| 5 | Expert | 151-500 events |
| 6 | Master | 500+ events |

### Glyph Generation

```
Input:
  - ghost_secret (for uniqueness/verification)
  - activity_category (e.g., "fitness/running")
  - experience_level (0-6)
  - optional: specific achievements

Output:
  - Visual glyph (SVG or canvas rendering)
  - Base shape determined by category
  - Complexity/ornamentation determined by level
  - Unique flourishes from ghost_secret (subtle, not identifying)
```

### Context Detection

Priority order:
1. Manual selection ("I'm at a running event")
2. NFC tap (event registration beacon)
3. GPS + known event locations
4. Recent app activity in Goals
5. Default to highest-level category

---

## Immediate Action Items

### This Week: Gatekeeper

1. Create branch `simplify-auth-only`
2. Remove ghost_id, blind token, app consent code
3. Create simple `/auth/authenticate` endpoint
4. Test basic auth still works
5. Document minimal API

### This Week: Dawg Tag Foundation

1. Create `dawg-tag` repository
2. Initialize Expo React Native project
3. Implement secure storage for ghost_secret
4. Implement ghost_id computation
5. Implement basic Gatekeeper auth bridge
6. Test: App requests auth → Dawg Tag → Gatekeeper → ghost_id returned

### Next: Dawg Tag External Services

1. PSN OAuth integration
2. Token storage
3. Basic sync (manual trigger first)
4. Data transformation and Goals API push

### Next: Dawg Tag Glyph

1. Define activity taxonomy
2. Build experience calculation
3. Design glyph visual language
4. Implement glyph renderer
5. Add context detection
6. Full-screen display mode

### Parallel: Goals Updates

1. Add API for Dawg Tag data sync
2. Add activity categorization
3. Implement ephemeral request_id
4. Mark ENCLAVE BOUNDARY comments
5. Remove direct auth (after Dawg Tag ready)

---

## Open Questions Resolved

| Question | Answer |
|----------|--------|
| Web-only users? | No. Phone with Dawg Tag required. |
| First-party data sharing? | Fingerprint embedded in Goals. No cross-service query needed. |
| External service ghost_ids? | Not needed. External services are data sources, not Xenon apps. OAuth only. |
| Where is correlation stored? | Nowhere on servers. Dawg Tag syncs data pre-tagged with ghost_id_goals. |
| Third-party consent? | Popup in Dawg Tag. |
| Sensor data destination? | Goals, for challenge verification. Tagged with ghost_id_goals by Dawg Tag. |
| Glyph on physical device? | Yes. Build glyph system now on phone, transfers to device screen later. |

---

## Success Criteria (End State)

A user can:

1. Download Dawg Tag and Goals
2. Create account (Gatekeeper auth via Dawg Tag)
3. Use Goals with ghost_id (Goals never sees identity)
4. Link PSN, Spotify, Fitbit (OAuth via Dawg Tag)
5. See external data appear in Goals (categorized, no source identification)
6. Complete activities, earn experience
7. Show contextual glyph at events (skill level visible, identity hidden)
8. Lose phone, restore via QR backup, continue with same identity
9. Revoke any app or service access at will

And neither Gatekeeper, Goals, nor any external service can:
- Link identity to behavior
- Know which other services the user uses
- Produce correlation data under subpoena

The user's identity and behavior meet **only on their physical device**.

---

*This is not an MVP. This is the foundation that must be incorruptible before anyone else sees it.*
