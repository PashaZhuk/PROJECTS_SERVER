import { Role, ProjectStatus } from '../generated/prisma/client';
import bcrypt from 'bcrypt';
import { prisma } from '../src/config/db';

async function main() {
  console.log('🚀 Начало сидирования...');

  // Очистка таблиц (порядок важен из-за внешних ключей)
  console.log('🧹 Очистка таблиц...');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "Message" RESTART IDENTITY CASCADE;`);
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "Project" RESTART IDENTITY CASCADE;`);
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "User" RESTART IDENTITY CASCADE;`);
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "Company" RESTART IDENTITY CASCADE;`);

  const salt = await bcrypt.genSalt(10);
  const adminPassword = await bcrypt.hash('admin', salt);
  const managerPassword = await bcrypt.hash('manager', salt);
  const userPassword = await bcrypt.hash('1111', salt);

  // Компании-примеры (10 шт.) – уникальные УНП
  console.log('🏢 Создание компаний (10 шт.)...');
  const companiesData = [
    { name: 'ООО "Рога и Копыта"', unp: '123456789', phone: '+375291234567' },
    { name: 'ИП "ТехноСервис"', unp: '987654321', phone: '+375293334455' },
    { name: 'ОАО "БелТелеком"', unp: '112233445', phone: '+375172223344' },
    { name: 'ООО "АйТи Решения"', unp: '556677889', phone: '+375447776655' },
    { name: 'ЧУП "СофтЛайн"', unp: '998877665', phone: '+375291112233' },
    { name: 'ООО "СмартСистемс"', unp: '443322110', phone: '+375333221100' },
    { name: 'ИООО "Виртуал Плюс"', unp: '554433221', phone: '+375445554433' },
    { name: 'ЗАО "ИнфоТех"', unp: '667788990', phone: '+375259998877' },
    { name: 'ООО "БизнесСофт"', unp: '778899001', phone: '+375336665544' },
    { name: 'ИП "КиберСервис"', unp: '889900112', phone: '+375447778899' },
  ];
  for (const comp of companiesData) {
    await prisma.company.create({ data: comp });
  }

  // Админ
  await prisma.user.create({
    data: {
      email: 'admin@test.com',
      name: 'Главный Администратор',
      password: adminPassword,
      role: Role.ADMIN,
      mustChangePassword: false,
    },
  });

  // Менеджер
  await prisma.user.create({
    data: {
      email: 'manager@test.com',
      name: 'Иван Менеджер',
      password: managerPassword,
      role: Role.MANAGER,
      mustChangePassword: false,
    },
  });

  // 15 партнёров (без имени) – все УНП уникальные и не пересекаются с компаниями-примерами
  console.log('👥 Создание 15 партнёров...');
  const partnerCompanies = [
    'ООО "Альфа"', 'ООО "Бета"', 'ООО "Гамма"', 'ООО "Дельта"', 'ООО "Омега"',
    'ИП "Вектор"', 'ИП "Лидер"', 'ООО "Стандарт"', 'ООО "Прогресс"', 'ООО "Фактор"',
    'ООО "Центр"', 'ИП "Премьер"', 'ООО "Консалт"', 'ООО "Интеграл"', 'ООО "Эксперт"',
  ];
  // Уникальные УНП (не повторяются между собой и с companiesData)
  const partnerUnps = [
    '111111111', '222222222', '333333333', '444444444', '555555555',
    '666666666', '777777777', '888888888', '999999999', '101010101',
    '121212121', '131313131', '141414141', '151515151', '161616161',
  ];
  const partnerPhones = [
    '+375291112233', '+375292223344', '+375293334455', '+375294445566', '+375295556677',
    '+375296667788', '+375297778899', '+375298889900', '+375299990011', '+375337771122',
    '+375338882233', '+375339993344', '+375441112233', '+375442223344', '+375443334455',
  ];

  for (let i = 0; i < 15; i++) {
    await prisma.user.create({
      data: {
        email: `partner${i + 1}@test.com`,
        password: userPassword,
        companyName: partnerCompanies[i],
        unp: partnerUnps[i],
        phone: partnerPhones[i],
        role: Role.USER,
        mustChangePassword: true,
      },
    });
  }

  // Создание проектов для партнёров
  console.log('📝 Создание проектов...');
  const formTypes = ['YEALINK_PHONES', 'NETWORKING', 'VIDEO_CONFERENCE'];
  const statuses = Object.values(ProjectStatus);
  const partners = await prisma.user.findMany({ where: { role: Role.USER } });

  for (const partner of partners) {
    const projectsCount = Math.floor(Math.random() * 3) + 2; // 2-4 проекта
    for (let j = 0; j < projectsCount; j++) {
      await prisma.project.create({
        data: {
          customerName: `ООО "Заказчик ${partner.id}-${j}"`,
          customerInn: `300${100000 + partner.id * 10 + j}`,
          formType: formTypes[Math.floor(Math.random() * formTypes.length)] || 'YEALINK_PHONES',
          status: statuses[Math.floor(Math.random() * statuses.length)] || ProjectStatus.PENDING,
          partnerId: partner.id,
          purchaseMethod: 'Запрос ценовых предложений',
          executionDate: new Date(2026, Math.floor(Math.random() * 12), Math.floor(Math.random() * 28) + 1),
          dynamicData: { comment: 'Демо-проект', estimatedValue: 5000 * (j + 1) },
        },
      });
    }
  }

  console.log('✨ Сидирование завершено.');
  console.log('   Админ: admin@test.com / admin');
  console.log('   Менеджер: manager@test.com / manager');
  console.log('   15 партнёров: partner1@test.com ... partner15@test.com, пароль 1111');
  console.log('   10 компаний-примеров в справочнике');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => await prisma.$disconnect());