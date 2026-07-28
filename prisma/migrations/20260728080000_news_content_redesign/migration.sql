-- AlterTable: add content column (NOT NULL, default empty string for existing rows)
ALTER TABLE "News" ADD COLUMN "content" TEXT NOT NULL DEFAULT '';

-- AlterTable: drop imageUrl column
ALTER TABLE "News" DROP COLUMN IF EXISTS "imageUrl";

-- AlterTable: make link optional
ALTER TABLE "News" ALTER COLUMN "link" DROP NOT NULL;
