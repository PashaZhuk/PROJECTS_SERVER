import nodemailer from 'nodemailer';
import { config } from 'dotenv';
import logger from '../utils/logger.js';

config();

// B26: Ленивая инициализация SMTP — transporter создаётся при первой отправке
let transporter: nodemailer.Transporter | null = null;

const getTransporter = (): nodemailer.Transporter => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: process.env.SMTP_SECURE === 'true',
      connectionTimeout: 5000,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
};

interface Attachment {
  filename: string;
  content: string | Buffer;
  encoding?: string;
}

interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
  attachments?: Attachment[];
}

export const sendEmail = async ({ to, subject, html, attachments }: SendMailOptions) => {
  try {
    const t = getTransporter();
    const info = await t.sendMail({
      from: `"IPMATIKA B2B" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html,
      attachments,
    });
    logger.info(`Email sent to ${to}: ${info.messageId}`);
    return true;
  } catch (error: any) {
    logger.error(`Error sending email to ${to}:`, { error: error.message });
    throw new Error('Не удалось отправить письмо');
  }
};

export const generateWelcomeEmail = (name: string, email: string, tempPassword: string, loginUrl: string) => {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
      <h2 style="color: #333; text-align: center;">Добро пожаловать в IPMATIKA Bel B2B!</h2>
      <p>Здравствуйте, <strong>${name}</strong>!</p>
      <p>Ваш аккаунт был создан. Используйте следующие данные для входа:</p>
      
      <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0;">
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Временный пароль:</strong> <code style="background: #eee; padding: 2px 5px; border-radius: 3px;">${tempPassword}</code></p>
      </div>

      <p style="color: #d9534f; font-size: 14px;">Внимание: После первого входа необходимо сменить пароль.</p>
      
      <div style="text-align: center; margin-top: 30px;">
        <a href="${loginUrl}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">Перейти к входу</a>
      </div>

      <hr style="margin-top: 30px; border: 0; border-top: 1px solid #eee;">
      <p style="font-size: 12px; color: #888; text-align: center;">Это автоматическое письмо, пожалуйста, не отвечайте на него.</p>
    </div>
  `;
};

export const generateResetPasswordEmail = (resetLink: string) => {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
      <h2 style="color: #333; text-align: center;">Восстановление пароля</h2>
      <p>Вы запросили сброс пароля для вашего аккаунта в IPMATIKA Bel B2B.</p>
      
      <p>Нажмите на ссылку ниже, чтобы задать новый пароль:</p>
      
      <div style="text-align: center; margin: 30px 0;">
        <a href="${resetLink}" style="background-color: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px;">Сбросить пароль</a>
      </div>

      <p>Если вы не запрашивали сброс пароля, просто проигнорируйте это письмо. Ваш пароль останется прежним.</p>
      <p>Ссылка действительна в течение <strong>1 часа</strong>.</p>

      <hr style="margin-top: 30px; border: 0; border-top: 1px solid #eee;">
      <p style="font-size: 12px; color: #888; text-align: center;">2026 IPMATIKA Bel B2B. Все права защищены.</p>
    </div>
  `;
};