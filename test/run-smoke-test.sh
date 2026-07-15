#!/bin/bash
#
# Smoke Test Runner for Scale Navigator Bridge
#
# Prerequisites:
#   1. Ableton Live running with Scale Navigator Bridge loaded
#   2. Bridge connected to room "bridge-test"
#
# Usage:
#   ./run-smoke-test.sh
#

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "========================================"
echo "Scale Navigator Bridge - Smoke Test"
echo "========================================"
echo ""
echo "Prerequisites:"
echo "  1. Ableton Live running"
echo "  2. Scale Navigator Bridge loaded on a MIDI track"
echo "  3. Bridge connected to room: bridge-test"
echo ""
read -p "Press Enter when ready to begin..."

echo ""
echo "--- Test 1: Initial State (C Major, 120 BPM) ---"
node setup-test-room.js --scale c_diatonic --bpm 120 --chord Cmaj7
echo "Expected: BPM=120, Scale=C Major, Chord=Cmaj7"
read -p "Verify in Ableton, then press Enter..."

echo ""
echo "--- Test 2: BPM Change (95 BPM) ---"
node setup-test-room.js --bpm 95
echo "Expected: BPM changes to 95"
read -p "Verify in Ableton, then press Enter..."

echo ""
echo "--- Test 3: Scale Change (G Harmonic Minor) ---"
node setup-test-room.js --scale g_harmonic_minor
echo "Expected: Root=G, Scale=Harmonic Minor"
read -p "Verify in Ableton Scale Awareness, then press Enter..."

echo ""
echo "--- Test 4: Chord Change (A minor 7, plays MIDI) ---"
node setup-test-room.js --chord a_m7-13
echo "Expected: Chord display shows a_m7-13, chord sounds on the track (notes 57 67 72 76)"
read -p "Verify in device UI and instrument, then press Enter..."

echo ""
echo "--- Test 5: Hexatonic (Messiaen 3 Approximation) ---"
node setup-test-room.js --scale hexatonic_4
echo "Expected: Root=E, Scale display=Hexatonic, Ableton=Messiaen 3"
read -p "Verify in Ableton, then press Enter..."

echo ""
echo "--- Test 6: Sharp Root (C# Diatonic) ---"
node setup-test-room.js --scale cs_diatonic --bpm 128
echo "Expected: Root=C#, Scale=Major, BPM=128"
read -p "Verify in Ableton, then press Enter..."

echo ""
echo "--- Test 7: Flat Root (Bb Acoustic) ---"
node setup-test-room.js --scale bb_acoustic
echo "Expected: Root=Bb, Scale=Lydian Dominant"
read -p "Verify in Ableton, then press Enter..."

echo ""
echo "--- Test 8: Reset to Default ---"
node setup-test-room.js --scale c_diatonic --bpm 120 --chord Cmaj7
echo "Expected: Back to C Major, 120 BPM"
read -p "Verify in Ableton, then press Enter..."

echo ""
echo "========================================"
echo "Smoke Test Complete!"
echo "========================================"
echo ""
echo "All tests passed? [y/n]"
read -r RESULT

if [ "$RESULT" = "y" ] || [ "$RESULT" = "Y" ]; then
    echo "✓ Smoke test PASSED"
    exit 0
else
    echo "✗ Smoke test FAILED"
    echo "Please document which tests failed in TESTING.md"
    exit 1
fi
