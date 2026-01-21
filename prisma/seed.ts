import { Role } from '../generated/prisma/client'
import bcrypt from 'bcrypt';
import {prisma}  from '../src/config/db';



async function main() {
  const adminEmail = 'admin@gmail.com'; // Укажи здесь свою почту
  const adminPassword = 'admin'; // Укажи здесь свой надежный пароль

  console.log('Начало процесса сидирования...');

  // 1. Хешируем пароль
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(adminPassword, salt);

  // 2. Создаем или обновляем администратора
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {}, // Если админ уже есть, ничего не меняем
    create: {
      email: adminEmail,
      name: 'Главный Администратор',
      password: hashedPassword,
      role: Role.ADMIN, // Используем Enum из Prisma
    },
  });

  console.log(`Администратор создан/проверен: ${admin.email}`);
  console.log('Сидирование успешно завершено.');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });