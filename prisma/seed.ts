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

  // ─── Тестовое оборудование ───
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "TestEquipment" RESTART IDENTITY CASCADE;`);

  const equipmentData = [
    { category: 'ВКС', name: 'UVC86 Video Conferencing Camera', accountingType: 'MAC адрес', serialNumber: '806009E090000277', macAddress: '805EC06E6D66' },
    { category: 'ВКС', name: 'UVC85-BYOD-200 система для видеоконференций', accountingType: 'MAC адрес', serialNumber: '806017G060000390', macAddress: 'UVC85' },
    { category: 'ВКС', name: 'WF50', accountingType: 'вне учета', serialNumber: '8402720074001460', macAddress: 'нет' },
    { category: 'ВКС', name: 'BYOD-BOX', accountingType: 'МС', serialNumber: '800004C110000636', macAddress: 'нет' },
    { category: 'ВКС', name: 'Mspeaker II', accountingType: 'MAC адрес', serialNumber: '806051D070001418', macAddress: '805EC066F98C' },
    { category: 'ВКС', name: 'VCH51', accountingType: 'MAC адрес', serialNumber: '803016E120101329', macAddress: 'нет' },
    { category: 'ВКС', name: 'VCM35 (настольный микрофонный массив)', accountingType: 'MAC адрес', serialNumber: '111083H100000138' },
    { category: 'ВКС', name: 'WPP30 (беспроводной передатчик контента)', accountingType: 'MAC адрес', serialNumber: '803112F020001311', macAddress: 'нет' },
    { category: 'ВКС', name: 'CM20', accountingType: 'MAC адрес', serialNumber: '203095G050000399', macAddress: '44DBD24009AF' },
    { category: 'ВКС', name: 'CS10', accountingType: 'MAC адрес', serialNumber: '803094G050003162', macAddress: '249AD8B31057' },
    { category: 'IP ТЕЛЕФОНЫ', name: 'VP59', accountingType: 'МС', serialNumber: '803050C030000181', macAddress: '805EC0AFD1F6' },
    { category: 'IP ТЕЛЕФОНЫ', name: 'SIP-T43U', accountingType: 'МС', serialNumber: '2008SN23537', macAddress: '805EC0CFBCB3' },
    { category: 'IP ТЕЛЕФОНЫ', name: 'W59R', accountingType: 'МС', serialNumber: '802006C092401007', macAddress: 'нет' },
    { category: 'IP ТЕЛЕФОНЫ', name: 'CP965 Conferencing phone', accountingType: 'MAC адрес', serialNumber: '804014G012400010', macAddress: '249AD8E4728D' },
    { category: 'IP ТЕЛЕФОНЫ', name: 'W73P', accountingType: 'MAC адрес', serialNumber: '2206SN08635', macAddress: '805E0CE8F609' },
    { category: 'IP ТЕЛЕФОНЫ', name: 'SIP-T31G', accountingType: 'MAC адрес', serialNumber: '2209SN13678' },
    { category: 'IP ТЕЛЕФОНЫ', name: 'SIP-T31W', accountingType: 'MAC адрес', serialNumber: '2309SN00229', macAddress: '44DBD2217C16' },
    { category: 'IP ТЕЛЕФОНЫ', name: 'SIP-T34W', accountingType: 'MAC адрес', serialNumber: '2309SN00962', macAddress: '44DBD221ECE5' },
    { category: 'IP ТЕЛЕФОНЫ', name: 'SIP-T44W', accountingType: 'MAC адрес', serialNumber: '2404SN61923', macAddress: '44DBD25297A9' },
    { category: 'IP ТЕЛЕФОНЫ', name: 'SIP-T58W Pro with camera', accountingType: 'MAC адрес', serialNumber: '801606D090701420', macAddress: '805E0CEF5D49' },
    { category: 'Сетевое оборудование', name: 'P3010M-8PoE-150W', accountingType: 'МС' },
    { category: 'Сетевое оборудование', name: 'P1009D-8PoE-120W', accountingType: 'МС' },
    { category: 'Сетевое оборудование', name: 'P1009D-8PoE-96W', accountingType: 'МС', serialNumber: 'SWI025TG170162' },
    { category: 'Сетевое оборудование', name: 'WI-POE31', accountingType: 'МС' },
    { category: 'Сетевое оборудование', name: 'WI-PS308G', accountingType: 'МС', serialNumber: 'PS308GV22210RU001' },
    { category: 'IP АТС', name: 'Сервер для программной АТС', accountingType: 'МС' },
    { category: 'IP шлюзы', name: 'TA1600', accountingType: 'МС' },
    { category: 'IP шлюзы', name: 'TA1610', accountingType: 'МС' },
    { category: 'Прочее', name: 'Удлиннитель сетевой 220В - 50 метров', accountingType: 'вне учета' },
    { category: 'Прочее', name: 'Буклетница', accountingType: 'вне учета' },
  ];

  for (const item of equipmentData) {
    await prisma.testEquipment.create({ data: item });
  }
  console.log(`✅ Загружено ${equipmentData.length} единиц оборудования`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => await prisma.$disconnect());