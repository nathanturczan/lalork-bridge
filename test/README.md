# Test Utilities

Test scripts for Scale Navigator Bridge.

## Quick Start

```bash
cd test

# Check current room state
npm run status

# Set up test room with defaults (C Major, 120 BPM)
npm run setup

# Run interactive smoke test
npm run smoke

# Run all test scenarios (automatic, 3s each)
npm run all-scenarios

# Rapid fire test (stress test)
npm run rapid

# Reset to defaults
npm run reset

# Delete test room
npm run cleanup
```

## Test Room

All tests use a dedicated test room:

- **Document ID:** `scale-navigator-bridge-test`
- **Slug:** `bridge-test`
- **Project:** `scale-navigator-ensemble`

Connect to this room in the Bridge device using either the slug or document ID.

## Scripts

### `setup-test-room.js`

Create or update the test room with specific values.

```bash
# Defaults
node setup-test-room.js

# Custom values
node setup-test-room.js --bpm 95 --scale g_harmonic_minor --chord Am7

# Show current state
node setup-test-room.js --status

# Run all scale scenarios (interactive)
node setup-test-room.js --all

# Delete test room
node setup-test-room.js --delete
```

### `run-smoke-test.sh`

Interactive smoke test that walks through 8 test cases:

1. Initial state (C Major, 120 BPM)
2. BPM change
3. Scale change
4. Chord change
5. Hexatonic (no Ableton equivalent)
6. Sharp root (C#)
7. Flat root (Bb)
8. Reset to default

Requires human verification at each step.

```bash
./run-smoke-test.sh
```

### `rapid-fire-test.js`

Stress test that rapidly changes room state.

```bash
# Default: 2s intervals, 20 cycles
node rapid-fire-test.js

# Fast mode: 1s intervals
node rapid-fire-test.js --fast

# Custom cycle count
node rapid-fire-test.js --cycles 50
```

Watch Ableton to verify:
- BPM updates follow changes
- Scale Awareness updates follow changes
- No dropped updates
- No UI glitches

## Test Workflow

### Before First Test

1. Load `Scale Navigator Bridge.amxd` in Ableton
2. Enter `bridge-test` in room input
3. Click Connect
4. Verify status shows "connected"

### Daily Testing

```bash
npm run smoke
```

### After Code Changes

```bash
npm run all-scenarios  # Verify all scale classes
npm run rapid          # Stress test
```

### Full Test Suite

See `../TESTING.md` for comprehensive manual test checklist.
