-- CreateEnum
CREATE TYPE "NewsCategory" AS ENUM ('NEWS', 'NOMENCLATURE', 'DEMO');

-- AlterTable
ALTER TABLE "News" ADD COLUMN "category" "NewsCategory" NOT NULL DEFAULT 'NEWS';

-- CreateIndex
CREATE INDEX "News_category_idx" ON "News"("category");
