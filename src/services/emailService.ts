import nodemailer from 'nodemailer';
import { config } from 'dotenv';

config();

// Настройка транспортера
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
  debug: true, 
  logger: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Проверка подключения (опционально, можно убрать в продакшене)
transporter.verify((error, success) => {
  if (error) {
    console.error('❌ SMTP Connection Error:', error);
  } else {
    console.log('✅ Server is ready to take our messages');
  }
});

interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
}

export const sendEmail = async ({ to, subject, html }: SendMailOptions) => {
  try {
    const info = await transporter.sendMail({
      from: `"IPMATICA Hub" <${process.env.SMTP_USER}>`, // Sender address
      to,
      subject,
      html,
    });
    console.log(`📧 Email sent to ${to}: %s`, info.messageId);
    return true;
  } catch (error) {
    console.error(`❌ Error sending email to ${to}:`, error);
    throw new Error('Не удалось отправить письмо');
  }
};

// --- ШАБЛОНЫ ПИСЕМ ---

/**
 * Письмо для нового пользователя (при создании админом)
 */
export const generateWelcomeEmail = (name: string, email: string, tempPassword: string, loginUrl: string) => {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
      <h2 style="color: #333; text-align: center;">Добро пожаловать в IPMATIKA B2B!</h2>
      <p>Здравствуйте, <strong>${name}</strong>!</p>
      <p>Ваш аккаунт был успешно создан. Ниже ваши данные для входа:</p>
      
      <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0;">
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Временный пароль:</strong> <code style="background: #eee; padding: 2px 5px; border-radius: 3px;">${tempPassword}</code></p>
      </div>

      <p style="color: #d9534f; font-size: 14px;">⚠️ В целях безопасности вы обязаны сменить этот пароль при первом входе.</p>
      
      <div style="text-align: center; margin-top: 30px;">
        <a href="${loginUrl}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">Перейти ко входу</a>
      </div>

      <hr style="margin-top: 30px; border: 0; border-top: 1px solid #eee;">
      <p style="font-size: 12px; color: #888; text-align: center;">Это автоматическое письмо, пожалуйста, не отвечайте на него.</p>
    </div>
  `;
};

/**
 * Письмо для восстановления пароля
 */
export const generateResetPasswordEmail = (resetLink: string) => {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
      <h2 style="color: #333; text-align: center;">Восстановление доступа</h2>
      <p>Вы получили это письмо, потому что запросили сброс пароля для вашего аккаунта в IPMATIKA B2B.</p>
      
      <p>Нажмите на кнопку ниже, чтобы установить новый пароль:</p>
      
      <div style="text-align: center; margin: 30px 0;">
        <a href="${resetLink}" style="background-color: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px;">Сбросить пароль</a>
      </div>

      <p>Если вы не запрашивали сброс пароля, просто проигнорируйте это письмо. Ваш пароль останется прежним.</p>
      <p>Ссылка действительна в течение <strong>1 часа</strong>.</p>

      <hr style="margin-top: 30px; border: 0; border-top: 1px solid #eee;">
      <p style="font-size: 12px; color: #888; text-align: center;">© 2026 IPMATIKA B2B. Все права защищены.</p>
    </div>
  `;
};