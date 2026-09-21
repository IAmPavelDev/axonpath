-- AddEnumValue: GENERATING marks a skill whose AI initialization is in flight.
ALTER TYPE "SkillStatus" ADD VALUE IF NOT EXISTS 'GENERATING';

-- Backfill: a DRAFT skill with at least one class finished initializing.
-- Uses only pre-existing enum values: PG >= 12 forbids using a value added
-- earlier in the same transaction.
UPDATE "Skill" SET "status" = 'ACTIVE'
WHERE "status" = 'DRAFT'
  AND EXISTS (SELECT 1 FROM "Class" WHERE "Class"."skillId" = "Skill"."id");
