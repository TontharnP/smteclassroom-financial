# คู่มือตั้งค่าระบบเวอร์ชันส่งต่อรุ่นน้อง

เอกสารนี้ใช้สำหรับเหรัญญิกรุ่นถัดไปที่ต้องดูแลเว็บ Classroom Finance ต่อ โดยโฟกัสให้แก้ค่าหลักจากหน้าเว็บได้เอง ไม่ต้องแก้โค้ดบ่อย

## สิ่งที่ต้องรู้ก่อน

- หน้าเว็บตั้งค่าอยู่ที่ `/settings`
- ค่าที่บันทึกจะอยู่ในตาราง Supabase ชื่อ `app_settings`
- ค่าใหม่มีผลกับ request ถัดไป โดยปกติไม่ต้อง restart server
- เวอร์ชันนี้ตั้งค่า LINE, EasySlip, QR, receiver, slip checker และข้อความ LINE จากหน้าเว็บได้
- `SUPABASE_URL` และ `SUPABASE_SERVICE_ROLE_KEY` ยังต้องมีใน Vercel หรือ `.env.local` อย่างน้อยตอนเริ่มระบบ เพราะเว็บต้องใช้สองค่านี้เพื่อเชื่อม Supabase แล้วค่อยอ่าน settings จากฐานข้อมูล

## ไฟล์ที่เกี่ยวข้อง

- หน้าเว็บ: `src/app/settings/page.tsx`
- Component ตั้งค่า: `src/components/settings/SettingsPanel.tsx`
- API settings: `src/app/api/settings/route.ts`
- Runtime settings: `src/lib/server/appSettings.ts`
- Schema/default: `src/lib/settings/schema.ts`
- Migration: `supabase/migrations/012_add_app_settings.sql`
- LINE webhook: `src/app/api/line/webhook/route.ts`
- LINE rich menu setup: `src/app/api/line/rich-menu/setup/route.ts`
- Slip checker: `src/lib/server/slipCheck.ts`
- EasySlip client: `src/lib/server/easySlip.ts`

## การติดตั้งครั้งแรก

### 1. ติดตั้ง dependency

```bash
npm install
```

### 2. ตั้งค่า env ขั้นต่ำ

ใน local ให้ใส่ใน `.env.local` และใน production ให้ใส่ใน Vercel Environment Variables

```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

สองค่านี้ยังจำเป็นเสมอสำหรับ bootstrap ฐานข้อมูล ส่วนค่าอื่นสามารถกรอกจากหน้า `/settings` ได้

### 3. Apply Supabase migration

เปิด Supabase SQL Editor แล้วรันไฟล์นี้

```txt
supabase/migrations/012_add_app_settings.sql
```

Migration จะสร้างตาราง `app_settings` และ row หลัก

```txt
key = public_config
```

### 4. เปิดเว็บ

Local development

```bash
npm run dev
```

Production ให้ redeploy บน Vercel หลัง apply migration

## วิธีเข้า Settings

เปิดหน้า

```txt
/settings
```

ตัวอย่าง production

```txt
https://your-domain.com/settings
```

เมนูด้านล่างบนมือถือและเมนูด้านข้างบน desktop จะมีหน้า **ตั้งค่า**

## หมวด Setup Wizard

ใช้กรอกค่าจำเป็นสำหรับเริ่มส่งต่อรุ่นน้อง

| ช่อง | ใช้ทำอะไร |
|---|---|
| Supabase URL | แสดง/เก็บค่า Supabase URL |
| Supabase Service Role Key | แสดง/เก็บค่า service role key |
| LINE Channel Access Token | ใช้ส่งข้อความ, reply, push และจัดการ rich menu |
| LINE Channel Secret | ใช้ตรวจ signature ของ LINE webhook |
| EasySlip API Key | ใช้เรียก EasySlip verify bank/truewallet |
| PromptPay ID | ใช้สร้าง QR โอนธนาคาร |

หมายเหตุ: ถึงจะกรอก Supabase ในหน้าเว็บแล้ว env bootstrap ของ Supabase ยังต้องมีอยู่ เพราะถ้าไม่มี env เว็บจะเข้า DB เพื่ออ่านค่านี้ไม่ได้

## หมวด Secrets/API

ใช้กรอกค่าลับและ API key ที่ระบบใช้ตอน runtime

| ช่อง | Env เดิมที่เทียบกัน |
|---|---|
| Supabase URL | `SUPABASE_URL` |
| Supabase Service Role Key | `SUPABASE_SERVICE_ROLE_KEY` |
| LINE Channel Access Token | `LINE_CHANNEL_ACCESS_TOKEN` |
| LINE Channel Secret | `LINE_CHANNEL_SECRET` |
| EasySlip API Key | `EASYSLIP_API_KEY` |
| Vercel Blob Read/Write Token | `BLOB_READ_WRITE_TOKEN` |

ระบบอ่านค่าจากหน้า settings ก่อน ถ้าช่องนั้นว่างจะ fallback ไปใช้ env เดิม

## หมวดรับเงินและ QR

ใช้ตั้งค่าบัญชีรับเงินและ QR

| ช่อง | ใช้ทำอะไร |
|---|---|
| PromptPay ID | สร้าง QR ธนาคารด้วย `promptpay-qr` |
| ชื่อบัญชีรับโอนธนาคาร | ใช้ตรวจชื่อปลายทางจากสลิปธนาคาร |
| เลขบัญชีรับโอนธนาคาร | ใช้ตรวจเลขบัญชีปลายทาง |
| PromptPay/เลขพร้อมเพย์เพิ่มเติม | ใช้เป็นเลขปลายทางเพิ่มเติมสำหรับตรวจสลิป |
| ชื่อบัญชี TrueMoney | ใช้ตรวจชื่อปลายทาง TrueMoney |
| เบอร์ TrueMoney | ใช้ตรวจเบอร์/บัญชีปลายทาง TrueMoney |
| TrueMoney QR Template Prefix | prefix payload สำหรับสร้าง TrueMoney lock amount QR |
| TrueMoney QR Template Suffix | suffix payload ก่อนคำนวณ CRC |
| QR Image URL Template | URL สำหรับสร้างรูป QR ต้องมี `{{payload}}` |

ตัวอย่าง QR Image URL Template

```txt
https://quickchart.io/qr?size=600&margin=2&text={{payload}}
```

## หมวด Slip checker

ใช้ตั้งค่าการตรวจสลิปอัตโนมัติ

| ช่อง | ความหมาย |
|---|---|
| EasySlip API Key | key สำหรับเรียก EasySlip |
| Supabase Slip Bucket | bucket ที่ใช้เก็บรูปสลิป |
| OCR Lang | ภาษา OCR เช่น `eng+tha` |
| OCR Max Variants | จำนวน variant รูปที่ OCR จะลองอ่าน |
| EasySlip check duplicate | ส่ง `checkDuplicate=true` ให้ EasySlip |
| EasySlip match account | ส่ง account expected ให้ EasySlip ถ้ามี |
| Always run local OCR | ให้ OCR ในแอปทำงานแม้ EasySlip ใช้ได้ |
| Auto reject invalid image | reject ทันทีถ้ารูปไม่ใช่สลิป |
| TrueMoney auto reject receiver mismatch | reject TrueMoney ถ้าปลายทางไม่ตรง |

กลไกตรวจสลิปตอนนี้คือ

1. นักเรียนเลือกรายการและวิธีจ่ายใน LINE
2. นักเรียนส่งรูปสลิปกลับมา
3. ระบบบันทึกรูปสลิป
4. ระบบเรียก EasySlip ก่อน โดยเลือก endpoint จากชนิดสลิป
5. ถ้าเป็น TrueMoney จะใช้ EasySlip truewallet verify
6. ถ้า EasySlip ใช้ไม่ได้หรืออ่านไม่ครบ ระบบ fallback ไป OCR ในแอป
7. ระบบเทียบยอดเงิน, บัญชีปลายทาง, ชื่อปลายทาง และ duplicate
8. ระบบส่งเข้า manual review เพื่อให้เหรัญญิกตรวจสอบและอนุมัติด้วยตนเอง (Manual Treasurer Approval) เสมอ เพื่อความปลอดภัยและความถูกต้องสูงสุดทางการเงินของห้องเรียน
9. ถ้ารูปไม่ใช่สลิปหรือเงื่อนไข reject เปิดไว้ ระบบจะ auto reject ทันที

## หมวด LINE Rich Menu

ใช้เปลี่ยนชื่อ rich menu และข้อความที่ปุ่มส่งเข้า webhook

| ช่อง | ใช้ทำอะไร |
|---|---|
| Register Rich Menu Name | ชื่อ rich menu สำหรับคนยังไม่ลงทะเบียน |
| Student Rich Menu Name | ชื่อ rich menu สำหรับนักเรียนที่ลงทะเบียนแล้ว |
| Chat Bar Text | ข้อความแถบเมนู LINE |
| Register action | label ปุ่มและ text ที่ส่งเพื่อเริ่มลงทะเบียน |
| Pay action | label ปุ่มและ text ที่ส่งเพื่อเปิดเมนูชำระเงิน |
| Status action | label ปุ่มและ text ที่ส่งเพื่อดูสถานะ |
| History action | label ปุ่มและ text ที่ส่งเพื่อดูประวัติ |
| Total action | label ปุ่มและ text ที่ส่งเพื่อดูยอดรวมห้อง |

หลังแก้ Rich Menu ให้รัน endpoint ตั้งค่า rich menu ใหม่

```bash
curl -X POST https://your-domain.com/api/line/rich-menu/setup
```

ถ้าใช้ local ให้เปลี่ยน domain เป็น `http://localhost:3000`

## หมวดข้อความ LINE

ใช้แก้ template ข้อความที่บอทส่งให้นักเรียน

ข้อความที่แก้ได้ เช่น

- ลงทะเบียนไว้แล้ว
- คำแนะนำลงทะเบียน
- ไม่พบนักเรียน
- ลงทะเบียนสำเร็จ
- ต้องลงทะเบียนก่อน
- ไม่พบรายการชำระ
- วิธีชำระไม่ถูกต้อง
- คำแนะนำหลังสแกน QR
- สลิปผ่านอัตโนมัติ
- สลิปถูกปฏิเสธอัตโนมัติ
- สงสัยสลิปซ้ำ
- รับสลิปแล้วรอตรวจ
- เหรัญญิกอนุมัติสลิป
- เหรัญญิกปฏิเสธสลิป
- ข้อความท้ายประกาศกำหนดการ
- ข้อความท้ายแจ้งเตือนชำระ

ตัวแปรที่ใช้ได้

| ตัวแปร | ความหมาย |
|---|---|
| `{{studentName}}` | ชื่อนักเรียน |
| `{{studentNumber}}` | เลขที่นักเรียน |
| `{{menuStatus}}` | สถานะการเปลี่ยน rich menu |
| `{{reason}}` | เหตุผล reject |

ตัวอย่าง

```txt
ลงทะเบียนสำเร็จแล้วครับ
ชื่อ: {{studentName}}
เลขที่: {{studentNumber}}
{{menuStatus}}
```

ถ้าใส่ตัวแปรที่ระบบไม่ได้ส่งค่าให้ ตัวแปรนั้นจะกลายเป็นช่องว่าง

## วิธี Import และ Export Settings

### Export

1. เข้า `/settings`
2. กด `Export`
3. ระบบจะดาวน์โหลดไฟล์ `classroom-finance-settings.json`

ใช้ไฟล์นี้เก็บ backup หรือส่งต่อให้รุ่นน้องได้

### Import

1. เข้า `/settings`
2. กด `Import`
3. เลือกไฟล์ JSON ที่ export ไว้
4. ตรวจค่าบนหน้าจอ
5. กด `บันทึก`

## วิธีทดสอบหลังตั้งค่า

### 1. ทดสอบ Settings API

```bash
curl http://localhost:3000/api/settings
```

ควรได้ JSON settings กลับมา และควรเห็นค่า runtime ที่ระบบใช้อยู่

### 2. ทดสอบ LINE webhook

1. ตั้ง Webhook URL ใน LINE Developers เป็น `/api/line/webhook`
2. ส่งคำว่า `ลงทะเบียน` จาก LINE account ทดสอบ
3. ตรวจว่าบอทตอบตาม template ใน settings
4. ลงทะเบียนด้วยเลขที่นักเรียนจริง

### 3. ทดสอบ Rich Menu

1. แก้ action text ใน `/settings`
2. กดบันทึก
3. รัน `/api/line/rich-menu/setup`
4. เปิด LINE แล้วกดปุ่ม rich menu
5. ตรวจว่า webhook ทำงานตาม action ใหม่

### 4. ทดสอบ QR ธนาคาร

1. สร้าง schedule ยอดเล็ก เช่น 1 บาท
2. ใน LINE กดชำระเงิน
3. เลือกโอนธนาคาร
4. ตรวจว่า QR สร้างจาก PromptPay ID ที่ตั้งไว้
5. โอนจริงหรือใช้สลิปทดสอบ
6. ส่งสลิปกลับเข้า LINE

### 5. ทดสอบ TrueMoney lock amount QR

1. ตั้ง TrueMoney template prefix/suffix และเบอร์รับเงิน
2. ใน LINE เลือก TrueMoney
3. ตรวจว่า QR แสดงยอด lock amount
4. ส่งสลิป TrueMoney ทดสอบ
5. ตรวจผล EasySlip และผล fallback OCR

### 6. ทดสอบ EasySlip

ถ้ามี API key ให้ทดสอบด้วยสลิปจริงยอดเล็ก

ผลที่ควรเห็นในระบบคือ

- ถ้ายอดเงินและปลายทางตรง: auto approve
- ถ้าข้อมูลไม่ครบ: pending manual review
- ถ้ารูปไม่ใช่สลิปและเปิด auto reject: auto reject
- ถ้า EasySlip ใช้ไม่ได้: ระบบบอกเหตุผลและ fallback OCR

## Troubleshooting

### เปิดเว็บแล้ว settings error

ตรวจว่า

1. ใส่ `SUPABASE_URL` แล้ว
2. ใส่ `SUPABASE_SERVICE_ROLE_KEY` แล้ว
3. Apply `supabase/migrations/012_add_app_settings.sql` แล้ว
4. Redeploy หรือ restart dev server แล้ว

### LINE ไม่ตอบ

ตรวจว่า

1. `LINE_CHANNEL_SECRET` ตรงกับ channel
2. `LINE_CHANNEL_ACCESS_TOKEN` ยังไม่หมดอายุ
3. Webhook URL เป็น domain ล่าสุด
4. LINE Developers เปิด Use webhook แล้ว
5. Production redeploy หลังแก้โค้ดแล้ว

### Rich Menu กดแล้วไม่ทำงาน

ตรวจว่า

1. แก้ action text แล้วกดบันทึก
2. รัน `/api/line/rich-menu/setup` ใหม่แล้ว
3. LINE account นั้นถูก link ไปยัง rich menu ใหม่
4. Text ที่ปุ่มส่งตรงกับค่า action ใน `/settings`

### EasySlip ขึ้น INVALID_SENDER_NAME

กรณีนี้แปลว่า EasySlip อ่านชื่อผู้โอนจากรูปไม่ได้ ระบบจะ fallback ไป OCR ในแอป ถ้า OCR ยังยืนยันยอด/บัญชีไม่ได้ รายการจะเข้า manual review หรือถูก reject ตาม flag ที่ตั้งไว้

สิ่งที่ควรตรวจ

1. รูปสลิปชัดพอหรือไม่
2. สลิปเป็น bank หรือ TrueMoney ตรงกับวิธีชำระที่เลือกหรือไม่
3. ตั้งชื่อบัญชีปลายทางถูกหรือไม่
4. ตั้งเลขบัญชีหรือเบอร์ TrueMoney ถูกหรือไม่
5. เปิด `Always run local OCR` ถ้าต้องการให้ระบบอ่าน OCR ช่วยเสมอ

### เปลี่ยน PromptPay แล้ว QR ยังไม่เปลี่ยน

ตรวจว่า

1. เปลี่ยนค่าใน `/settings`
2. กดบันทึกแล้ว
3. สร้าง payment request ใหม่ ไม่ใช้ QR เก่าที่ส่งไปแล้ว
4. ถ้าใช้ browser cache ให้ refresh หน้าเว็บ

### Blob upload ไม่ได้

ตรวจ `Vercel Blob Read/Write Token` ใน `/settings` หรือ env `BLOB_READ_WRITE_TOKEN`

## Checklist ส่งต่อรุ่นน้อง

1. Apply migration ครบถึง `012_add_app_settings.sql`
2. ตั้ง `SUPABASE_URL` และ `SUPABASE_SERVICE_ROLE_KEY` ใน Vercel
3. เข้า `/settings`
4. กรอก LINE Channel Access Token
5. กรอก LINE Channel Secret
6. กรอก EasySlip API Key
7. กรอก Blob token ถ้าใช้ Vercel Blob
8. ตั้ง PromptPay ID
9. ตั้งข้อมูลบัญชีธนาคารปลายทาง
10. ตั้งข้อมูล TrueMoney ปลายทาง
11. ตั้งค่า slip checker flags
12. ปรับข้อความ LINE ให้เข้ากับรุ่นตัวเอง
13. รัน `/api/line/rich-menu/setup`
14. ทดสอบลงทะเบียน LINE
15. ทดสอบ bank QR และ bank slip
16. ทดสอบ TrueMoney QR และ TrueMoney slip
17. ทดสอบ approve/reject จากหน้าเว็บ
18. Export settings เก็บไว้เป็น backup

## สิ่งที่ไม่ควรลืม

- Supabase bootstrap env ยังจำเป็นเสมอ
- ถ้าเปลี่ยน LINE channel ต้องเปลี่ยนทั้ง token, secret, webhook URL และ rich menu
- ถ้าเปลี่ยนบัญชีรับเงินจริง ต้องเปลี่ยน PromptPay/TrueMoney/receiver ใน settings ให้ครบ
- หลังแก้ Rich Menu ต้องรัน setup ใหม่
- หลัง import settings ต้องกดบันทึกก่อนค่าใหม่จึงใช้งาน
