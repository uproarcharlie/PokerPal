# PokerPal Scripts Guide

This document provides a comprehensive overview of all available npm scripts in the PokerPal project.

---

## Development Scripts

### `npm run dev`
**Purpose:** Start the development server with hot module replacement (HMR)

**What it does:**
- Starts the Express backend server on port 3000 (default)
- Starts Vite development server for frontend
- Enables hot reload for both frontend and backend changes
- Sets `NODE_ENV=development`
- Serves the application at `http://localhost:3000`

**When to use:**
- During active development
- When you want instant feedback on code changes
- For testing features locally

**Example:**
```bash
npm run dev
```

**Output:**
- Backend: Express server logs
- Frontend: Vite dev server with HMR updates
- Database queries logged in terminal

---

## Build & Production Scripts

### `npm run build`
**Purpose:** Build the application for production deployment

**What it does:**
- Builds the frontend using Vite (optimized, minified)
- Bundles the backend using esbuild
- Outputs client assets to `dist/public`
- Outputs server bundle to `dist/index.js`

**When to use:**
- Before deploying to production
- To test production build locally
- For performance testing

**Example:**
```bash
npm run build
```

**Output:**
- `dist/public/` - Frontend static assets
- `dist/index.js` - Backend server bundle

---

### `npm run start`
**Purpose:** Start the production server

**What it does:**
- Runs the built application from `dist/index.js`
- Sets `NODE_ENV=production`
- Serves optimized, minified assets
- No hot reload (production mode)

**When to use:**
- After running `npm run build`
- In production environment
- For testing production build

**Example:**
```bash
npm run build
npm run start
```

**Prerequisites:**
- Must run `npm run build` first

---

## Database Scripts

### `npm run db:push`
**Purpose:** Push database schema changes to PostgreSQL

**What it does:**
- Uses Drizzle Kit to sync schema with database
- Creates/updates tables based on `shared/schema.ts`
- Applies migrations automatically
- Does NOT create migration files (direct push)

**When to use:**
- After modifying `shared/schema.ts`
- During development when iterating on schema
- For quick schema updates without migration history

**Example:**
```bash
npm run db:push
```

**⚠️ Warning:**
- Not recommended for production
- Can cause data loss if not careful
- Use migrations for production deployments

---

## Type Checking Scripts

### `npm run check`
**Purpose:** Run TypeScript type checking

**What it does:**
- Runs `tsc` (TypeScript compiler) in check mode
- Validates types across the entire codebase
- Does NOT emit any files
- Reports type errors

**When to use:**
- Before committing code
- To catch type errors
- As part of CI/CD pipeline

**Example:**
```bash
npm run check
```

**Output:**
- Success: No output (exit code 0)
- Errors: List of type errors with file locations

---

## Testing Scripts

### `npm run test:tournament`
**Purpose:** Run complete tournament lifecycle integration test (keeps data)

**What it does:**
- Creates a complete tournament from scratch:
  - Club creation
  - Season setup
  - Points system configuration
  - Player registration (8 players)
  - Tournament creation and execution
  - Rebuys, addons, eliminations
  - Prize and points distribution
- Runs through all 16 stages of tournament lifecycle
- **KEEPS all test data in database** for inspection
- Provides detailed, color-coded terminal output

**When to use:**
- To verify tournament system works end-to-end
- To generate sample/demo data
- Before deploying major changes
- For integration testing

**Example:**
```bash
npm run test:tournament
```

**Output:**
- ✅ Detailed step-by-step logs (color-coded)
- 📊 Final standings table
- 🔑 IDs of created entities (club, season, tournament)
- ✓ Success/failure indicators

**What gets created:**
- 1 Club ("Test Poker Club")
- 1 Season ("Spring 2025 Test Season")
- 1 Points System with 6 allocations
- 8 Players (Alice, Bob, Charlie, Diana, Edward, Fiona, George, Hannah)
- 1 Completed Tournament with:
  - Full standings (1st-8th place)
  - Prizes distributed ($380 total pool)
  - Points awarded
  - High hand winners
  - Activity log entries

**Duration:** 2-5 seconds

---

### `npm run test:tournament:cleanup`
**Purpose:** Run complete tournament lifecycle integration test (deletes data after)

**What it does:**
- Same as `test:tournament` but with cleanup
- Creates and executes a full tournament
- Runs through all 16 stages
- **DELETES all test data** at the end
- Leaves database in original state

**When to use:**
- For CI/CD automated testing
- When you don't want test data lingering
- For repeated test runs
- To verify cleanup/cascade deletes work correctly

**Example:**
```bash
npm run test:tournament:cleanup
```

**Output:**
- Same detailed logs as `test:tournament`
- Additional cleanup logs at the end
- ✓ Confirmation of data deletion

**Cleanup includes:**
- Deletes club (cascades to season, points system, tournament, registrations, activity log)
- Deletes 8 test players individually
- Verifies all data removed

**Duration:** 2-5 seconds

---

### `npm run test:tournament:setup`
**Purpose:** Create tournament at registration phase (stops before starting)

**What it does:**
- Creates club, season, points system
- Creates 6 players
- Creates tournament with status "scheduled"
- Registers 3 players (3 more available)
- **STOPS HERE** - tournament ready for registration
- **KEEPS data** in database

**When to use:**
- Testing tournament creation flow
- Testing player registration process
- Testing payment confirmation
- Testing tournament status changes to "in_progress"

**Example:**
```bash
npm run test:tournament:setup
```

**What gets created:**
- 1 Club ("Setup Test Club")
- 1 Season ("Winter 2025 Registration Test")
- 1 Points System (15 participation, 3 knockout points)
- 6 Players available
- 1 Tournament (status: **scheduled**)
- 3 Players registered, 3 more can register

**Test scenarios enabled:**
- ✓ Register remaining players
- ✓ Confirm payments
- ✓ Start tournament
- ✓ Registration flow

**Duration:** 1-2 seconds

---

### `npm run test:tournament:active`
**Purpose:** Create tournament in-progress (ready for eliminations)

**What it does:**
- Creates complete tournament infrastructure
- Registers all 8 players
- Starts tournament (status: **in_progress**)
- Locks prize pool
- Processes some rebuys (2 players) and addons (4 players)
- **STOPS HERE** - tournament active, no eliminations yet
- **KEEPS data** in database

**When to use:**
- Testing player elimination flow
- Testing knockout tracking
- Testing final position recording
- Testing high hand assignment
- Testing prize/points calculation

**Example:**
```bash
npm run test:tournament:active
```

**What gets created:**
- 1 Club ("In-Progress Test Club")
- 1 Season ("Summer 2025 Active Tournament")
- 1 Points System (20 participation, 10 knockout)
- 8 Players (all registered)
- 1 Tournament (status: **in_progress**)
- Prize pool locked ($540 with 10% rake)
- 2 rebuys, 4 addons already processed

**Test scenarios enabled:**
- ✓ Eliminate players
- ✓ Track knockouts
- ✓ Record final positions
- ✓ Assign high hands
- ✓ Calculate prizes
- ✓ Award points
- ✓ Complete tournament

**Duration:** 2-3 seconds

---

### `npm run test:tournament:final`
**Purpose:** Create tournament at final table (4 players remaining)

**What it does:**
- Creates complete tournament infrastructure
- Registers all 8 players with rebuys/addons
- Starts tournament and locks prize pool
- Eliminates 4 players (8th, 7th, 6th, 5th place)
- **STOPS HERE** - final table of 4 players
- **KEEPS data** in database

**When to use:**
- Testing final table dynamics
- Testing top 3 prize distribution
- Testing high hand winner selection
- Testing points for top finishers
- Testing tournament completion

**Example:**
```bash
npm run test:tournament:final
```

**What gets created:**
- 1 Club ("Final Table Test Club")
- 1 Season ("Autumn 2025 Finals Season")
- 1 Points System (25 participation, 15 knockout, 200/140/100/70 points)
- 8 Players
- 1 Tournament (status: **in_progress**)
- Prize pool locked ($736 with 8% rake)
- 4 players eliminated (positions 5-8)
- **4 players at final table** competing for top 3 prizes

**Prize structure:**
- 1st: $368 (50%)
- 2nd: $220.80 (30%)
- 3rd: $147.20 (20%)

**Test scenarios enabled:**
- ✓ Final table eliminations (4 → 3 → 2 → 1)
- ✓ Prize distribution to top 3
- ✓ High hand winner ($80)
- ✓ Points allocation (200/140/100/70)
- ✓ Tournament completion

**Duration:** 2-3 seconds

---

## Script Dependencies

### Required Environment Variables

All scripts require a `.env` file with:

```bash
DATABASE_URL=postgresql://user:password@host:port/database
SESSION_SECRET=your-session-secret-here
PORT=3000  # Optional, defaults to 3000
NODE_ENV=development  # Set by scripts automatically
```

### Database Requirements

- PostgreSQL 15+ running and accessible
- Database created (specified in `DATABASE_URL`)
- User with CREATE/ALTER/DROP permissions

---

## Common Workflows

### Development Workflow
```bash
# Start development server
npm run dev

# In another terminal, check types
npm run check

# Push schema changes
npm run db:push
```

### Production Deployment
```bash
# Build application
npm run build

# Start production server
npm run start
```

### Testing Workflow
```bash
# Run integration test (keeps data)
npm run test:tournament

# Or run with cleanup
npm run test:tournament:cleanup

# Check types
npm run check
```

### Schema Changes
```bash
# 1. Modify shared/schema.ts
# 2. Push changes to database
npm run db:push

# 3. Test with sample data
npm run test:tournament

# 4. Verify types still work
npm run check
```

---

## Script Execution Order

### First Time Setup
1. `npm install` - Install dependencies
2. Setup `.env` file
3. `npm run db:push` - Create database schema
4. `npm run test:tournament` - Generate sample data
5. `npm run dev` - Start development

### Daily Development
1. `npm run dev` - Start development server
2. Make changes
3. `npm run check` - Verify types (optional)
4. `npm run db:push` - If schema changed

### Pre-Deployment
1. `npm run check` - Verify types
2. `npm run test:tournament:cleanup` - Integration test
3. `npm run build` - Build production bundle
4. `npm run start` - Test production build

---

## Troubleshooting

### `npm run dev` fails
- ✓ Check PostgreSQL is running
- ✓ Verify `DATABASE_URL` in `.env`
- ✓ Ensure port 3000 is available

### `npm run db:push` fails
- ✓ Database exists
- ✓ User has CREATE permissions
- ✓ No syntax errors in `shared/schema.ts`

### `npm run test:tournament` fails
- ✓ Database is accessible
- ✓ No conflicting data with same names
- ✓ Sufficient database permissions

### Type errors on `npm run check`
- ✓ Run `npm install` to ensure dependencies are up to date
- ✓ Check for TypeScript errors in modified files
- ✓ Verify imports are correct

---

## Additional Notes

- All scripts use `tsx` for TypeScript execution (no compilation needed for dev)
- Frontend uses Vite for fast HMR
- Backend uses `tsx` with watch mode in development
- Production uses compiled/bundled JavaScript for performance
- Test scripts use direct database access (not HTTP API)

---

## Quick Reference

| Command | Purpose | Stage | Keeps Data? |
|---------|---------|-------|------------|
| `npm run dev` | Development server | - | - |
| `npm run build` | Production build | - | - |
| `npm run start` | Start production | - | - |
| `npm run check` | Type check | - | - |
| `npm run db:push` | Update schema | - | Yes |
| `npm run test:tournament` | Full lifecycle test | Completed | ✅ Yes |
| `npm run test:tournament:cleanup` | Full lifecycle test | Completed | ❌ No |
| `npm run test:tournament:setup` | Registration phase test | Scheduled | ✅ Yes |
| `npm run test:tournament:active` | Active tournament test | In Progress | ✅ Yes |
| `npm run test:tournament:final` | Final table test | Final Table | ✅ Yes |

### Test Script Stages

- **Scheduled** (setup) - Tournament created, accepting registrations
- **In Progress** (active) - Tournament running, ready for eliminations
- **Final Table** (final) - 4 players remaining, ready for completion
- **Completed** (tournament/cleanup) - Full lifecycle to completion

---

## Test Scripts Comparison

### What Each Test Creates

#### 🎯 `test:tournament:setup` - Registration Phase
**Status:** scheduled
**Created:**
- 1 Club ("Setup Test Club")
- 1 Season ("Winter 2025 Registration Test")
- 1 Points System (15 participation, 3 knockout points)
- 6 Players available
- 1 Tournament (max 12 players)
- 3 Players registered, **3 more can register**

**Test Scenarios:**
- ✓ Register remaining players
- ✓ Confirm payments
- ✓ Start tournament (change to in_progress)
- ✓ Registration flow validation

**Use When:** Testing tournament creation and registration processes

---

#### 🎯 `test:tournament:active` - Tournament Running
**Status:** in_progress
**Created:**
- 1 Club ("In-Progress Test Club")
- 1 Season ("Summer 2025 Active Tournament")
- 1 Points System (20 participation, 10 knockout)
- 8 Players (all registered)
- 1 Tournament with locked prize pool ($540)
- 2 rebuys, 4 addons processed
- **0 eliminations** - all 8 players still active

**Test Scenarios:**
- ✓ Eliminate players
- ✓ Track knockouts
- ✓ Record final positions
- ✓ Assign high hands
- ✓ Calculate prizes
- ✓ Award points
- ✓ Complete tournament

**Use When:** Testing active tournament features (eliminations, knockouts, positions)

---

#### 🎯 `test:tournament:final` - Final Table
**Status:** in_progress (final table)
**Created:**
- 1 Club ("Final Table Test Club")
- 1 Season ("Autumn 2025 Finals Season")
- 1 Points System (25 participation, 15 knockout, 200/140/100/70 points)
- 8 Players
- 1 Tournament with locked prize pool ($736)
- 4 players eliminated (positions 5-8)
- **4 players at final table** competing for top 3

**Prize Structure:**
- 1st: $368 (50%)
- 2nd: $220.80 (30%)
- 3rd: $147.20 (20%)

**Test Scenarios:**
- ✓ Final table eliminations (4 → 3 → 2 → 1)
- ✓ Prize distribution to top 3
- ✓ High hand winner ($80)
- ✓ Points allocation (200/140/100/70)
- ✓ Tournament completion

**Use When:** Testing final table dynamics and prize/points distribution

---

#### 🎯 `test:tournament` - Complete Lifecycle
**Status:** completed
**Created:**
- 1 Club ("Test Poker Club")
- 1 Season ("Spring 2025 Test Season")
- 1 Points System with 6 allocations
- 8 Players (Alice, Bob, Charlie, Diana, Edward, Fiona, George, Hannah)
- 1 Completed Tournament with:
  - Full standings (1st-8th place)
  - Prizes distributed ($380 total pool)
  - Points awarded (100/75/60/50/40/30 + participation)
  - High hand winners
  - Complete activity log

**Runs Through 16 Steps:**
1. Create club
2. Create season
3. Create points system
4. Create points allocations
5. Create players
6. Create tournament
7. Register players
8. Start tournament
9. Lock prize pool
10. Process rebuys/addons
11. Eliminate players
12. Assign prizes
13. Assign high hands
14. Calculate points
15. Complete tournament
16. Verify final state

**Test Scenarios:**
- ✓ End-to-end tournament lifecycle
- ✓ Data integrity validation
- ✓ Generate demo/sample data

**Use When:** Full integration testing, generating sample data, pre-deployment validation

**Data:** ✅ Kept in database for inspection

---

#### 🎯 `test:tournament:cleanup` - Complete with Cleanup
**Status:** completed (then deleted)
**Created:**
- Same as `test:tournament` above
- Runs through all 16 steps
- **Then deletes all test data**

**Cleanup Process:**
- Deletes club (cascades to season, points system, tournament, registrations, activity log)
- Deletes 8 test players individually
- Verifies all data removed

**Test Scenarios:**
- ✓ End-to-end tournament lifecycle
- ✓ Verify cascade deletes work correctly
- ✓ CI/CD integration testing

**Use When:** Automated testing, CI/CD pipelines, repeated test runs

**Data:** ❌ Deleted after completion

---

## Test Script Selection Guide

**Choose your test based on what you're working on:**

| Working On | Use This Script |
|------------|----------------|
| Tournament creation UI | `test:tournament:setup` |
| Registration flow | `test:tournament:setup` |
| Payment confirmation | `test:tournament:setup` |
| Starting tournaments | `test:tournament:setup` |
| Player eliminations | `test:tournament:active` |
| Knockout tracking | `test:tournament:active` |
| Rebuys/addons | `test:tournament:active` |
| High hand features | `test:tournament:active` or `final` |
| Final table logic | `test:tournament:final` |
| Prize distribution | `test:tournament:final` |
| Points calculation | `test:tournament:final` |
| Completion flow | `test:tournament:final` |
| Full system test | `test:tournament` |
| Demo data | `test:tournament` |
| CI/CD pipeline | `test:tournament:cleanup` |

---

## Running Multiple Tests

You can run tests sequentially to create multiple tournaments at different stages:

```bash
# Create tournaments at each stage
npm run test:tournament:setup
npm run test:tournament:active
npm run test:tournament:final
npm run test:tournament

# Now you have 4 tournaments in your database:
# 1. Scheduled (ready for registration)
# 2. In progress (ready for eliminations)
# 3. At final table (ready to finish)
# 4. Completed (for reference)
```

This gives you a complete set of test data covering all tournament states!
