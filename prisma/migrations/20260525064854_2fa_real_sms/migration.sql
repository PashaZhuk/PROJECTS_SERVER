-- AlterTable
ALTER TABLE "User" ADD COLUMN     "twoFactorCodeExpiresAt" TIMESTAMP(3),
ADD COLUMN     "twoFactorCodeHash" VARCHAR(64);
