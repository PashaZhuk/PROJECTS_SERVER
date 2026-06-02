-- CreateTable
CREATE TABLE "TestEquipment" (
    "id" SERIAL NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountingType" TEXT,
    "purpose" TEXT,
    "serialNumber" TEXT,
    "macAddress" TEXT,
    "issueDate" TEXT,
    "issuedTo" TEXT,
    "issuedToWhere" TEXT,
    "status" TEXT NOT NULL DEFAULT 'in_stock',
    "comments" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TestEquipment_pkey" PRIMARY KEY ("id")
);
