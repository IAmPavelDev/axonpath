-- Phase 7 S7 (D7): drop the unread decay knob. `Skill.lambda` was never
-- written (create-skill passes only userId/topic/status) and never read;
-- re-add only when a real decay design exists with data to fit it against.
ALTER TABLE "Skill" DROP COLUMN "lambda";
