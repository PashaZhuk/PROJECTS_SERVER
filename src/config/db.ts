import "dotenv/config";
import { PrismaPg } from '@prisma/adapter-pg'
import  {PrismaClient}  from '../../generated/prisma/client'

const connectionString = `${process.env.DATABASE_URL}`

const adapter = new PrismaPg({ connectionString })
const prisma = new PrismaClient({ adapter })

const connectDB = async () => {
    try {
        await prisma.$connect();
        // Добавляем реальный запрос к БД. Если виртуалка выключена, 
        // выполнение упадет именно здесь и уйдет в catch.
        await prisma.$queryRaw`SELECT 1`; 
        
        console.log("✅ DB connected and verified via Prisma");
    } catch (error) {
        console.error("❌ DATABASE CONNECTION ERROR:");
        console.error("Виртуальная машина с PostgreSQL выключена или недоступна.");
        // console.error(error.message); // Можно раскомментировать для отладки
        process.exit(1); // Завершаем процесс, так как без БД B2B-платформа не имеет смысла
    }
}

const disconnectDB = async () =>{
    await prisma.$disconnect();

}

export {prisma, connectDB, disconnectDB}