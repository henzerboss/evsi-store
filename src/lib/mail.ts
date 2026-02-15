import nodemailer from 'nodemailer';

// Настройки вашего почтового сервера (evsi.store)
// Убедитесь, что в .env указаны данные от support@evsi.store
const SMTP_HOST = process.env.SMTP_HOST || 'mail.evsi.store';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465');
const SMTP_USER = process.env.SMTP_USER; // Логин (support@evsi.store)
const SMTP_PASS = process.env.SMTP_PASS; // Пароль от почты

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_PORT === 465, // true для 465, false для других портов
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS,
  },
});

export async function sendNotificationEmail(orderId: string, type: string, amount: number, username: string | null) {
  if (!SMTP_USER || !SMTP_PASS) {
    console.warn('⚠️ SMTP credentials not found. Email notification skipped.');
    return;
  }

  const adminUrl = `https://evsi.store/ru/tg-admin`; // Ссылка на вашу админку

  try {
    await transporter.sendMail({
      from: `"Evsi Bot" <support@evsi.store>`, // Отправитель
      to: 'henzerboss@gmail.com', // Получатель (Админ)
      subject: `🔥 Новая заявка на модерацию: ${type}`,
      html: `
        <h1>Поступила новая оплаченная заявка!</h1>
        <p><b>Тип:</b> ${type === 'VACANCY' ? 'Вакансия' : 'Резюме'}</p>
        <p><b>Пользователь:</b> ${username ? '@' + username : 'Скрыт'}</p>
        <p><b>Сумма:</b> ${amount} ⭐️</p>
        <p><b>ID заказа:</b> ${orderId}</p>
        <br/>
        <p>
          <a href="${adminUrl}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
            Перейти в админку
          </a>
        </p>
      `,
    });
    console.log(`📧 Email notification sent to henzerboss@gmail.com for order ${orderId}`);
  } catch (error) {
    console.error('❌ Failed to send email notification:', error);
  }
}