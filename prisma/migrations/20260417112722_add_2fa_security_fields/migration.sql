-- AlterTable
ALTER TABLE "User" ADD COLUMN     "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lockUntil" TIMESTAMP(3),
ADD COLUMN     "twoFactorAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "twoFactorCodeSentAt" TIMESTAMP(3),
ADD COLUMN     "twoFactorLockUntil" TIMESTAMP(3),
ADD COLUMN     "twoFactorVerified" BOOLEAN NOT NULL DEFAULT false;
