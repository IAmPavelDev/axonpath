-- Lesson base speech language (BCP-47) from generation; nullable for
-- lessons generated before language tagging existed.
ALTER TABLE "Class" ADD COLUMN "baseLanguage" TEXT;
