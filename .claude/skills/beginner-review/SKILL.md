---
name: beginner-review
description: Review levels of the Bringup game the way a complete beginner, an instructor, a chip specialist and a test engineer would, and fix what is found. Use when asked to review, audit, proofread or improve chapters, or before releasing new content.
---

# Review content adversarially

Assume there are real problems. Four passes over the chapter, in this order, fixing as you go.

1. **The beginner.** Keep a ledger of every term, symbol, C construct, register, library function and piece of maths the student has been taught so far (start from the primers and the chapter's `requires`). Read each level in order: anything used that is not in the ledger and not explained on the spot is a defect. So are: a formula with no worked example, a step the brief did not prepare, given code that is neither explained nor marked "given, explained in chapter N", two new ideas in one level, a brief over about 350 words, a hint ladder whose first hint gives the answer or whose last leaves the student stuck. Fix in the fewest words; split levels rather than pile ideas up. Add new terms to the glossary and the ledger.
2. **The instructor.** Compare with what the lectures, labs and homeworks ask at that point (same pins, helper functions and idioms as the starter code). Anything in the syllabus that is missing? Anything taught that the course does not use? Any graded answer reproduced? Change the numbers if so.
3. **The specialist.** Check every number, register name, bit position, reset value, formula and sign against the reference manual, the data sheet and the course code. Recompute every quiz and calc answer. A wrong fact is the worst defect.
4. **The test engineer.** For each code level write two typical wrong programs and one alternative correct program and run them (`runProgram`). A wrong program that passes or a correct one that fails is a defect in the checks. Read the feedback a wrong program gets: if a beginner could not act on it, improve the check `hint` or add a check that isolates the mistake. If the unhelpful message comes from the simulator, fix the simulator.

Then look at screenshots of at least two levels per chapter (`node tools/shot.mjs level <id> out.png --tests --height 1400`), run `npm run check-levels` and `npx tsc --noEmit`, and report: the most serious problems with what you did, counts of smaller fixes by type, anything you could not fix, and an honest verdict on what a student still could not do after the chapter.
