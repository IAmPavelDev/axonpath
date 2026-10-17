-- Remove MANUAL skill mode: candidate-options machinery, mode columns, target.
-- Reverts 20261002120000_add_skill_mode_and_class_options. EventType's
-- CLASS_OPTIONS_GENERATED value stays: historical Event rows still use it.

-- DropForeignKey
ALTER TABLE "NextClassOption" DROP CONSTRAINT "NextClassOption_skillId_fkey";

-- DropTable
DROP TABLE "NextClassOption";

-- AlterTable
ALTER TABLE "Skill" DROP COLUMN "mode",
DROP COLUMN "optionsState",
DROP COLUMN "optionsStateAt";

-- AlterTable
ALTER TABLE "NextClassJob" DROP COLUMN "target";

-- DropEnum
DROP TYPE "SkillMode";

-- DropEnum
DROP TYPE "NextClassOptionsState";
