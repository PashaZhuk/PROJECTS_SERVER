import "dotenv/config";
import { PrismaPg } from '@prisma/adapter-pg'
import  {PrismaClient}  from '../../generated/prisma/client'
import logger from '../utils/logger.js';

const connectionString = `${process.env.DATABASE_URL}`

const adapter = new PrismaPg({ connectionString })
const prisma = new PrismaClient({ adapter })

const connectDB = async () => {
    try {
        await prisma.$connect();
        // Добавляем реальный запрос к БД. Если виртуалка выключена, 
        // выполнение упадет именно здесь и уйдет в catch.
        await prisma.$queryRaw`SELECT 1`; 
        
        logger.info("✅ DB connected and verified via Prisma");
    } catch (error) {
        logger.error("❌ DATABASE CONNECTION ERROR:");
        logger.error("Виртуальная машина с PostgreSQL выключена или недоступна.");
        // logger.error(error.message); // Можно раскомментировать для отладки
        process.exit(1); // Завершаем процесс, так как без БД B2B-платформа не имеет смысла
    }
}

const disconnectDB = async () =>{
    await prisma.$disconnect();

}

export {prisma, connectDB, disconnectDB}