import "dotenv/config";
import { Role, ProjectStatus } from '../generated/prisma/client';
import bcrypt from 'bcrypt';
import { prisma } from '../src/config/db';
import { EQUIPMENT_SEED_DATA } from './equipment-seed-data';

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
      phone: '+375297515033',
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
      phone: '+375292222222',
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

  // Настройки портала
  console.log('⚙️ Создание настроек портала...');
  await prisma.siteSetting.upsert({
    where: { key: 'contacts' },
    create: {
      key: 'contacts',
      value: {
        companyName: 'ООО "АйПиМатика Бел"',
        city: 'г. Минск',
        address: '220081, Минская обл., Минский р-н, Боровлянский с/с, д. Копище, ул. Лопатина, д. 6, пом. 3',
        phone: '+375(17) 361-96-96',
        mobile: '+375(29) 361-96-96',
        email: 'info@ipmatika.by',
        supportEmail: 'support@ipmatika.by',
        supportPhone: '+375(29) 378-96-96',
        workingHours: 'понедельник-четверг — 9:00-18:00, пятница — 9:00-17:00',
        yandexMapId: '85112499592fc9fcb766262465c1b80ca62edb09cd1f5b1caa6045fc3a6fc2e0',
      },
    },
    update: {},
  });
  console.log('✅ Настройки портала созданы');

    // ─── Брендинг (логотип + название) ───
  console.log('🎨 Создание брендинга...');
  await prisma.siteSetting.upsert({
    where: { key: 'branding' },
    create: {
      key: 'branding',
      value: {
        companyName: 'АйПиМатика Бел - B2B',
        logo: 'data:image/webp;base64,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',
      },
    },
    update: {},
  });
  console.log('✅ Брендинг создан');

  // ─── Тестовое оборудование ───
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "TestEquipment" RESTART IDENTITY CASCADE;`);

  for (const item of EQUIPMENT_SEED_DATA) {
    await prisma.testEquipment.create({ data: item });
  }
  console.log(`✅ Загружено ${EQUIPMENT_SEED_DATA.length} единиц оборудования`);

  // ─── Демо-новости ───
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "News" RESTART IDENTITY CASCADE;`);

  await prisma.news.create({ data: { title: 'Новая прошивка Yealink V86', link: 'https://yealink.com', imageUrl: null } });
  await prisma.news.create({ data: { title: 'Обновление прайс-листа', link: 'https://google.com', imageUrl: null } });
  console.log('✅ Добавлено 2 демо-новости');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => await prisma.$disconnect());