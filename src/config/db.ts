import "dotenv/config";
import { PrismaPg } from '@prisma/adapter-pg'
import  {PrismaClient}  from '../../generated/prisma/client'

const connectionString = `${process.env.DATABASE_URL}`

const adapter = new PrismaPg({ connectionString })
const prisma = new PrismaClient({ adapter })

const connectDB = async ()=>{
    try{
        await prisma.$connect();
        console.log("DB connected via Prisma")
    }catch(error){
        console.error(error)
        process.exit(1)
}}

const disconnectDB = async () =>{
    await prisma.$disconnect();

}

export {prisma, connectDB, disconnectDB}