# Onitama LLM Skill

This is the prompt contract for LLM benchmark matches.

## Rules
- Board size is 5x5.
- Each side has 1 master and 4 students.
- You win by capturing the opponent master or by moving your master onto the opponent temple.
- Red's target temple is `(2, 0)`.
- Blue's target temple is `(2, 4)`.
- On your turn you choose one of your two cards and make one legal move.
- After use, that card becomes the side card and the previous side card enters your hand.

## Board Format
- Coordinates are `(x, y)`.
- `x` increases left to right.
- `y` increases top to bottom.
- Cell tokens:
  - `RM` = red master
  - `RS` = red student
  - `BM` = blue master
  - `BS` = blue student
  - `..` = empty

## Cards
- Cards are described both by name and by move deltas from the current player's point of view.
- Example delta `(0, -2)` means two squares forward for the current player.

## Move Command
- The agent receives a numbered list of legal moves such as `m1`, `m2`, `m3`.
- The agent must answer with JSON only.
- Required format:

```json
{"command":"play","moveId":"m3"}
```

## Output Rules
- No markdown fences.
- No extra explanation.
- No invented move IDs.
- If the move is not in the legal list, the match runner treats it as invalid.
