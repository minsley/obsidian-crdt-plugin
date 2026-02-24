# Sprint Review — 2025-02-01

**Sprint:** M1 (Single-user local sync)
**Attendees:** Alice, Bob

## Demo

Bob demonstrated the plugin connecting to the y-websocket server and syncing keystrokes. The `.md` file updates with a ~1s debounce as expected.

## What Went Well

- y-codemirror.next integration was smoother than expected
- LevelDB persistence works reliably across server restarts

## What Needs Improvement

- Bootstrap ordering has a race condition when the server already has state
- Need to add the self-write guard for `vault.on('modify')`

## Next Sprint Goals

- Fix bootstrap race condition
- Implement awareness / cursor rendering
- Add settings panel

#meeting #sprint-review #m1
