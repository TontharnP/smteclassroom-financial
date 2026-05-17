# Classroom Finance 5

เว็บแอปจัดการการเงินห้องเรียนสำหรับรายรับ รายจ่าย กำหนดการเก็บเงิน นักเรียน กระเป๋าเงิน หมวดหมู่ และการชำระเงินผ่าน LINE พร้อมระบบตรวจสลิปแบบกึ่งอัตโนมัติ

## ภาพรวมระบบ

Classroom Finance 5 เป็น Next.js App Router project ที่ใช้ Supabase เป็นฐานข้อมูลหลัก และใช้ LINE Messaging API สำหรับ workflow ฝั่งนักเรียน นักเรียนสามารถลงทะเบียน LINE, ดูยอดค้าง, เลือกรายการชำระเงิน, ส่งสลิป และรับผลอนุมัติผ่าน LINE ได้

ฝั่งเหรัญญิกใช้งานผ่านเว็บสำหรับดู dashboard, จัดการข้อมูล, ส่งแจ้งเตือน, และตรวจสลิปที่ระบบยังไม่มั่นใจ

## ฟีเจอร์หลัก

- Dashboard สรุปรายรับ รายจ่าย ยอดคงเหลือ และยอดตามวิธีชำระ
- Transactions สำหรับรายรับ รายจ่าย และโอนย้ายเงิน
- Schedules สำหรับกำหนดการเก็บเงิน พร้อมโฟลเดอร์และปฏิทิน
- Students สำหรับจัดการนักเรียน รูปโปรไฟล์ และ LINE User ID
- Categories และ Pockets สำหรับจัดกลุ่มธุรกรรมและแยกกระเป๋าเงิน
- LINE rich menu สำหรับนักเรียน
- LINE webhook สำหรับลงทะเบียน ดูสถานะ จ่ายเงิน ส่งสลิป และยกเลิก
- ตรวจสลิปด้วย QR, SHA-256 image hash, transaction id, และ OCR
- Web review สำหรับสลิปที่ระบบมองว่าน่าสงสัย
- Supabase Storage สำหรับเก็บรูปสลิปแบบ private bucket

## Tech Stack

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS v4
- Zustand
- Supabase Postgres และ Supabase Storage
- Vercel Blob
- LINE Messaging API
- `sharp`, `jsqr`, `tesseract.js`
- Recharts, Framer Motion, React Hook Form, Zod

## โครงสร้างสำคัญ

```txt
src/app/                         App Router pages และ API routes
src/app/api/line/webhook/route.ts LINE webhook หลัก
src/app/api/uploads/slips/route.ts proxy เปิดดูสลิปจาก Supabase Storage
src/components/                  UI components
src/lib/server/                  server-only LINE/slip/payment helpers
src/lib/supabase/                Supabase API wrappers และ mappers
src/types/                       UI types และ Supabase types
supabase/migrations/             SQL migrations
scripts/check-slip.js            local slip checker สำหรับทดสอบรูปสลิป
docs/                            เอกสารเสริม
```

## การติดตั้ง

ติดตั้ง dependency:

```bash
npm install
```

สร้างไฟล์ env:

```bash
cp .env.example .env.local
```

ตั้งค่า `.env.local`:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

LINE_CHANNEL_ACCESS_TOKEN=your-line-channel-access-token
LINE_CHANNEL_SECRET=your-line-channel-secret

SUPABASE_SLIP_BUCKET=payment-slips
SLIP_RECEIVER_ACCOUNT_NAME=your-receiver-account-name
SLIP_RECEIVER_ACCOUNT_NUMBER=your-receiver-account-number
SLIP_RECEIVER_ACCOUNT_NUMBERS=optional,comma,separated,receiver,account,numbers
TRUEMONEY_RECEIVER_ACCOUNT_NUMBER=optional-truemoney-receiver-number

BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
```

รัน development server:

```bash
npm run dev
```

เปิดเว็บ:

```txt
http://localhost:3000
```

## คำสั่งที่ใช้บ่อย

```bash
npm run dev
npm run build
npm start
npm run lint
```

ทดสอบสลิปจากไฟล์รูปในเครื่อง:

```bash
node scripts/check-slip.js ./path/to/slip.jpg 80
```

หรือส่งค่าผู้รับเอง:

```bash
node scripts/check-slip.js ./path/to/slip.jpg 80 "xxx-x-x4106-x" "ด.ช. ต้นธาร ปัญโญศักดิ์"
```

## Supabase Migration

รัน SQL ใน `supabase/migrations` ตามลำดับเลข:

```txt
001_initial_schema.sql
002_change_bank_to_kplus.sql
003_create_categories_table.sql
004_add_pockets_columns.sql
005_add_schedule_folders.sql
006_add_projects_table.sql
007_add_student_line_user_id.sql
008_add_line_payment_requests.sql
009_add_slip_review_fields.sql
010_add_slip_transaction_id.sql
011_add_line_payment_slip_archives.sql
```

ตารางสำคัญสำหรับ LINE payment:

- `line_payment_requests` เก็บรายการที่กำลังเลือก จ่าย รอสลิป หรือรอตรวจ
- `line_payment_slip_archives` เก็บ metadata ของสลิปที่อนุมัติแล้ว เพื่อกันสลิปซ้ำหลังลบ request
- `transactions` เก็บธุรกรรมเงินจริงหลังอนุมัติ
- Supabase Storage bucket `payment-slips` หรือค่าจาก `SUPABASE_SLIP_BUCKET`

## LINE Setup

ตั้ง webhook URL ใน LINE Developers เป็น:

```txt
https://your-domain.com/api/line/webhook
```

ต้องตั้งค่า:

```env
LINE_CHANNEL_ACCESS_TOKEN=...
LINE_CHANNEL_SECRET=...
```

การลงทะเบียนนักเรียน:

```txt
ลงทะเบียน 24
```

หรือส่งเลขที่นักเรียนตรง ๆ:

```txt
24
```

ระบบจะอ่าน `source.userId` จาก LINE webhook และบันทึกลง `students.line_user_id`

## LINE Payment Flow

ลำดับการชำระเงินผ่าน LINE:

1. นักเรียนกดเมนู `ชำระเงิน`
2. บอทตรวจว่านักเรียนลงทะเบียนแล้วหรือยัง
3. บอทแสดงรายการค้างชำระด้วย Flex message ปุ่มใหญ่
4. นักเรียนเลือกรายการและจำนวนเงิน
5. นักเรียนเลือกช่องทาง:
   - K PLUS / โอนธนาคาร
   - TrueMoney
   - เงินสด
6. ถ้าเลือกเงินสด ระบบตั้ง `cash_pending` และให้ไปจ่ายเหรัญญิก
7. ถ้าเลือกโอนหรือ TrueMoney ระบบตั้ง `awaiting_slip`
8. นักเรียนส่งรูปสลิปในแชท
9. ระบบตรวจสลิป
10. ถ้าผ่านทุกเงื่อนไข ระบบ auto approve
11. ถ้าน่าสงสัย ระบบส่งเข้า web review

## การตรวจสลิป

ระบบตรวจจากหลายแหล่ง:

- QR payload จากรูปสลิปด้วย `sharp` และ `jsqr`
- OCR visible text ด้วย `tesseract.js`
- SHA-256 image hash จากไฟล์รูป
- เลขธุรกรรมหรือเลขอ้างอิง
- ชื่อบัญชีผู้รับ
- เลขบัญชีผู้รับ ทั้งแบบเต็มและแบบ masked เช่น `XXX-X-X4106-x`, `09*-***-5433`

สลิปจะถือว่าดีพอสำหรับ auto approve เมื่อ:

```txt
QR อ่านได้
ยอดเงินตรง
ชื่อผู้รับตรง
บัญชีปลายทางตรง
มีเลขธุรกรรม
เลขธุรกรรมไม่เคยใช้มาก่อน
รูปไม่ซ้ำ
QR payload ไม่ซ้ำ
```

ถ้า QR ไม่มี amount ระบบจะใช้ OCR อ่านยอดที่มองเห็นบนสลิปแทน เช่น `80.00 บาท` หรือ `B 80.00`

ถ้าข้อมูลไม่ครบหรือไม่ตรง ระบบจะไม่อนุมัติเอง และจะส่งให้เหรัญญิกตรวจในเว็บ

## Database Lifecycle

ตอนเริ่มจ่าย:

```txt
สร้าง row ใน line_payment_requests
status = selecting
```

หลังเลือกช่องทางและรอสลิป:

```txt
status = awaiting_slip
```

หลังส่งสลิปแต่ยังต้องตรวจ:

```txt
status = pending_slip_review
slip_status = pending_slip_review | duplicate_suspected | wrong_amount
```

เมื่อ auto approve หรือเหรัญญิกอนุมัติ:

```txt
สร้าง row ใน transactions
archive metadata ไป line_payment_slip_archives
ลบ row จาก line_payment_requests
```

เมื่อเหรัญญิกปฏิเสธ:

```txt
ส่ง LINE แจ้งนักเรียน
ลบรูปสลิปจาก Supabase Storage
ลบ row จาก line_payment_requests
```

เมื่อนักเรียนกดยกเลิกก่อนส่งตรวจ:

```txt
ลบ row จาก line_payment_requests
```

สถานะที่ยกเลิกแล้วลบได้:

```txt
selecting
awaiting_slip
cash_pending
```

สถานะที่นักเรียนยกเลิกเองไม่ได้:

```txt
pending_slip_review
```

## การเก็บรูปสลิป

รูปสลิปที่อนุมัติแล้วจะถูกเก็บใน Supabase Storage และอ้างอิงจาก `line_payment_slip_archives`

ระบบเก็บรูปสลิปที่อนุมัติแล้วสูงสุด 6 รูปต่อ LINE user:

- รูปเก่ากว่า 6 รายการจะถูกลบจาก Storage
- `slip_url` และ `slip_pathname` ใน archive จะถูกล้าง
- metadata สำหรับกันสลิปซ้ำยังอยู่ เช่น `slip_qr_payload`, `slip_image_hash`, `slip_transaction_id`

## การอนุมัติและแจ้งเตือน

- Auto approve ใช้ LINE Reply API ตอบกลับทันทีใน webhook event
- Web approve/reject ใช้ LINE Push API แจ้งนักเรียน
- การอนุมัติสุดท้ายที่ไม่มั่นใจต้องทำผ่านเว็บ
- ไม่มีการใช้ service role key บน frontend

## หมายเหตุด้านความถูกต้อง

- QR, OCR, hash และเลขธุรกรรมเป็น helper check ไม่ใช่หลักฐานสมบูรณ์ 100%
- ถ้าระบบอ่านข้อมูลไม่ครบ ควรส่งเข้า web review
- TrueMoney และธนาคารบางแห่งแสดงเลขบัญชีแบบ masked จึงเป็น partial match
- ต้องตั้งค่า receiver account/name ใน env ให้ตรงกับบัญชีรับเงินจริง

## Deployment

โปรเจกต์เหมาะกับ Vercel

ต้องตั้ง environment variables บน Vercel ให้ครบ:

```txt
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
LINE_CHANNEL_ACCESS_TOKEN
LINE_CHANNEL_SECRET
SUPABASE_SLIP_BUCKET
SLIP_RECEIVER_ACCOUNT_NAME
SLIP_RECEIVER_ACCOUNT_NUMBER
SLIP_RECEIVER_ACCOUNT_NUMBERS
TRUEMONEY_RECEIVER_ACCOUNT_NUMBER
BLOB_READ_WRITE_TOKEN
```

หลัง deploy:

1. ตั้ง LINE webhook URL เป็น production domain
2. เปิด webhook ใน LINE Developers
3. รัน rich menu setup route ถ้าต้องการสร้าง rich menu ใหม่
4. ทดสอบลงทะเบียนนักเรียนผ่าน LINE
5. ทดสอบ flow ชำระเงินและส่งสลิป

## Troubleshooting

ถ้า LINE ไม่ตอบ:

- ตรวจ `LINE_CHANNEL_SECRET`
- ตรวจ webhook URL
- ตรวจว่า LINE webhook เปิดใช้งาน
- ตรวจ Vercel logs ของ `/api/line/webhook`

ถ้าสลิปไม่ผ่าน auto approve:

- รัน `node scripts/check-slip.js ./path/to/slip.jpg <amount>`
- ตรวจ `SLIP_RECEIVER_ACCOUNT_NAME`
- ตรวจ `SLIP_RECEIVER_ACCOUNT_NUMBER`
- ตรวจ `TRUEMONEY_RECEIVER_ACCOUNT_NUMBER`
- ดู `ocrText`, `amountMatches`, `receiverAccountMatches`, `receiverNameMatches`

ถ้าดูรูปสลิปไม่ได้:

- ตรวจ bucket `SUPABASE_SLIP_BUCKET`
- ตรวจว่า migration `009_add_slip_review_fields.sql` สร้าง bucket แล้ว
- ตรวจว่า server มี `SUPABASE_SERVICE_ROLE_KEY`

## License

ใช้ภายในงานห้องเรียนหรือโปรเจกต์ภายในองค์กร
