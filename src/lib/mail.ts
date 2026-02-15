import nodemailer from 'nodemailer';

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465');
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_PORT === 465, // true для 465, false для других портов
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS,
  },
  // Для отладки (если сервер использует самоподписанный сертификат)
  tls: {
    rejectUnauthorized: false
  }
});

// Проверка соединения при инициализации (поможет увидеть ошибку в логах сервера при старте)
transporter.verify(function (error, success) {
  if (error) {
    console.error('❌ SMTP Connection Error:', error);
  } else {
    console.log('✅ SMTP Server is ready to take our messages');
  }
});

export async function sendNotificationEmail(orderId: string, type: string, amount: number, username: string | null) {
  if (!SMTP_USER || !SMTP_PASS) {
    console.warn('⚠️ SMTP credentials not found. Email notification skipped.');
    return;
  }

  const adminUrl = `https://evsi.store/ru/tg-admin`; 

  console.log(`📧 Attempting to send email to henzerboss@gmail.com...`);

  try {
    const info = await transporter.sendMail({
      from: `"Evsi Bot" <${SMTP_USER}>`, // ВАЖНО: Яндекс требует, чтобы тут была именно почта авторизации
      to: 'henzerboss@gmail.com', 
      subject: `🔥 Новая заявка на модерацию: ${type}`,
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2 style="color: #333;">Поступила новая оплаченная заявка!</h2>
          <p><b>Тип:</b> ${type === 'VACANCY' ? '💼 Вакансия' : '👤 Резюме'}</p>
          <p><b>Пользователь:</b> ${username ? '@' + username : 'Скрыт'}</p>
          <p><b>Сумма:</b> <strong style="color: #d97706;">${amount} ⭐️</strong></p>
          <p style="color: #777; font-size: 12px;">ID заказа: ${orderId}</p>
          <br/>
          <a href="${adminUrl}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
            Перейти в админку
          </a>
        </div>
      `,
    });
    console.log(`✅ Email sent successfully! Message ID: ${info.messageId}`);
  } catch (error) {
    console.error('❌ Failed to send email notification:', error);
  }
}