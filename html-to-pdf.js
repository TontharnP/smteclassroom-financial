#!/usr/bin/env node

/**
 * Script to convert HTML to PDF using Puppeteer
 * Run: node html-to-pdf.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function convertHTMLToPDF() {
  try {
    // Try using puppeteer if available
    let puppeteer;
    try {
      puppeteer = await import('puppeteer');
    } catch {
      console.log('📦 ติดตั้ง puppeteer...');
      console.log('   npm install puppeteer');
      console.log('');
      console.log('📝 วิธีสร้าง PDF ด้วยมือ (ง่าย ๆ):');
      console.log('   1. เปิดไฟล์ HTML ในเบราว์เซอร์ Chrome/Firefox');
      console.log('   2. กด Ctrl+P (Windows) หรือ Cmd+P (macOS)');
      console.log('   3. เลือก "Save as PDF"');
      console.log('   4. ตั้งชื่อไฟล์เป็น "คู่มือการเริ่มต้นใช้งาน"');
      console.log('   5. กด Save');
      process.exit(1);
    }

    const htmlPath = path.join(__dirname, 'คู่มือการเริ่มต้นใช้งาน_ฉบับสมบูรณ์.html');
    const pdfPath = path.join(__dirname, 'คู่มือการเริ่มต้นใช้งาน_Classroom_Finance.pdf');

    if (!fs.existsSync(htmlPath)) {
      console.error('❌ ไม่พบไฟล์ HTML');
      process.exit(1);
    }

    console.log('🔄 กำลังแปลงไฟล์ HTML เป็น PDF...');
    const browser = await puppeteer.default.launch();
    const page = await browser.newPage();
    
    await page.goto(`file://${htmlPath}`, {
      waitUntil: 'networkidle0'
    });

    await page.pdf({
      path: pdfPath,
      format: 'A4',
      margin: { top: 20, right: 20, bottom: 20, left: 20 },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: '<div style="font-size: 10px; text-align: center; width: 100%;">หน้า <span class="pageNumber"></span> จากทั้งหมด <span class="totalPages"></span></div>',
      scale: 1,
      printBackground: true
    });

    await browser.close();
    console.log(`✅ สำเร็จ! ไฟล์ PDF บันทึกไว้ที่: ${pdfPath}`);
  } catch (error) {
    console.error('❌ เกิดข้อผิดพลาด:', error.message);
    process.exit(1);
  }
}

convertHTMLToPDF();
