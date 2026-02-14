// file: prisma/seed-channels.ts

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const channels = [
  // Аналитика
  { name: 'Вакансии аналитиков', username: '@analyst_job_geeklink', price: 225, category: 'Аналитика' },
  { name: 'Вакансии 1С-аналитиков', username: '@analyst_consultant_1c_job', price: 225, category: 'Аналитика' },
  
  // Разработка
  { name: 'Разработчики (общее)', username: '@developers_job_geeklink', price: 75, category: 'Разработка' },
  { name: 'Frontend', username: '@frontend_job_geeklink', price: 225, category: 'Разработка' },
  { name: 'Backend', username: '@backend_job_geeklink', price: 225, category: 'Разработка' },
  { name: 'Fullstack', username: '@fullstack_job_geeklink', price: 225, category: 'Разработка' },
  { name: '1C и Bitrix', username: '@bitrix_1c_job', price: 225, category: 'Разработка' },
  { name: 'Pentest & Sec', username: '@pentest_appsec_devsecops_job', price: 225, category: 'Разработка' },
  { name: 'Blockchain', username: '@blockchain_solidity_job', price: 225, category: 'Разработка' },
  { name: 'C++', username: '@c_plus_plus_job_geeklink', price: 225, category: 'Разработка' },
  { name: 'C# .NET', username: '@net_c_sharp_job', price: 225, category: 'Разработка' },
  { name: 'Python', username: '@python_django_job', price: 225, category: 'Разработка' },
  { name: 'Java', username: '@java_spring_job_geeklink', price: 225, category: 'Разработка' },
  { name: 'Golang', username: '@golang_job_geeklink', price: 225, category: 'Разработка' },
  { name: 'PHP', username: '@php_symfony_laravel_job', price: 225, category: 'Разработка' },
  { name: 'JS/Node/Vue', username: '@js_node_typescript_vue_job', price: 225, category: 'Разработка' },
  { name: 'Ruby', username: '@ruby_on_rails_job_geeklink', price: 225, category: 'Разработка' },
  { name: 'GameDev', username: '@gamedev_unity_unreal_engine_jobs', price: 225, category: 'Разработка' },
  { name: 'QA / Тестирование', username: '@qa_job_geeklink', price: 225, category: 'Разработка' },
  { name: 'iOS', username: '@ios_swift_job', price: 225, category: 'Разработка' },
  { name: 'Android', username: '@android_kotlin_job_geeklink', price: 225, category: 'Разработка' },
  { name: 'Flutter', username: '@flutter_react_native_job', price: 225, category: 'Разработка' },
  { name: 'DevOps', username: '@devops_job_geeklink', price: 225, category: 'Разработка' },
  { name: 'DB Admin', username: '@database_administrator_job', price: 225, category: 'Разработка' },
  { name: 'Support', username: '@otp_job_geeklink', price: 225, category: 'Разработка' },

  // Дизайн
  { name: 'Дизайнеры', username: '@ux_ui_graph_designers_job', price: 225, category: 'Дизайн' },
  { name: 'Аниматоры/3D', username: '@animator_modeller_2d_3d_job', price: 225, category: 'Дизайн' },

  // Маркетинг
  { name: 'Маркетологи', username: '@marketing_job_geeklink', price: 225, category: 'Маркетинг' },
  { name: 'SMM & SEO', username: '@smm_seo_serm_crm_job', price: 225, category: 'Маркетинг' },
  { name: 'Таргетологи', username: '@targeting_job', price: 225, category: 'Маркетинг' },

  // Менеджмент
  { name: 'Директора/Менеджеры', username: '@manager_job_geeklink', price: 225, category: 'Менеджмент' },
  { name: 'Product/Project', username: '@product_project_job', price: 225, category: 'Менеджмент' },
  { name: 'HR/Recruiter', username: '@hr_recruiter_job_geeklink', price: 225, category: 'Менеджмент' },
  { name: 'Sales', username: '@sales_manager_job', price: 225, category: 'Менеджмент' },

  // Уровни
  { name: 'Junior', username: '@junior_intern_job', price: 75, category: 'Уровни' },
  { name: 'Middle', username: '@middle_job_it', price: 75, category: 'Уровни' },
  { name: 'Senior', username: '@senior_job_it', price: 75, category: 'Уровни' },
  { name: 'Lead', username: '@teamlead_job_it', price: 75, category: 'Уровни' },

  // Прочее
  { name: 'Копирайтеры', username: '@editor_job', price: 75, category: 'Прочее' },
  { name: 'Видео/Звук', username: '@video_sound_job', price: 75, category: 'Прочее' },
  { name: 'Релокация', username: '@relocate_job_geeklink', price: 75, category: 'Прочее' },
  { name: 'Удаленка', username: '@remote_job_it_geeklink', price: 75, category: 'Прочее' },
];

async function main() {
  console.log('Start seeding channels...');
  for (const channel of channels) {
    await prisma.tgChannel.upsert({
      where: { username: channel.username },
      update: {
        priceStars: channel.price,
        name: channel.name,
        category: channel.category
      },
      create: {
        name: channel.name,
        username: channel.username,
        category: channel.category,
        priceStars: channel.price,
      },
    });
  }
  console.log('Seeding finished.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });