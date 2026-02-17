import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// 👇 ВПИШИТЕ СЮДА ВАШ TELEGRAM ID (можно взять из бота @userinfobot)
const TARGET_USER_ID = '443898930'; 

async function main() {
  console.log(`🔍 Поиск пользователя с ID: ${TARGET_USER_ID}...`);

  // Ищем профиль только по ID, так как это самый надежный способ
  const profile = await prisma.randomCoffeeProfile.findUnique({
    where: { telegramUserId: String(TARGET_USER_ID) }
  });

  if (!profile) {
    console.error(`❌ Профиль с ID ${TARGET_USER_ID} не найден в базе Random Coffee.`);
    return;
  }

  console.log(`👤 Нашли профиль: ${profile.name} (${profile.specialty})`);

  // Удаляем зависшие записи (статус PAID)
  const result = await prisma.randomCoffeeParticipation.deleteMany({
    where: {
        profileId: profile.id,
        status: 'PAID' // Удаляем только активные, но еще не сматченные записи
    }
  });

  if (result.count > 0) {
      console.log(`✅ Успешно удалено записей: ${result.count}`);
      console.log('🎉 Статус сброшен! Теперь вы можете заново записаться через бота.');
  } else {
      console.log('ℹ️ Активных записей "PAID" не найдено. Возможно, вы уже удалены или статус другой.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });