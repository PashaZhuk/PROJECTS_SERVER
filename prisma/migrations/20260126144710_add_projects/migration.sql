/*
  Warnings:

  - You are about to drop the column `description` on the `Project` table. All the data in the column will be lost.
  - You are about to drop the column `title` on the `Project` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `Project` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[number]` on the table `Project` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `customerInn` to the `Project` table without a default value. This is not possible if the table is not empty.
  - Added the required column `customerName` to the `Project` table without a default value. This is not possible if the table is not empty.
  - Added the required column `dynamicData` to the `Project` table without a default value. This is not possible if the table is not empty.
  - Added the required column `formType` to the `Project` table without a default value. This is not possible if the table is not empty.
  - Added the required column `number` to the `Project` table without a default value. This is not possible if the table is not empty.
  - Added the required column `partnerId` to the `Project` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Project` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'APPROVED', 'REJECTED', 'REVISION', 'CLOSED');

-- DropForeignKey
ALTER TABLE "Project" DROP CONSTRAINT "Project_userId_fkey";

-- AlterTable
ALTER TABLE "Project" DROP COLUMN "description",
DROP COLUMN "title",
DROP COLUMN "userId",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "customerInn" TEXT NOT NULL,
ADD COLUMN     "customerName" TEXT NOT NULL,
ADD COLUMN     "dynamicData" JSONB NOT NULL,
ADD COLUMN     "executionDate" TIMESTAMP(3),
ADD COLUMN     "formType" TEXT NOT NULL,
ADD COLUMN     "lastEditorId" INTEGER,
ADD COLUMN     "number" TEXT NOT NULL,
ADD COLUMN     "partnerId" INTEGER NOT NULL,
ADD COLUMN     "purchaseMethod" TEXT,
ADD COLUMN     "status" "ProjectStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Project_number_key" ON "Project"("number");

-- CreateIndex
CREATE INDEX "Project_partnerId_idx" ON "Project"("partnerId");

-- CreateIndex
CREATE INDEX "Project_customerInn_idx" ON "Project"("customerInn");

-- CreateIndex
CREATE INDEX "Project_status_idx" ON "Project"("status");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_lastEditorId_fkey" FOREIGN KEY ("lastEditorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
