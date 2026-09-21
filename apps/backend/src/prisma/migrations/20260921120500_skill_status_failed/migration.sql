-- AddEnumValue: FAILED marks a skill whose AI initialization did not complete.
ALTER TYPE "SkillStatus" ADD VALUE IF NOT EXISTS 'FAILED';
