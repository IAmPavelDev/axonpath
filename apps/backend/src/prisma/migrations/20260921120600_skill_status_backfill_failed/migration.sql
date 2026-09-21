-- Backfill: a DRAFT skill with no class never finished initializing.
-- Separate migration from the ADD VALUE above: the new enum value may only be
-- written after the transaction that added it has committed (PG >= 12).
UPDATE "Skill" SET "status" = 'FAILED'
WHERE "status" = 'DRAFT'
  AND NOT EXISTS (SELECT 1 FROM "Class" WHERE "Class"."skillId" = "Skill"."id");
