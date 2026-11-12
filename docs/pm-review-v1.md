# PM review: working first version

Live build: https://funny-study-two.vercel.app (Google sign-in; confirm the 18+/U.S./Terms box first).

## What changed

| Area | Change |
| --- | --- |
| Liking | Larger, centered heart button labeled `Funny`; `Liked · undo` once liked. Saved vote values are unchanged (`funny` / `caption_votes = 1`). |
| Navigation | Up/down arrow icon buttons, plus the existing scroll, swipe, and keyboard arrows. |
| Review | The `current/total` progress counter opens a list of captions viewed in this visit, with study-image thumbnails, caption previews, and a heart for liked ones. Selecting one jumps back to it. |
| Completion | Timing shown in seconds (one decimal), the share of viewed captions liked is explained, and an unliked caption is described as not necessarily disliked. |
| Participant feedback | Real study images in previews, arrow icons instead of Previous/Next text, and the "No like selected" note removed (beside the button and in the review list). |

## How to review (about 10 minutes)

1. Open the live build on a phone and on a laptop.
2. Start a study, like and undo a caption, and move with the arrows.
3. Tap the progress counter, jump back to an earlier caption, and close the list.
4. Finish the study with End Study and read the summary.
5. Reopen the completed study from Home and check that the summary is unchanged.

## Questions for the PM

1. **Usefulness:** Does the review list help participants revisit captions, and should it also include captions from earlier visits to an unfinished study?
2. **Clarity:** Are the completion summary's numbers and the "not liked is not disliked" note clear without further explanation?
3. **Behavior:** Is anything surprising, such as liking not auto-advancing or the list resetting on reload?

## Scope decision requested

Approve or defer the next iteration: an A/B humor-style preference comparison and an optional end-of-study feedback form, with personalized generation evaluated separately afterward. Both require IRB-approved consent before collecting data (see `docs/site-policy-review.md`).

## Feedback received

_To be filled in after the review._
