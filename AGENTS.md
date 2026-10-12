# Ricochet Robots

## Goal
Build an authentic competitive multiplayer Ricochet Robots game using Java 23, Maven, Swing, and JUnit 5.

## Architecture
- Start with a single Maven module.
- Keep the shared game engine independent of Swing and networking.
- Use clean MVC separation for the Swing client.
- Each player independently simulates moves on their local board.
- The server owns rooms, join codes, rounds, timers, scores, and solution validation.
- Client and server use the same game engine.

## Development approach
- Implement only the task requested in the current prompt.
- Work in small, testable increments.
- Prefer simple Java classes and proven solutions.
- Avoid unnecessary frameworks, abstractions, and dependencies.
- Test game rules with JUnit.
- Do not invent unresolved rule details; flag them before implementation.
- Run relevant tests and report changes, results, and unresolved issues.
- Do not commit unless explicitly asked.

## Implementation order
1. Confirm the game rules and represent the board.
2. Implement and test robot movement.
3. Implement and test targets and solution validation.
4. Build a minimal Swing client.
5. Add multiplayer rooms and server-controlled rounds.
6. Complete competitive rules, scoring, and UI polish.
