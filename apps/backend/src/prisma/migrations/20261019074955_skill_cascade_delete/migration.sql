-- DropForeignKey
ALTER TABLE "Answer" DROP CONSTRAINT "Answer_questionId_fkey";

-- DropForeignKey
ALTER TABLE "Class" DROP CONSTRAINT "Class_skillId_fkey";

-- DropForeignKey
ALTER TABLE "ClassQaBlock" DROP CONSTRAINT "ClassQaBlock_classId_fkey";

-- DropForeignKey
ALTER TABLE "Event" DROP CONSTRAINT "Event_skillId_fkey";

-- DropForeignKey
ALTER TABLE "Question" DROP CONSTRAINT "Question_skillId_fkey";

-- DropForeignKey
ALTER TABLE "SkillProgress" DROP CONSTRAINT "SkillProgress_skillId_fkey";

-- DropForeignKey
ALTER TABLE "Vector" DROP CONSTRAINT "Vector_skillId_fkey";


-- AddForeignKey
ALTER TABLE "Class" ADD CONSTRAINT "Class_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillProgress" ADD CONSTRAINT "SkillProgress_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vector" ADD CONSTRAINT "Vector_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassQaBlock" ADD CONSTRAINT "ClassQaBlock_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;
