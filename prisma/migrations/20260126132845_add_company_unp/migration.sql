/*
  Warnings:

  - A unique constraint covering the columns `[unp]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "unp" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_unp_key" ON "User"("unp");
