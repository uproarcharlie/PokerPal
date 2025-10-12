# Tournament Lifecycle Integration Test

This test suite validates the complete tournament lifecycle in the PokerPal platform.

## What It Tests

The test runs through all stages of a tournament from creation to completion:

1. **Club Creation** - Creates a test poker club
2. **Season Setup** - Creates a season for the club
3. **Points System** - Configures the points system with allocations
4. **Player Registration** - Creates 8 test players
5. **Tournament Creation** - Sets up a tournament with buy-ins, rebuys, addons, rake, and high hands
6. **Player Enrollment** - Registers all players for the tournament
7. **Tournament Start** - Changes status to "in_progress"
8. **Prize Pool Lock** - Locks the prize pool and calculates rake
9. **Rebuys & Addons** - Simulates players performing rebuys and addons
10. **Eliminations** - Records player eliminations with final positions
11. **Prize Distribution** - Calculates and assigns prizes (50/30/20 split)
12. **High Hand Awards** - Assigns high hand prizes to winners
13. **Points Calculation** - Awards points based on position + participation
14. **Tournament Completion** - Marks tournament as completed
15. **Final Verification** - Validates all data is correct
16. **Cleanup** - Removes all test data

## Running the Test

To run the tournament lifecycle test, execute:

```bash
npm run test:tournament
```

## Output

The test provides detailed, color-coded terminal output showing:
- ✓ Green checkmarks for successful steps
- Blue section headers for major phases
- Yellow data dumps showing created records
- Cyan step indicators
- Final standings table with prizes and points

## Requirements

- PostgreSQL database running
- `DATABASE_URL` configured in `.env`
- All dependencies installed (`npm install`)

## Expected Duration

The test typically completes in 2-5 seconds.

## Data Persistence

The test **keeps all created data** in the database after completion. This allows you to:
- Inspect the tournament in the web application
- Verify data integrity manually
- Use it as sample/demo data

The test creates:
- 1 Club ("Test Poker Club")
- 1 Season ("Spring 2025 Test Season")
- 1 Points System with 6 allocations
- 8 Players
- 1 Completed Tournament with full standings, prizes, and points

At the end of the test, you'll see the Club ID, Season ID, and Tournament ID printed so you can easily find them in the application.
