# Classroom Finance 5

Classroom Finance 5 คือระบบจัดการการเงินห้องเรียนที่รวมเว็บแอปสำหรับเหรัญญิกและ LINE bot สำหรับนักเรียนไว้ในโปรเจกต์เดียว ระบบนี้ดูแลตั้งแต่รายรับรายจ่าย กำหนดการเก็บเงิน รายชื่อนักเรียน กระเป๋าเงิน หมวดหมู่ธุรกรรม การแจ้งเตือนผ่าน LINE ไปจนถึง workflow การชำระเงินด้วยสลิป

โปรเจกต์นี้เป็น Next.js App Router application ที่ใช้ Supabase เป็นฐานข้อมูลหลัก ใช้ Supabase Storage สำหรับสลิป ใช้ Vercel Blob สำหรับรูปอัปโหลดทั่วไป และใช้ LINE Messaging API สำหรับประสบการณ์ฝั่งนักเรียน

## Table of Contents

- [Product Overview](#product-overview)
- [Current Capabilities](#current-capabilities)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Environment Variables](#environment-variables)
- [Local Development](#local-development)
- [Supabase Setup](#supabase-setup)
- [LINE Setup](#line-setup)
- [LINE Student Workflow](#line-student-workflow)
- [Payment Request Lifecycle](#payment-request-lifecycle)
- [Slip Checking Design](#slip-checking-design)
- [Database Integration](#database-integration)
- [Storage Rules](#storage-rules)
- [Local Slip Debugging](#local-slip-debugging)
- [API Routes](#api-routes)
- [Operational Commands](#operational-commands)
- [Deployment Notes](#deployment-notes)
- [Troubleshooting](#troubleshooting)
- [Known Engineering Notes](#known-engineering-notes)

## Product Overview

ระบบแบ่งผู้ใช้งานหลักเป็น 2 ฝั่ง:

- เหรัญญิกหรือผู้ดูแล ใช้งานผ่านเว็บ dashboard เพื่อจัดการข้อมูลทั้งหมด
- นักเรียน ใช้งานผ่าน LINE Official Account เพื่อดูยอดค้าง ชำระเงิน ส่งสลิป และรับผลตรวจ

ข้อมูลเงินจริงจะถูกบันทึกใน `transactions` เท่านั้นเมื่อชำระสำเร็จแล้ว ส่วนรายการที่อยู่ระหว่างเลือก จ่าย หรือรอตรวจจะอยู่ใน `line_payment_requests` เพื่อไม่ให้ยอดเงินหลักผิดพลาด

## Current Capabilities

### Dashboard

- แสดงยอดคงเหลือรวม
- สรุปรายรับ รายจ่าย และยอดเก็บตามกำหนดการ
- แยกยอดตามวิธีชำระ เช่น K PLUS, TrueMoney, เงินสด
- แสดงกราฟและภาพรวมการเงินห้องเรียน
- เชื่อมไปยังหน้ากำหนดการเพื่อดูนักเรียนที่ชำระแล้วหรือยังค้าง

### Transactions

- เพิ่ม แก้ไข ลบรายการเงิน
- รองรับ `income`, `expense`, `transfer`
- แยกธุรกรรมปกติกับธุรกรรมที่มาจาก schedule
- ใช้ `schedule_id` และ `student_id` เพื่อผูกยอดชำระกับรายการเก็บเงิน
- ใช้ `pocket_id` เพื่อแยกกระเป๋าเงินตามวิธีรับเงิน

### Schedules

- สร้างกำหนดการเก็บเงินพร้อมยอดต่อคน
- เลือกนักเรียนที่ต้องชำระในแต่ละกำหนดการ
- จัดโฟลเดอร์กำหนดการ
- ดูสถานะจ่ายแล้วและค้างชำระ
- ส่งแจ้งเตือน LINE ไปยังนักเรียนที่ยังค้าง
- เปิดรายละเอียดกำหนดการเพื่ออนุมัติหรือปฏิเสธ LINE payment requests

### Students

- จัดการข้อมูลนักเรียนและเลขที่
- เก็บ `line_user_id` หลังนักเรียนลงทะเบียนผ่าน LINE
- ดูสถานะหนี้ของนักเรียนแต่ละคน
- อัปโหลดรูปโปรไฟล์ผ่าน Vercel Blob

### Categories and Pockets

- ใช้ categories เพื่อจัดกลุ่มธุรกรรม
- ใช้ pockets เพื่อแยกเงินตามช่องทางหรือกระเป๋า
- รองรับ pocket-related columns ใน migration `004_add_pockets_columns.sql`

### LINE Bot

- รับ webhook ที่ `/api/line/webhook`
- ลงทะเบียนนักเรียนจากข้อความ LINE
- แสดงเมนูสถานะและประวัติ
- แสดงรายการค้างชำระด้วย Flex message ปุ่มใหญ่
- สร้าง payment request
- รับรูปสลิปจาก LINE Content API
- อัปโหลดสลิปเข้า Supabase Storage
- ตรวจสลิปเบื้องต้น
- Auto approve เฉพาะกรณีที่ข้อมูลครบตามเงื่อนไขของ production checker
- ส่งรายการที่น่าสงสัยเข้า web review

## Tech Stack

| Area | Technology |
| --- | --- |
| Framework | Next.js 16 App Router |
| UI | React 19, Tailwind CSS v4 |
| Language | TypeScript |
| State | Zustand |
| Forms | React Hook Form, Zod |
| Charts | Recharts |
| Animation | Framer Motion |
| Database | Supabase Postgres |
| Server DB client | `@supabase/supabase-js` with service role in server routes only |
| Slip storage | Supabase Storage |
| General uploads | Vercel Blob |
| LINE | LINE Messaging API |
| QR | `promptpay-qr`, `qrcode.react`, `jsqr` |
| Image processing | `sharp` |
| Local OCR debug | `tesseract.js`, `@tesseract.js-data/eng`, `@tesseract.js-data/tha` |

## Project Structure

```txt
src/
  app/
    api/
      line/
        webhook/route.ts                  LINE webhook หลัก
        rich-menu/setup/route.ts           ตั้งค่า LINE rich menu
        payment-requests/route.ts          list pending payment requests
        payment-requests/[id]/route.ts     reject/update request
        payment-requests/[id]/approve/route.ts approve request
      uploads/
        route.ts                           general upload
        slips/route.ts                     proxy download private slip image
      schedules/[id]/reminders/line/route.ts LINE schedule reminders
    dashboard/
    transactions/
    schedule/
    students/
    categories/
    notifications/
  components/
    dashboard/
    transactions/
    schedule/
    students/
    categories/
    notifications/
    layout/
    ui/
  lib/
    server/
      line.ts                              LINE push/rich-menu helpers
      linePaymentReview.ts                 approve/reject LINE payment requests
      lineScheduleMessages.ts              schedule reminder push messages
      slipCheck.ts                         production QR/hash slip analyzer
      slipStorage.ts                       Supabase Storage helper for slips
    supabase/
      server.ts                            service-role server client and CRUD helpers
      mappers.ts                           DB row -> typed object mapping
      linePaymentRequests.ts               client wrapper for review UI
    calculations.ts
    store.ts
  types/
    index.ts                               UI-facing camelCase types
    supabase.ts                            DB/API-facing snake_case types
scripts/
  check-slip.js                            standalone local slip checker with OCR
supabase/
  migrations/
```

## Environment Variables

Copy the example file:

```bash
cp .env.example .env.local
```

Required server environment:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

LINE:

```env
LINE_CHANNEL_ACCESS_TOKEN=your-line-channel-access-token
LINE_CHANNEL_SECRET=your-line-channel-secret
```

Slip checking and storage:

```env
SUPABASE_SLIP_BUCKET=payment-slips
SLIP_RECEIVER_ACCOUNT_NAME=your-receiver-account-name
SLIP_RECEIVER_ACCOUNT_NUMBER=your-main-receiver-account
SLIP_RECEIVER_ACCOUNT_NUMBERS=optional,comma,separated,extra,accounts
TRUEMONEY_RECEIVER_ACCOUNT_NUMBER=optional-truemoney-receiver-number
```

General uploads:

```env
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
```

### Receiver Account Variables

`SLIP_RECEIVER_ACCOUNT_NUMBER` is the main receiver account.

`SLIP_RECEIVER_ACCOUNT_NUMBERS` is for extra bank accounts, separated by commas.

`TRUEMONEY_RECEIVER_ACCOUNT_NUMBER` is checked only when the LINE payment method is `truemoney`.

The code also includes the hardcoded PromptPay id in `src/app/api/line/webhook/route.ts` as `PROMPTPAY_ID`, because the generated bank-transfer QR depends on it.

## Local Development

Install dependencies:

```bash
npm install
```

Run the app:

```bash
npm run dev
```

Open:

```txt
http://localhost:3000
```

Run lint:

```bash
npm run lint
```

Build:

```bash
npm run build
```

If Turbopack build behavior is being investigated, a webpack build can be run manually:

```bash
npx next build --webpack
```

## Supabase Setup

Run migrations in numeric order from `supabase/migrations`.

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

Important tables:

| Table | Purpose |
| --- | --- |
| `students` | Student records and `line_user_id` |
| `schedules` | Collection schedules |
| `transactions` | Final money movement records |
| `line_payment_requests` | Temporary LINE payment workflow state |
| `line_payment_slip_archives` | Approved-slip metadata after request deletion |
| `categories` | Transaction categories |
| `schedule_folders` | Schedule grouping |

Important storage:

| Storage | Purpose |
| --- | --- |
| Supabase bucket `payment-slips` | Private slip images |
| Vercel Blob | General user-uploaded images such as profile/category images |

Migration `009_add_slip_review_fields.sql` also creates or updates the `payment-slips` bucket as non-public.

## LINE Setup

Set LINE webhook URL:

```txt
https://your-production-domain.com/api/line/webhook
```

Required LINE settings:

- Webhook enabled
- `LINE_CHANNEL_SECRET` matches the Messaging API channel
- `LINE_CHANNEL_ACCESS_TOKEN` is valid
- Students have added the LINE Official Account

### Rich Menu

Rich menu assets live in:

```txt
public/line/rich-menu-register.png
public/line/rich-menu-registered.png
```

Setup route:

```txt
POST /api/line/rich-menu/setup
```

The setup route uses `LINE_CHANNEL_ACCESS_TOKEN`.

## LINE Student Workflow

### Registration

Student sends:

```txt
ลงทะเบียน 24
```

or:

```txt
24
```

The webhook uses `event.source.userId` and stores it in `students.line_user_id`.

### Pay

Student taps the rich menu pay action or sends a pay command. The bot:

1. Checks registration.
2. Loads unpaid schedules for that student.
3. Sends a LINE Flex message with large tappable buttons.
4. Creates a `line_payment_requests` row with `status = selecting`.
5. Stores chosen amount.
6. Lets student select method.

Supported methods:

```txt
kplus
truemoney
cash
```

### Cash

When student selects cash:

```txt
status = cash_pending
method = cash
```

The request appears in the web review UI so treasurer can approve after receiving cash.

### Bank Transfer or TrueMoney

When student selects transfer or TrueMoney:

```txt
status = awaiting_slip
method = kplus | truemoney
```

The bot sends fixed-amount payment instructions. The student sends an image back into the same LINE chat.

### Cancel

Student cancel deletes active pre-review requests:

```txt
selecting
awaiting_slip
cash_pending
```

Already submitted slip reviews are not cancelled by the student:

```txt
pending_slip_review
```

## Payment Request Lifecycle

`line_payment_requests.status` can include:

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

Current runtime behavior:

| Event | DB behavior |
| --- | --- |
| Start payment | Insert `line_payment_requests`, `status = selecting` |
| Choose transfer/TrueMoney | Update to `awaiting_slip` |
| Choose cash | Update to `cash_pending` |
| Upload slip | Store image and update slip metadata |
| Clean auto-check | Approve, create transaction, archive metadata, delete request |
| Suspicious auto-check | Keep request as `pending_slip_review` |
| Web approve | Create transaction, archive metadata, delete request |
| Web reject | Push rejection, delete slip image, delete request |
| Student cancel before review | Delete request |

## Slip Checking Design

There are two related but different slip-checking paths.

### Production Webhook Checker

Production webhook uses:

```txt
src/lib/server/slipCheck.ts
```

It currently checks:

- SHA-256 image hash
- QR readability through `sharp` + `jsqr`
- QR payload
- amount if QR payload includes EMV tag `54`
- receiver account/name if present in QR payload
- likely slip transaction/reference id from QR payload

It does not currently run OCR inside the webhook helper. If the bank or TrueMoney QR does not include visible amount/account/name data, the production checker may send the slip to web review instead of auto-approving.

### Local Debug Checker

The terminal helper uses:

```txt
scripts/check-slip.js
```

It checks:

- QR payload
- SHA-256 image hash
- OCR text using `tesseract.js`
- top-area OCR for TrueMoney slips where amount appears at the top
- visible amount such as `80.00 บาท` or `B 80.00`
- masked account strings like `XXX-X-X4106-x` and `09*-***-5433`
- receiver name variants where prefixes like `ด.ช.` may be missing

Use this script to debug a real slip image locally:

```bash
node scripts/check-slip.js ./path/to/slip.jpg 80
```

Example with explicit receiver:

```bash
node scripts/check-slip.js ./path/to/slip.jpg 80 "xxx-x-x4106-x" "ด.ช. ต้นธาร ปัญโญศักดิ์"
```

The script prints JSON with:

```json
{
  "extracted": {
    "imageHash": "...",
    "qrReadable": true,
    "qrPayload": "...",
    "ocrText": "...",
    "ocrAmount": 80,
    "detectedAmount": 80,
    "amountSource": "ocr",
    "amountMatches": true,
    "receiverAccountMatches": true,
    "receiverNameMatches": true,
    "slipTransactionId": "..."
  },
  "decision": {
    "looksGood": true,
    "reasons": ["All local checks passed"]
  }
}
```

### Auto Approval Conditions

A slip is eligible for auto approval when the production checker can establish:

```txt
QR readable
amount matches expected amount
receiver account matches configured account
receiver name matches configured receiver name
transaction/reference id exists
QR payload is not duplicated
image hash is not duplicated
transaction/reference id is not duplicated
```

If any required data is missing or suspicious, the request stays pending for web review.

## Database Integration

### `line_payment_requests`

This table stores active LINE payment work. Important columns include:

```txt
id
line_user_id
student_id
schedule_id
method
amount
status
slip_url
slip_pathname
slip_status
slip_qr_payload
slip_image_hash
slip_transaction_id
slip_ocr_text
slip_auto_check_result
transaction_id
note
reviewed_by
reviewed_at
reject_reason
paid_at
created_at
updated_at
```

This table is intentionally temporary for payment requests. Approved and rejected requests are removed after their side effects are completed.

### `transactions`

This is the source of truth for completed money movement.

On approval, the app creates:

```txt
kind = income
source = schedule
amount = line payment amount
method = kplus | truemoney | cash
schedule_id = selected schedule
student_id = paying student
pocket_id = pocket-{method}
description = LINE payment proof URL when available
```

### `line_payment_slip_archives`

Approved payment requests are deleted, so duplicate prevention cannot rely only on `line_payment_requests`. For that reason the app archives approved-slip metadata here.

Archived fields include:

```txt
line_user_id
student_id
schedule_id
transaction_id
method
amount
slip_url
slip_pathname
slip_qr_payload
slip_image_hash
slip_transaction_id
slip_auto_check_result
paid_at
created_at
```

The webhook duplicate check reads from both:

```txt
line_payment_requests
line_payment_slip_archives
```

It checks:

```txt
slip_qr_payload
slip_image_hash
slip_transaction_id
```

### Approval Flow

Approval is handled in:

```txt
src/lib/server/linePaymentReview.ts
```

Flow:

1. Lock request by updating only reviewable statuses.
2. Mark request approved internally.
3. Create transaction.
4. Archive approved slip metadata.
5. Enforce approved slip image retention.
6. Delete `line_payment_requests` row.
7. Notify student when approval came from web review.

Auto approval suppresses duplicate push notification and replies in the original webhook event instead.

### Rejection Flow

Rejection does:

1. Update request to rejected long enough to get a consistent row.
2. Push LINE rejection message to student.
3. Delete rejected slip image from Supabase Storage if it exists.
4. Delete `line_payment_requests` row.

Rejected slip metadata is not archived. This is intentional so a rejected attempt does not block or pollute a later valid payment.

## Storage Rules

### Supabase Storage for Slips

Bucket:

```txt
payment-slips
```

or:

```env
SUPABASE_SLIP_BUCKET=...
```

The bucket is private. The app opens slips through:

```txt
GET /api/uploads/slips?path=<pathname>
```

The API downloads from Supabase Storage using the server-side service role key.

### Approved Slip Retention

The app keeps at most 6 approved slip images per LINE user.

When the user has more than 6 approved archived slips:

- older image files are deleted from Supabase Storage
- `slip_url` and `slip_pathname` are cleared in `line_payment_slip_archives`
- duplicate-check metadata remains

This keeps storage under control while preserving fraud/duplicate detection.

### Rejected Slip Cleanup

Rejected slips are removed from storage and the request row is deleted. Rejected data should not interrupt future payment attempts.

## API Routes

| Route | Purpose |
| --- | --- |
| `GET /api/health` | health check |
| `GET/POST /api/students` | students API |
| `GET/PATCH/DELETE /api/students/[id]` | single student API |
| `GET/POST /api/schedules` | schedules API |
| `GET/PATCH/DELETE /api/schedules/[id]` | single schedule API |
| `GET /api/schedules/[id]/status` | schedule payment status |
| `POST /api/schedules/[id]/reminders/line` | push LINE reminders |
| `GET/POST /api/transactions` | transactions API |
| `GET/PATCH/DELETE /api/transactions/[id]` | single transaction API |
| `GET /api/transactions/balance` | balance summary |
| `GET /api/transactions/income-by-method` | income method summary |
| `GET/POST /api/categories` | categories API |
| `GET/PATCH/DELETE /api/categories/[id]` | category API |
| `POST /api/uploads` | Vercel Blob upload |
| `GET /api/uploads/slips` | private slip image proxy |
| `GET/POST /api/line/webhook` | LINE webhook |
| `POST /api/line/rich-menu/setup` | create/link rich menus |
| `GET /api/line/payment-requests` | list pending review requests |
| `GET/PATCH /api/line/payment-requests/[id]` | read/update/reject request |
| `POST /api/line/payment-requests/[id]/approve` | approve request |

## Operational Commands

Install:

```bash
npm install
```

Development:

```bash
npm run dev
```

Lint:

```bash
npm run lint
```

Production build:

```bash
npm run build
```

Webpack build check:

```bash
npx next build --webpack
```

Slip debug:

```bash
node scripts/check-slip.js ./path/to/slip.jpg 80
```

## Deployment Notes

Recommended platform: Vercel.

Before deployment:

1. Apply all Supabase migrations.
2. Confirm `payment-slips` bucket exists and is private.
3. Set all environment variables on Vercel.
4. Deploy app.
5. Set LINE webhook URL to production domain.
6. Enable LINE webhook.
7. Run rich menu setup if needed.
8. Register a test student through LINE.
9. Test payment flow with one small schedule.
10. Verify web review approval and rejection.

Required production variables:

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

## Troubleshooting

### LINE webhook returns invalid signature

Check:

- `LINE_CHANNEL_SECRET`
- webhook URL points to the correct deployment
- request body is not modified before signature verification

### LINE bot does not reply

Check:

- `LINE_CHANNEL_ACCESS_TOKEN`
- webhook enabled in LINE Developers
- Vercel function logs for `/api/line/webhook`
- student has added the LINE Official Account

### Student cannot pay

Check:

- student has `line_user_id`
- student is included in the target schedule
- schedule still has unpaid remaining amount
- no active request is stuck in `pending_slip_review`

### Slip goes to review instead of auto approve

Check:

- QR is readable
- QR contains enough data for production checker
- expected amount equals selected amount
- `SLIP_RECEIVER_ACCOUNT_NAME` is correct
- `SLIP_RECEIVER_ACCOUNT_NUMBER` or `TRUEMONEY_RECEIVER_ACCOUNT_NUMBER` is correct
- duplicate metadata exists in `line_payment_requests` or `line_payment_slip_archives`

Use:

```bash
node scripts/check-slip.js ./path/to/slip.jpg <amount>
```

The local checker is more diagnostic because it includes OCR output.

### Slip image cannot open in web review

Check:

- `SUPABASE_SLIP_BUCKET`
- Supabase Storage bucket exists
- server has `SUPABASE_SERVICE_ROLE_KEY`
- `slip_pathname` exists in the request row or archive row

### Approval creates duplicate payment

Approval uses a status lock against reviewable statuses:

```txt
pending_slip_review
pending_review
cash_pending
```

If the row is already approved or deleted, a second approval should not create another transaction.

### Rejected slip blocks future payment

It should not. Current rejection cleanup deletes:

- rejected slip image from Supabase Storage
- rejected `line_payment_requests` row

Rejected attempts are not archived.

## Security Notes

- `SUPABASE_SERVICE_ROLE_KEY` must stay server-side only.
- LINE signature verification uses `LINE_CHANNEL_SECRET`.
- Slip files are stored in a private bucket and served through a server route.
- OCR and QR checks are helper checks, not absolute proof of payment.
- Final review should remain available for ambiguous slips.
- Masked account matches are partial evidence only.

## Development Conventions

- UI-facing types in `src/types/index.ts` use camelCase.
- Supabase/API-facing types in `src/types/supabase.ts` use snake_case.
- DB row mapping lives in `src/lib/supabase/mappers.ts`.
- Server-only payment/slip logic lives in `src/lib/server`.
- Migrations are manually applied in numeric order.
- Keep financial side effects in server routes or server helpers.

## Known Engineering Notes

- `scripts/check-slip.js` uses OCR for local debugging.
- `src/lib/server/slipCheck.ts` currently does not OCR in production webhook.
- If OCR auto approval is required in production, port the OCR extraction from `scripts/check-slip.js` into a server-only helper and account for runtime cost on Vercel.
- Some banks and TrueMoney mask account numbers. The local checker can match masked fragments, but this should be treated as weaker than full account verification.
- `expired` remains a valid historical status in the DB constraint, but the current cancel flow deletes active pre-review requests instead of marking them expired.

## License

Internal classroom or organization use.
