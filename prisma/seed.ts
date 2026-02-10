import { Role, ProjectStatus } from '../generated/prisma/client';
import bcrypt from 'bcrypt';
import { prisma } from '../src/config/db';

async function main() {
  console.log('🚀 Начало процесса сидирования...');

  // 1. ПОЛНАЯ ОЧИСТКА И СБРОС ID
  // Используем raw query для PostgreSQL, чтобы обнулить автоинкремент (Serial/Identity)
  console.log('🧹 Очистка таблиц и сброс счетчиков ID...');
  
  const tables = ['Message', 'Project', 'User'];
  
  for (const table of tables) {
    try {
      // CASCADE удаляет зависимые записи, RESTART IDENTITY сбрасывает счетчик на 1
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE;`);
    } catch (error) {
      console.error(`⚠️ Ошибка при очистке таблицы ${table}:`, error);
    }
  }

  // 2. ПОДГОТОВКА ПАРОЛЕЙ
  const salt = await bcrypt.genSalt(10);
  const adminPassword = await bcrypt.hash('admin', salt);
  const userPassword = await bcrypt.hash('1111', salt);

  // 3. СОЗДАНИЕ АДМИНИСТРАТОРА (теперь он точно будет с ID: 1)
  const admin = await prisma.user.create({
    data: {
      email: 'admin@gmail.com',
      name: 'Главный Администратор',
      password: adminPassword,
      role: Role.ADMIN,
      mustChangePassword: false,
    },
  });
  console.log(`✅ Администратор создан: ${admin.email} (ID: ${admin.id}, пароль: admin)`);

  // 4. ДАННЫЕ ДЛЯ КОМПАНИЙ
  const companies = [
    'ИнфоТех Солюшнс', 'ДатаЦентр Системс', 'СмартКом Телеком', 'ТехноГлобал Групп',
    'ВКС Лидер', 'Нетворк Про', 'Диджитал Спейс', 'Системные Технологии',
    'Интеграл ИТ', 'Оптима Сети', 'Клауд Лайн', 'Медиа Поток',
    'ЭкоСистемс', 'Авангард Сервис', 'Бином ИТ', 'Спектр Телеком',
    'Профи Групп', 'Интеллект Софт', 'Альянс Техно', 'Приоритет ИТ'
  ];

  const formTypes = ['YEALINK_PHONES', 'NETWORKING', 'VIDEO_CONFERENCE'];
  const statuses = Object.values(ProjectStatus) as ProjectStatus[];

  console.log(`👥 Создание 20 партнеров и проектов...`);

  // 5. ГЕНЕРАЦИЯ ПАРТНЕРОВ И ИХ ПРОЕКТОВ
  for (let i = 0; i < companies.length; i++) {
    const partner = await prisma.user.create({
      data: {
        email: `partner${i + 1}@gmail.com`,
        password: userPassword,
        name: `Иван Иванов ${i + 1}`,
        companyName: companies[i],
        unp: `190${100000 + i}`,
        role: Role.USER,
        mustChangePassword: true,
      },
    });

    const projectsCount = Math.floor(Math.random() * 3) + 2;

    for (let j = 0; j < projectsCount; j++) {
      await prisma.project.create({
        data: {
          customerName: `ООО "Заказчик ${i}-${j}"`,
          customerInn: `300${100000 + (i * 10) + j}`,
          formType: formTypes[Math.floor(Math.random() * formTypes.length)] ?? "YEALINK_PHONES",
          status: statuses[Math.floor(Math.random() * statuses.length)] ?? ProjectStatus.PENDING,
          partnerId: partner.id,
          purchaseMethod: 'Запрос ценовых предложений',
          executionDate: new Date(2026, Math.floor(Math.random() * 12), Math.floor(Math.random() * 28)),
          dynamicData: {
            comment: "Сгенерировано автоматически для теста пагинации",
            estimatedValue: 5000 * (j + 1)
          }
        },
      });
    }
  }

  console.log('✨ Сидирование успешно завершено.');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('❌ Ошибка при сидировании:', e);
    await prisma.$disconnect();
    process.exit(1);
  });