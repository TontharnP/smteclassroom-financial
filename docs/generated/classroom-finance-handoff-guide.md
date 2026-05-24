# คู่มือส่งต่อ Classroom Finance 5

เอกสารนี้เป็นคู่มือแบบ step-by-step สำหรับคนที่จะรับช่วงดูแลระบบ Classroom Finance 5 ต่อ ตั้งแต่รับโฟลเดอร์โปรเจกต์, ติดตั้งเครื่อง, ตั้งค่า Supabase, ตั้งค่า LINE, ตั้งค่า Vercel Blob, deploy, ใช้งานระบบจริง, ตรวจสลิป, แก้ปัญหา และ checklist ก่อนส่งต่อรุ่นถัดไป

> เวอร์ชันเอกสาร: 2026-05-24  
> โปรเจกต์: Classroom Finance 5  
> Framework: Next.js 16 App Router  
> Build validation ที่ใช้ในโปรเจกต์นี้: `npx next build --webpack`

---

## 1. ภาพรวมระบบ

Classroom Finance 5 คือระบบบริหารเงินห้องเรียน มี 2 ส่วนหลัก

1. เว็บสำหรับเหรัญญิกหรือผู้ดูแลระบบ ใช้จัดการนักเรียน รายการรับจ่าย กำหนดการเก็บเงิน หมวดหมู่ กระเป๋าเงิน และการตรวจรายการชำระเงิน
2. LINE Official Account สำหรับนักเรียน ใช้ลงทะเบียน ดูยอดค้าง ชำระเงิน ส่งสลิป และรับผลการตรวจสลิป

หลักสำคัญของระบบคือ รายการเงินจริงจะถูกบันทึกใน `transactions` เท่านั้น ส่วนขั้นตอนที่ยังไม่จบ เช่น นักเรียนเลือกยอดแล้วแต่ยังไม่ส่งสลิป หรือส่งสลิปแล้วรอตรวจ จะอยู่ใน `line_payment_requests` เพื่อป้องกันยอดเงินเพี้ยน

---

## 2. โฟลเดอร์ที่ใช้ส่งต่อ

โฟลเดอร์ clean handoff อยู่ที่

```txt
/Users/mac/Desktop/Project/SMTE_19/smte_finacial_webapp_handoff
```

โฟลเดอร์นี้ควรมีไฟล์สำคัญดังนี้

```txt
.env.example
README.md
package.json
package-lock.json
next.config.ts
tsconfig.json
vercel.json
src/
public/
scripts/
supabase/
docs/
```

โฟลเดอร์นี้ไม่ควรมีไฟล์ต่อไปนี้

```txt
.env
.env.local
.git/
node_modules/
.next/
.antigravitycli/
.claude/
.agents/
```

เหตุผล: ไฟล์พวกนี้เป็น secret, dependency cache, build output หรือ metadata เฉพาะเครื่อง ไม่ควรส่งต่อให้คนอื่นแบบรวมไปกับ source code

---

## 3. สิ่งที่ต้องเตรียมก่อนเริ่ม

### 3.1 บัญชีและสิทธิ์ที่ต้องมี

1. บัญชี Supabase สำหรับ database และ Supabase Storage
2. บัญชี Vercel สำหรับ deploy เว็บ
3. LINE Developers account และ LINE Official Account
4. Vercel Blob token ถ้าจะใช้ upload รูปทั่วไปผ่าน Vercel Blob
5. EasySlip API key ถ้าจะใช้ตรวจสลิปอัตโนมัติ
6. ข้อมูลบัญชีรับเงิน เช่น PromptPay ID, เลขบัญชีธนาคาร, ชื่อบัญชี, เบอร์ TrueMoney

### 3.2 โปรแกรมในเครื่อง

ติดตั้งอย่างน้อย

```txt
Node.js 20 หรือใหม่กว่า
npm
Git ถ้าจะใช้ version control
Browser เช่น Chrome, Brave, Safari
```

ตรวจเวอร์ชัน

```bash
node -v
npm -v
```

---

## 4. ติดตั้งโปรเจกต์ในเครื่องใหม่

### 4.1 เข้าโฟลเดอร์โปรเจกต์

```bash
cd /path/to/smte_finacial_webapp_handoff
```

### 4.2 ติดตั้ง dependency

```bash
npm install
```

ถ้าติดตั้งสำเร็จ จะมีโฟลเดอร์ `node_modules/` เกิดขึ้นในเครื่องนั้น แต่ไม่ต้องส่งต่อโฟลเดอร์นี้ให้คนอื่น

### 4.3 สร้างไฟล์ environment

```bash
cp .env.example .env.local
```

จากนั้นเปิด `.env.local` แล้วกรอกค่าจริง

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
LINE_CHANNEL_ACCESS_TOKEN=your-line-channel-access-token
LINE_CHANNEL_SECRET=your-line-channel-secret
SUPABASE_SLIP_BUCKET=payment-slips
EASYSLIP_API_KEY=your-easyslip-api-key
EASYSLIP_CHECK_DUPLICATE=true
EASYSLIP_MATCH_ACCOUNT=true
SLIP_RECEIVER_ACCOUNT_NAME=your-receiver-account-name
SLIP_RECEIVER_ACCOUNT_NUMBER=your-receiver-account-number
SLIP_RECEIVER_ACCOUNT_NUMBERS=optional,comma,separated,receiver,account,numbers
TRUEMONEY_RECEIVER_ACCOUNT_NUMBER=optional-truemoney-receiver-number
TRUEMONEY_RECEIVER_ACCOUNT_NUMBERS=optional,comma,separated,trumoney,receiver,numbers
TRUEMONEY_RECEIVER_ACCOUNT_NAME=optional-truemoney-receiver-name
TRUEMONEY_AUTO_REJECT_RECEIVER_MISMATCH=false
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
```

สำคัญมาก: ห้าม commit หรือส่งต่อ `.env.local` เพราะมี secret จริง

---

## 5. คำสั่งหลักที่ต้องรู้

ติดตั้ง dependency

```bash
npm install
```

รันเว็บแบบ development

```bash
npm run dev
```

เปิดเว็บ local

```txt
http://localhost:3000
```

ตรวจ lint

```bash
npm run lint
```

ตรวจ production build ของโปรเจกต์นี้

```bash
npx next build --webpack
```

รัน production server หลัง build

```bash
npm start
```

หมายเหตุ: โปรเจกต์นี้ให้ใช้ `npx next build --webpack` แทน `npm run build` สำหรับ build validation

---

## 6. ตั้งค่า Supabase แบบละเอียด

### 6.1 สร้าง Supabase project

1. เข้า `https://app.supabase.com`
2. กด New Project
3. ตั้งชื่อ project เช่น `classroom-finance-5`
4. เลือก region ที่ใกล้ผู้ใช้งาน
5. ตั้ง database password ที่แข็งแรง
6. รอ Supabase provision project ให้เสร็จ

### 6.2 เอา URL และ service role key

1. เข้า Supabase project
2. ไปที่ Settings
3. ไปที่ API
4. คัดลอก Project URL ไปใส่ `SUPABASE_URL`
5. คัดลอก service_role key ไปใส่ `SUPABASE_SERVICE_ROLE_KEY`

คำเตือน: service role key มีสิทธิ์สูงมาก ต้องใช้เฉพาะ server-side และเก็บใน `.env.local` หรือ Vercel Environment Variables เท่านั้น

### 6.3 Apply migrations ตามลำดับ

เปิด Supabase SQL Editor แล้วรันไฟล์ SQL ในโฟลเดอร์นี้ตามลำดับเลข

```txt
supabase/migrations/001_initial_schema.sql
supabase/migrations/002_change_bank_to_kplus.sql
supabase/migrations/003_create_categories_table.sql
supabase/migrations/004_add_pockets_columns.sql
supabase/migrations/005_add_schedule_folders.sql
supabase/migrations/006_add_projects_table.sql
supabase/migrations/007_add_student_line_user_id.sql
supabase/migrations/008_add_line_payment_requests.sql
supabase/migrations/009_add_slip_review_fields.sql
supabase/migrations/010_add_slip_transaction_id.sql
supabase/migrations/011_add_line_payment_slip_archives.sql
supabase/migrations/012_add_app_settings.sql
```

วิธีรันแต่ละไฟล์

1. เปิดไฟล์ SQL ใน editor
2. Copy ทั้งไฟล์
3. วางใน Supabase SQL Editor
4. กด Run
5. รอข้อความ success
6. ไปไฟล์ถัดไป

ห้ามข้าม migration เพราะตารางและ column หลายตัวต่อกันเป็นลำดับ

### 6.4 ตารางสำคัญที่ควรเห็น

หลังรัน migration แล้วควรมีตารางหลักอย่างน้อย

```txt
students
schedules
transactions
categories
schedule_folders
line_payment_requests
line_payment_slip_archives
app_settings
```

หน้าที่ของแต่ละตาราง

```txt
students: ข้อมูลนักเรียนและ line_user_id
schedules: กำหนดการเก็บเงิน
transactions: รายการเงินจริงที่ปิดงานแล้ว
categories: หมวดหมู่รับจ่าย
schedule_folders: โฟลเดอร์จัดกลุ่มกำหนดการ
line_payment_requests: สถานะการจ่ายเงินผ่าน LINE ที่ยังอยู่ใน workflow
line_payment_slip_archives: เก็บ metadata ของสลิปหลังรายการถูก approve
app_settings: ค่า settings runtime ที่แก้จากหน้าเว็บได้
```

### 6.5 Supabase Storage สำหรับสลิป

ระบบใช้ bucket ส่วนตัวชื่อ

```txt
payment-slips
```

ตั้งค่าที่แนะนำ

```txt
Public bucket: ปิด
Allowed MIME types: image/jpeg,image/png,image/webp
```

Migration `009_add_slip_review_fields.sql` จะช่วยสร้างหรืออัปเดต bucket นี้ ถ้าไม่มี แต่ควรตรวจใน Supabase Storage อีกครั้งว่ามีจริงและเป็น private

### 6.6 ทดสอบ Supabase หลัง setup

1. ใส่ `SUPABASE_URL` และ `SUPABASE_SERVICE_ROLE_KEY` ใน `.env.local`
2. รันเว็บ

```bash
npm run dev
```

3. เปิด

```txt
http://localhost:3000/api/health
```

4. เปิดหน้าเว็บหลัก

```txt
http://localhost:3000
```

ถ้าเชื่อมต่อไม่ได้ ให้ตรวจ env, migration, และ Supabase project URL อีกครั้ง

---

## 7. ตั้งค่า Settings ในหน้าเว็บ

หลัง migration `012_add_app_settings.sql` จะมีหน้า settings ที่

```txt
/settings
```

บน local คือ

```txt
http://localhost:3000/settings
```

บน production คือ

```txt
https://your-domain.com/settings
```

ระบบอ่านค่าจากหน้า settings ก่อน ถ้าค่าบางตัวว่างจะ fallback ไปใช้ env

### 7.1 ค่า bootstrap ที่ยังต้องมีใน env

สองค่านี้ยังต้องมีใน `.env.local` หรือ Vercel Environment Variables เสมอ

```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

เหตุผล: เว็บต้องใช้สองค่านี้เพื่อเชื่อม Supabase ก่อน แล้วจึงอ่านค่าอื่นจาก `app_settings`

### 7.2 ค่าที่ควรกรอกในหน้า settings

```txt
Supabase URL
Supabase Service Role Key
LINE Channel Access Token
LINE Channel Secret
EasySlip API Key
Vercel Blob Read/Write Token
PromptPay ID
ชื่อบัญชีรับโอนธนาคาร
เลขบัญชีรับโอนธนาคาร
PromptPay/เลขบัญชีเพิ่มเติม
ชื่อบัญชี TrueMoney
เบอร์ TrueMoney
Supabase Slip Bucket
Slip checker flags
ข้อความ LINE ต่างๆ
Rich menu action text
```

หลังแก้ค่า ให้กดบันทึก และทดสอบ request ถัดไป

### 7.3 Export และ Import settings

Export

1. เข้า `/settings`
2. กด Export
3. เก็บไฟล์ `classroom-finance-settings.json`

Import

1. เข้า `/settings`
2. กด Import
3. เลือกไฟล์ JSON ที่เคย export
4. ตรวจค่าที่โหลดขึ้นมา
5. กดบันทึก

ควร export settings เก็บไว้ทุกครั้งก่อนส่งต่อรุ่นถัดไป

---

## 8. ตั้งค่า LINE Official Account

### 8.1 สร้าง LINE Messaging API channel

1. เข้า LINE Developers Console
2. สร้าง Provider หรือใช้ Provider เดิม
3. สร้าง Messaging API channel
4. ผูกกับ LINE Official Account
5. เปิด Use webhook
6. ปิด Auto-reply ที่ชนกับ webhook ถ้าไม่ต้องการให้ตอบซ้ำ

### 8.2 เอา Channel Secret และ Channel Access Token

ใน LINE Developers

```txt
Basic settings -> Channel secret
Messaging API -> Channel access token
```

นำไปใส่

```env
LINE_CHANNEL_SECRET=
LINE_CHANNEL_ACCESS_TOKEN=
```

หรือกรอกในหน้า `/settings`

### 8.3 ตั้ง Webhook URL

Production URL ต้องเป็น HTTPS

```txt
https://your-domain.com/api/line/webhook
```

จากนั้นกด Verify ใน LINE Developers

ถ้าใช้ local ต้องใช้ tunnel เช่น ngrok หรือ deploy ไป production ก่อน เพราะ LINE ต้องยิง webhook เข้า URL ที่เข้าจาก internet ได้

### 8.4 ตั้งค่า Rich Menu

ไฟล์รูป rich menu อยู่ที่

```txt
public/line/rich-menu-register.png
public/line/rich-menu-registered.png
```

หลังตั้งค่า LINE token แล้ว ให้เรียก endpoint นี้

```bash
curl -X POST https://your-domain.com/api/line/rich-menu/setup
```

ถ้า local และ LINE เข้าถึง local ได้ผ่าน tunnel ให้ใช้ domain ของ tunnel แทน

หลังรันแล้วควรทดสอบใน LINE ว่าปุ่ม rich menu ส่งข้อความตรงกับ action text ใน `/settings`

---

## 9. ตั้งค่า Vercel Blob

ระบบใช้ Vercel Blob สำหรับ upload รูปทั่วไป เช่น profile/category image ผ่าน endpoint `/api/uploads`

ขั้นตอน

1. เข้า Vercel project
2. ไปที่ Storage
3. สร้าง Blob store
4. สร้าง Read/Write token
5. ใส่ token ใน Vercel Environment Variables หรือหน้า settings

```env
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
```

ถ้าไม่มี token upload รูปทั่วไปจะล้มเหลว แต่ส่วนอื่นของเว็บอาจยังใช้งานได้

---

## 10. ตั้งค่า EasySlip และการตรวจสลิป

### 10.1 ค่า EasySlip

ใส่ API key

```env
EASYSLIP_API_KEY=
```

ตั้งค่า duplicate และ account matching

```env
EASYSLIP_CHECK_DUPLICATE=true
EASYSLIP_MATCH_ACCOUNT=true
```

### 10.2 ข้อมูลปลายทางที่ต้องตรงกับบัญชีจริง

ธนาคาร

```env
SLIP_RECEIVER_ACCOUNT_NAME=
SLIP_RECEIVER_ACCOUNT_NUMBER=
SLIP_RECEIVER_ACCOUNT_NUMBERS=
```

TrueMoney

```env
TRUEMONEY_RECEIVER_ACCOUNT_NAME=
TRUEMONEY_RECEIVER_ACCOUNT_NUMBER=
TRUEMONEY_RECEIVER_ACCOUNT_NUMBERS=
TRUEMONEY_AUTO_REJECT_RECEIVER_MISMATCH=false
```

### 10.3 หลักการตรวจสลิป

เมื่อเด็กส่งรูปสลิปใน LINE

1. webhook รับ image event
2. ระบบดาวน์โหลดรูปจาก LINE Content API
3. ระบบเก็บรูปใน Supabase Storage bucket `payment-slips`
4. ระบบเรียก EasySlip ถ้ามี API key
5. ระบบตรวจยอดเงิน ปลายทาง duplicate และหลักฐานจาก QR/OCR
6. ถ้าข้อมูลครบและผ่านเงื่อนไข ระบบสามารถ approve ได้ตาม logic ที่ตั้งไว้
7. ถ้าไม่มั่นใจ รายการจะเข้า manual review ให้เหรัญญิกตรวจในหน้าเว็บ

หลักปฏิบัติ: ถ้าไม่มั่นใจ อย่า auto approve ให้ตรวจเองในหน้าเว็บเสมอ

### 10.4 Debug สลิปด้วย script

ใช้สำหรับทดสอบไฟล์รูปในเครื่อง

```bash
node scripts/check-slip.js ./path/to/slip.jpg 80
```

พร้อมข้อมูลปลายทาง

```bash
node scripts/check-slip.js ./path/to/slip.jpg 80 "receiver-account" "Receiver Name"
```

---

## 11. Deploy บน Vercel

### 11.1 เตรียม repo

ถ้าจะ deploy ผ่าน GitHub

1. สร้าง GitHub repo
2. push source code ขึ้น repo
3. อย่า push `.env.local`
4. เชื่อม repo กับ Vercel

### 11.2 ตั้ง Environment Variables บน Vercel

ใส่ค่าขั้นต่ำ

```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

ใส่ค่าอื่นตามการใช้งาน

```env
LINE_CHANNEL_ACCESS_TOKEN=
LINE_CHANNEL_SECRET=
BLOB_READ_WRITE_TOKEN=
EASYSLIP_API_KEY=
SUPABASE_SLIP_BUCKET=payment-slips
```

### 11.3 Deploy

ใน Vercel

1. Import project
2. Framework preset: Next.js
3. Install command: `npm install`
4. Build command บน Vercel ใช้ค่า default ได้ แต่เวลาตรวจ local ให้ใช้ `npx next build --webpack`
5. Deploy

หลัง deploy เสร็จ ให้เอา production domain ไปตั้งใน LINE webhook

```txt
https://your-domain.com/api/line/webhook
```

### 11.4 ตรวจหลัง deploy

เปิด

```txt
https://your-domain.com
https://your-domain.com/settings
https://your-domain.com/api/health
```

จากนั้นทดสอบ

1. กรอก settings
2. รัน rich menu setup
3. ส่งข้อความลงทะเบียนใน LINE
4. สร้าง schedule ทดสอบ
5. ให้นักเรียนทดสอบส่งสลิปยอดเล็ก
6. ตรวจ approve/reject ในหน้าเว็บ

---

## 12. วิธีใช้งานเว็บสำหรับเหรัญญิก

### 12.1 Dashboard

ใช้ดูภาพรวมเงินห้อง

1. เปิดหน้า `/dashboard`
2. ดูยอดเงินรวม
3. ดูยอดรับและจ่าย
4. ดู breakdown ตาม payment method
5. ตรวจว่า schedule ไหนยังมีคนค้างจ่าย

### 12.2 Students

ใช้จัดการนักเรียน

1. เปิดหน้า `/students`
2. เพิ่มนักเรียนใหม่
3. กรอกคำนำหน้า ชื่อ นามสกุล ชื่อเล่น เลขที่
4. อัปโหลดรูปถ้ามี Blob token
5. แก้ไขหรือลบนักเรียนตามต้องการ
6. ตรวจ `line_user_id` หลังนักเรียนลงทะเบียนผ่าน LINE

ข้อควรระวัง: เลขที่นักเรียนควรไม่ซ้ำ เพราะนักเรียนใช้เลขที่ในการลงทะเบียน LINE

### 12.3 Categories

ใช้จัดกลุ่มรายการรับจ่าย

1. เปิดหน้า `/categories`
2. เพิ่มหมวดหมู่ เช่น ค่าเสื้อ ค่าเดินทาง เงินเข้า เงินออก
3. เลือก icon หรือรูป
4. ใช้หมวดหมู่ตอนสร้าง transaction

### 12.4 Transactions

ใช้จัดการรายการเงินจริง

1. เปิดหน้า `/transactions`
2. เพิ่มรายการรับเงิน
3. เพิ่มรายการจ่ายเงิน
4. เพิ่มรายการ transfer ถ้ามีการย้ายเงินระหว่าง pocket
5. แก้ไขรายการที่ผิด
6. ลบเฉพาะรายการที่มั่นใจว่าผิดจริง

ข้อควรระวัง: รายการที่เกิดจาก schedule payment ควรสัมพันธ์กับ `schedule_id` และ `student_id` เพื่อให้สถานะจ่ายเงินถูกต้อง

### 12.5 Schedule

ใช้สร้างกำหนดการเก็บเงิน

1. เปิดหน้า `/schedule`
2. สร้าง schedule ใหม่
3. ตั้งชื่อรายการ เช่น ค่ากิจกรรม, ค่าเสื้อ, ค่ารถ
4. ตั้งยอดต่อคน
5. เลือกนักเรียนที่ต้องจ่าย
6. บันทึก
7. เปิด detail เพื่อตรวจ paid/unpaid
8. ส่ง LINE reminder ให้คนที่ยังไม่จ่าย

### 12.6 Payment Review

ใน schedule detail หรือพื้นที่ review ที่เกี่ยวข้อง ให้ตรวจรายการจาก LINE

1. เปิด schedule ที่ต้องการ
2. ดูรายการ pending/cash/slip review
3. เปิดรูปสลิป
4. ตรวจยอดเงิน
5. ตรวจชื่อ/บัญชีปลายทาง
6. ตรวจว่าจ่าย schedule และนักเรียนถูกคน
7. กด approve ถ้าถูกต้อง
8. กด reject ถ้าผิด แล้วใส่เหตุผลให้ชัดเจน

เมื่อ approve ระบบจะสร้าง transaction จริงและจัดการ request ตาม workflow

---

## 13. วิธีใช้งานฝั่งนักเรียนผ่าน LINE

### 13.1 ลงทะเบียน

นักเรียนเพิ่ม LINE Official Account แล้วส่งเลขที่ของตัวเอง เช่น

```txt
24
```

หรือส่งคำสั่งลงทะเบียนตามที่ rich menu กำหนด

ระบบจะผูก LINE user id กับนักเรียนในตาราง `students`

### 13.2 ดูยอดค้าง

นักเรียนกดปุ่มจ่ายเงินหรือส่งคำสั่ง payment/status ตาม rich menu

ระบบจะส่งรายการค้างจ่ายที่ยังไม่จบ

### 13.3 เลือกรายการและวิธีจ่าย

นักเรียนเลือกรายการที่ต้องการจ่าย แล้วเลือกวิธีจ่าย

```txt
kplus
truemoney
cash
```

ธนาคารและ TrueMoney จะได้ QR/คำแนะนำและต้องส่งสลิปกลับมา

cash จะเข้าเป็นรายการรอเหรัญญิกยืนยันหลังรับเงินสด

### 13.4 ส่งสลิป

หลังโอนเงิน นักเรียนส่งรูปสลิปในแชท LINE เดิม

ระบบจะรับรูป ตรวจ และแจ้งผลตามข้อความใน settings

ถ้าไม่ผ่าน นักเรียนควรได้รับเหตุผลหรือคำแนะนำให้ส่งใหม่

---

## 14. Workflow การจ่ายเงินที่ถูกต้อง

สถานะหลักของ `line_payment_requests`

```txt
selecting
awaiting_slip
pending_review
pending_slip_review
cash_pending
approved
rejected
expired
```

ลำดับทั่วไป

1. นักเรียนเริ่มจ่ายเงิน
2. ระบบสร้าง request สถานะ `selecting`
3. นักเรียนเลือกวิธีจ่าย
4. ถ้าโอน/TrueMoney สถานะเป็น `awaiting_slip`
5. ถ้าเงินสด สถานะเป็น `cash_pending`
6. นักเรียนส่งสลิป
7. ระบบบันทึกรูปและ metadata
8. ระบบตรวจอัตโนมัติ
9. ถ้าผ่านหรือเหรัญญิก approve จะสร้าง transaction
10. ถ้า reject จะลบ/ปิด request และแจ้งนักเรียน

ข้อห้าม: อย่าสร้าง transaction เองซ้ำ ถ้า request ผ่าน LINE ถูก approve แล้ว เพราะจะทำให้ยอดเงินซ้ำ

---

## 15. Checklist ทดสอบระบบหลังติดตั้ง

### 15.1 Local checklist

```txt
[ ] npm install สำเร็จ
[ ] .env.local มี SUPABASE_URL
[ ] .env.local มี SUPABASE_SERVICE_ROLE_KEY
[ ] npm run dev เปิดได้
[ ] หน้า /settings เปิดได้
[ ] npm run lint ผ่าน ไม่มี error
[ ] npx next build --webpack ผ่าน
```

### 15.2 Supabase checklist

```txt
[ ] migrations 001-012 รันครบ
[ ] ตาราง students มีอยู่
[ ] ตาราง schedules มีอยู่
[ ] ตาราง transactions มีอยู่
[ ] ตาราง line_payment_requests มีอยู่
[ ] ตาราง app_settings มีอยู่
[ ] bucket payment-slips มีอยู่และเป็น private
```

### 15.3 LINE checklist

```txt
[ ] LINE_CHANNEL_SECRET ถูกต้อง
[ ] LINE_CHANNEL_ACCESS_TOKEN ถูกต้อง
[ ] Webhook URL เป็น /api/line/webhook
[ ] Use webhook เปิดอยู่
[ ] กด Verify ผ่าน
[ ] rich menu setup สำเร็จ
[ ] นักเรียน test ลงทะเบียนได้
[ ] นักเรียน test ดูยอดค้างได้
[ ] นักเรียน test ส่งสลิปได้
```

### 15.4 Production checklist

```txt
[ ] Vercel deploy ผ่าน
[ ] Environment Variables อยู่ใน Vercel ครบ
[ ] production /settings เปิดได้
[ ] production /api/health เปิดได้
[ ] LINE webhook ชี้ไป production domain
[ ] ทดสอบ schedule ยอดเล็กสำเร็จ
[ ] ทดสอบ approve/reject สำเร็จ
```

---

## 16. Troubleshooting

### 16.1 เปิดเว็บไม่ได้

ตรวจ

1. `npm install` แล้วหรือยัง
2. Node.js version เหมาะสมหรือไม่
3. `.env.local` มีค่าขั้นต่ำหรือไม่
4. port 3000 ถูก process อื่นใช้หรือไม่

ลอง

```bash
npm run dev
```

### 16.2 เชื่อม Supabase ไม่ได้

ตรวจ

1. `SUPABASE_URL` ถูกต้อง
2. `SUPABASE_SERVICE_ROLE_KEY` เป็น service role key ไม่ใช่ anon key
3. migration รันครบ
4. restart dev server หลังแก้ `.env.local`

### 16.3 หน้า settings error

ตรวจ

1. มี `app_settings` table หรือยัง
2. รัน `012_add_app_settings.sql` แล้วหรือยัง
3. env bootstrap Supabase มีหรือไม่

### 16.4 LINE ไม่ตอบ

ตรวจ

1. Webhook URL ถูก domain
2. URL ลงท้าย `/api/line/webhook`
3. ใช้ HTTPS ใน production
4. `LINE_CHANNEL_SECRET` ตรง channel
5. token ยังไม่หมดอายุ
6. LINE Developers เปิด Use webhook
7. Vercel deploy ล่าสุดแล้ว

### 16.5 Rich menu กดแล้วไม่ตรง

ทำตามลำดับ

1. เข้า `/settings`
2. ตรวจ action text
3. กดบันทึก
4. รัน `POST /api/line/rich-menu/setup`
5. ปิดเปิด LINE หรือรอ rich menu refresh

### 16.6 สลิปไม่ผ่าน

ตรวจ

1. รูปชัดไหม
2. ยอดเงินตรงไหม
3. วิธีจ่ายตรงไหม เช่น เลือก TrueMoney แต่ส่งสลิปธนาคารหรือไม่
4. บัญชีปลายทางตรง settings ไหม
5. EasySlip API key ใช้ได้ไหม
6. duplicate flag ทำให้ซ้ำหรือไม่

### 16.7 Upload รูปไม่ได้

ตรวจ

1. `BLOB_READ_WRITE_TOKEN` มีไหม
2. token อยู่ใน Vercel env หรือ settings หรือไม่
3. ขนาดไฟล์ใหญ่เกินหรือไม่
4. MIME type เป็น image ที่ระบบรองรับหรือไม่

### 16.8 Build fail

ใช้คำสั่งนี้เท่านั้นสำหรับ build validation

```bash
npx next build --webpack
```

ถ้าขึ้นว่ามี build process ค้าง ให้รอ process เดิมจบก่อน ถ้าเป็น stale lock จาก build ที่ถูก interrupt ให้ตรวจ `.next/lock` อย่างระวัง

---

## 17. Security checklist

```txt
[ ] ไม่ส่งต่อ .env.local
[ ] ไม่ส่งต่อ service role key ในแชทสาธารณะ
[ ] ไม่ใส่ LINE token ใน frontend code
[ ] ไม่เปิด bucket payment-slips เป็น public
[ ] จำกัดคนที่เข้าถึง Vercel และ Supabase
[ ] เปลี่ยน token ถ้าสงสัยว่ารั่ว
[ ] backup settings ก่อนเปลี่ยนค่าใหญ่
```

---

## 18. Checklist ส่งต่อรุ่นน้อง

ก่อนส่งต่อ ให้เตรียม

```txt
[ ] โฟลเดอร์ smte_finacial_webapp_handoff
[ ] ไฟล์ .env.example
[ ] คู่มือ PDF นี้
[ ] classroom-finance-settings.json ที่ export จาก /settings ถ้ามี
[ ] Supabase project access หรือคำอธิบายว่าต้องสร้างใหม่
[ ] Vercel project access
[ ] LINE Developers access
[ ] EasySlip access ถ้าใช้
[ ] ข้อมูลบัญชีรับเงินจริง
```

วันส่งต่อให้ทำ demo

1. เปิดเว็บ production
2. เปิด `/settings`
3. อธิบาย env bootstrap
4. สร้างนักเรียน test
5. สร้าง schedule test ยอดเล็ก
6. ลงทะเบียน LINE ด้วย account test
7. กดจ่ายเงินผ่าน LINE
8. ส่งสลิป test
9. approve/reject ในเว็บ
10. export settings ให้รุ่นถัดไปเก็บไว้

---

## 19. ไฟล์อ้างอิงในโปรเจกต์

```txt
README.md
.env.example
docs/คู่มือตั้งค่าระบบและข้อความ_LINE.md
supabase/STORAGE_SETUP.md
supabase/migrations/
src/app/settings/page.tsx
src/components/settings/SettingsPanel.tsx
src/app/api/settings/route.ts
src/app/api/line/webhook/route.ts
src/app/api/line/rich-menu/setup/route.ts
src/lib/server/slipCheck.ts
src/lib/server/easySlip.ts
scripts/check-slip.js
```

---

## 20. สรุปสั้นสำหรับคนรับงาน

ถ้าเริ่มจากศูนย์ ให้ทำตามลำดับนี้

1. `npm install`
2. `cp .env.example .env.local`
3. สร้าง Supabase project
4. ใส่ `SUPABASE_URL` และ `SUPABASE_SERVICE_ROLE_KEY`
5. รัน migrations 001-012
6. `npm run dev`
7. เปิด `/settings`
8. กรอก LINE, EasySlip, Blob, PromptPay, receiver
9. deploy Vercel
10. ตั้ง LINE webhook เป็น `/api/line/webhook`
11. รัน rich menu setup
12. ทดสอบลงทะเบียน LINE
13. ทดสอบจ่ายเงินยอดเล็ก
14. ตรวจ `npm run lint`
15. ตรวจ `npx next build --webpack`

ถ้าทำครบ ระบบพร้อมใช้งานและพร้อมส่งต่อ
