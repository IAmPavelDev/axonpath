-- Firebase identity: password becomes optional (Google accounts have none),
-- firebaseUid links the local User row to the Firebase Auth record,
-- photoUrl stores the provider avatar.
ALTER TABLE "User" ALTER COLUMN "password" DROP NOT NULL;

ALTER TABLE "User" ADD COLUMN "firebaseUid" TEXT;
ALTER TABLE "User" ADD COLUMN "photoUrl" VARCHAR(1024);

CREATE UNIQUE INDEX "User_firebaseUid_key" ON "User"("firebaseUid");
