-- The learner's original freeform brief; the generated title/description
-- are derived from it (create-with-prompt flow). IF NOT EXISTS: an earlier
-- uncommitted iteration (recorded as 20261003210000_skill_prompt_generated_
-- topic on the production DB) already added the column.
ALTER TABLE "Skill" ADD COLUMN IF NOT EXISTS "prompt" TEXT NOT NULL DEFAULT '';
