-- The learner's original freeform brief; the generated title/description
-- are derived from it (create-with-prompt flow).
ALTER TABLE "Skill" ADD COLUMN "prompt" TEXT NOT NULL DEFAULT '';
