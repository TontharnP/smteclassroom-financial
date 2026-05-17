# Classroom Finance 5

Classroom Finance 5 is a classroom finance management system that combines an admin web application for the treasurer with a LINE bot experience for students. It manages income, expenses, collection schedules, students, pockets, transaction categories, LINE reminders, LINE payment sessions, slip uploads, and semi-automatic slip checking.

The application is built with the Next.js App Router. Supabase is the primary database, Supabase Storage stores private payment slips, Vercel Blob stores general uploaded images, and LINE Messaging API powers the student-facing payment workflow.

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
- [API Routes](#api-routes)
- [Operational Commands](#operational-commands)
- [Deployment Notes](#deployment-notes)
- [Troubleshooting](#troubleshooting)
- [Security Notes](#security-notes)
- [Development Conventions](#development-conventions)
- [Known Engineering Notes](#known-engineering-notes)

## Product Overview

The product has two primary user surfaces:

- Treasurer/admin web UI for managing all classroom finance data.
- Student LINE Official Account flow for registration, debt lookup, payment selection, slip submission, and payment result notifications.

Completed money movement is recorded only in `transactions`. Any payment that is still being selected, waiting for a slip, or waiting for review is kept in `line_payment_requests`. This separation prevents pending LINE interactions from corrupting the real financial ledger.

The app is intentionally conservative around payment correctness. QR, image hash, OCR, and transaction-reference checks are treated as helper checks. Ambiguous slips are routed to web review instead of being blindly marked as paid.

## Current Capabilities

### Dashboard

- Shows total balance.
- Summarizes income, expenses, and schedule-derived collections.
- Breaks down income by payment method such as K PLUS, TrueMoney, and cash.
- Provides charts and collection overview cards.
- Links into schedule detail views for paid/unpaid student status.

### Transactions

- Creates, edits, and deletes finance records.
- Supports `income`, `expense`, and `transfer` transaction kinds.
- Separates normal transactions from schedule-sourced payment transactions.
- Uses `schedule_id` and `student_id` to bind a payment to a collection schedule and a student.
- Uses `pocket_id` to associate received money with a payment pocket.

### Schedules

- Creates collection schedules with a per-student amount.
- Tracks which students are included in each schedule.
- Supports schedule folders.
- Shows paid and unpaid student status.
- Sends LINE reminders to students who still owe money.
- Opens schedule detail review panels for approving or rejecting LINE payment requests.

### Students

- Manages student records and classroom numbers.
- Stores `line_user_id` after a student registers through LINE.
- Shows per-student debt status.
- Uploads profile images through Vercel Blob.

### Categories and Pockets

- Categories group transactions.
- Pockets separate money by source or payment method.
- Pocket-related database fields are added through `004_add_pockets_columns.sql`.

### LINE Bot

- Receives webhook events at `/api/line/webhook`.
- Registers students from LINE text messages.
- Shows status and history menus.
- Displays unpaid debts through large LINE Flex message buttons.
- Creates LINE payment requests.
- Downloads slip images from the LINE Content API.
- Uploads slip images to Supabase Storage.
- Performs production slip helper checks.
- Auto-approves only when the production checker has enough evidence.
- Sends suspicious or incomplete slips to web review.

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
        webhook/route.ts                      Main LINE webhook
        rich-menu/setup/route.ts              LINE rich menu setup
        payment-requests/route.ts             List pending payment requests
        payment-requests/[id]/route.ts        Read/update/reject a request
        payment-requests/[id]/approve/route.ts Approve a request
      uploads/
        route.ts                              General upload endpoint
        slips/route.ts                        Private slip image proxy
      schedules/[id]/reminders/line/route.ts  LINE schedule reminders
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
      line.ts                                 LINE push and rich-menu helpers
      linePaymentReview.ts                    Approve/reject LINE payment requests
      lineScheduleMessages.ts                 Schedule reminder push messages
      slipCheck.ts                            Production QR/hash slip analyzer
      slipStorage.ts                          Supabase Storage helper for slips
    supabase/
      server.ts                               Service-role server client and CRUD helpers
      mappers.ts                              Database row to typed object mapping
      linePaymentRequests.ts                  Client wrapper for review UI
    calculations.ts
    store.ts
  types/
    index.ts                                  UI-facing camelCase types
    supabase.ts                               DB/API-facing snake_case types
scripts/
  check-slip.js                               Standalone local slip checker with OCR
supabase/
  migrations/
```

## Environment Variables

Create the local environment file:

```bash
cp .env.example .env.local
```

Required Supabase server environment:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Required LINE environment:

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
TRUEMONEY_RECEIVER_ACCOUNT_NUMBERS=optional,comma,separated,trumoney,receiver,numbers
TRUEMONEY_RECEIVER_ACCOUNT_NAME=optional-truemoney-receiver-name
TRUEMONEY_AUTO_REJECT_RECEIVER_MISMATCH=false
```

General uploads:

```env
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
```

### Receiver Account Variables

`SLIP_RECEIVER_ACCOUNT_NUMBER` is the main receiver account for bank transfer checks.

`SLIP_RECEIVER_ACCOUNT_NUMBERS` is for additional bank receiver accounts. Use comma-separated values.

`TRUEMONEY_RECEIVER_ACCOUNT_NUMBER` and `TRUEMONEY_RECEIVER_ACCOUNT_NUMBERS` are used only when the selected LINE payment method is `truemoney`.

`TRUEMONEY_RECEIVER_ACCOUNT_NAME` overrides `SLIP_RECEIVER_ACCOUNT_NAME` for TrueMoney slip checks. If it is not set, the webhook falls back to `SLIP_RECEIVER_ACCOUNT_NAME`.

`TRUEMONEY_AUTO_REJECT_RECEIVER_MISMATCH` defaults to `false`. TrueMoney receipt OCR can miss masked account/name text, so receiver mismatches block auto-approval but do not auto-reject unless this is set to `true`.

The webhook also includes a `PROMPTPAY_ID` constant in `src/app/api/line/webhook/route.ts`, because the bank-transfer QR payload is generated from that value.

## Local Development

Install dependencies:

```bash
npm install
```

Run the development server:

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

Manual webpack build check:

```bash
npx next build --webpack
```

## Supabase Setup

Apply migrations in numeric order from `supabase/migrations`.

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
| Vercel Blob | General uploaded images such as profile and category images |

Migration `009_add_slip_review_fields.sql` creates or updates the `payment-slips` bucket as non-public.

## LINE Setup

Set the LINE webhook URL:

```txt
https://your-production-domain.com/api/line/webhook
```

Required LINE settings:

- Webhook enabled.
- `LINE_CHANNEL_SECRET` matches the Messaging API channel.
- `LINE_CHANNEL_ACCESS_TOKEN` is valid.
- Students have added the LINE Official Account.

### Rich Menu

Rich menu assets:

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
register 24
```

The current webhook also accepts a raw classroom number:

```txt
24
```

The webhook reads `event.source.userId` and stores it in `students.line_user_id`.

### Pay

The student taps the rich menu pay action or sends a pay command. The bot:

1. Checks that the student is registered.
2. Loads unpaid schedules for that student.
3. Sends a LINE Flex message with large tappable buttons.
4. Creates a `line_payment_requests` row with `status = selecting`.
5. Stores the selected amount.
6. Lets the student select a payment method.

Supported methods:

```txt
kplus
truemoney
cash
```

### Cash

When the student selects cash:

```txt
status = cash_pending
method = cash
```

The request appears in the web review UI so the treasurer can approve it after receiving cash.

### Bank Transfer or TrueMoney

When the student selects bank transfer or TrueMoney:

```txt
status = awaiting_slip
method = kplus | truemoney
```

The bot sends fixed-amount payment instructions. The student sends a slip image back in the same LINE chat.

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

| Event | Database behavior |
| --- | --- |
| Start payment | Insert `line_payment_requests`, `status = selecting` |
| Choose transfer or TrueMoney | Update to `awaiting_slip` |
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

The production webhook uses:

```txt
src/lib/server/slipCheck.ts
```

It currently checks:

- SHA-256 image hash.
- QR readability through `sharp` and `jsqr`.
- QR payload.
- Amount if the QR payload includes EMV tag `54`.
- Receiver account and receiver name if they are present in the QR payload.
- Likely slip transaction or reference id from the QR payload.

The production webhook helper does not currently run OCR. If a bank or TrueMoney QR does not expose the visible amount, receiver account, or receiver name, the production checker may send the slip to web review instead of auto-approving it.

### Local Debug Checker

The terminal helper uses:

```txt
scripts/check-slip.js
```

It checks:

- QR payload.
- SHA-256 image hash.
- OCR text using `tesseract.js`.
- Top-area OCR for TrueMoney slips where the amount appears at the top.
- Visible amounts such as `80.00 THB`, `80.00 baht`, Thai baht text, or `B 80.00`.
- Masked account strings such as `XXX-X-X4106-x` and `09*-***-5433`.
- Receiver name variants where prefixes may be missing.

Use this script to debug a real slip image locally:

```bash
node scripts/check-slip.js ./path/to/slip.jpg 80
```

Example with an explicit receiver:

```bash
node scripts/check-slip.js ./path/to/slip.jpg 80 "xxx-x-x4106-x" "Receiver Name"
```

The script prints JSON similar to:

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

Approved payment requests are deleted, so duplicate prevention cannot rely only on `line_payment_requests`. For that reason, the app archives approved-slip metadata here.

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

1. Lock the request by updating only reviewable statuses.
2. Mark the request approved internally.
3. Create a transaction.
4. Archive approved slip metadata.
5. Enforce approved slip image retention.
6. Delete the `line_payment_requests` row.
7. Notify the student when approval came from web review.

Auto approval suppresses the duplicate push notification and replies in the original webhook event instead.

### Rejection Flow

Rejection does:

1. Update the request to rejected long enough to get a consistent row.
2. Push a LINE rejection message to the student.
3. Delete the rejected slip image from Supabase Storage if it exists.
4. Delete the `line_payment_requests` row.

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

- Older image files are deleted from Supabase Storage.
- `slip_url` and `slip_pathname` are cleared in `line_payment_slip_archives`.
- Duplicate-check metadata remains.

This keeps storage usage under control while preserving fraud and duplicate detection.

### Rejected Slip Cleanup

Rejected slips are removed from storage and the request row is deleted. Rejected data should not interrupt future payment attempts.

## API Routes

| Route | Purpose |
| --- | --- |
| `GET /api/health` | Health check |
| `GET/POST /api/students` | Students API |
| `GET/PATCH/DELETE /api/students/[id]` | Single student API |
| `GET/POST /api/schedules` | Schedules API |
| `GET/PATCH/DELETE /api/schedules/[id]` | Single schedule API |
| `GET /api/schedules/[id]/status` | Schedule payment status |
| `POST /api/schedules/[id]/reminders/line` | Push LINE reminders |
| `GET/POST /api/transactions` | Transactions API |
| `GET/PATCH/DELETE /api/transactions/[id]` | Single transaction API |
| `GET /api/transactions/balance` | Balance summary |
| `GET /api/transactions/income-by-method` | Income method summary |
| `GET/POST /api/categories` | Categories API |
| `GET/PATCH/DELETE /api/categories/[id]` | Category API |
| `POST /api/uploads` | Vercel Blob upload |
| `GET /api/uploads/slips` | Private slip image proxy |
| `GET/POST /api/line/webhook` | LINE webhook |
| `POST /api/line/rich-menu/setup` | Create/link rich menus |
| `GET /api/line/payment-requests` | List pending review requests |
| `GET/PATCH /api/line/payment-requests/[id]` | Read/update/reject request |
| `POST /api/line/payment-requests/[id]/approve` | Approve request |

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
2. Confirm the `payment-slips` bucket exists and is private.
3. Set all environment variables on Vercel.
4. Deploy the app.
5. Set the LINE webhook URL to the production domain.
6. Enable the LINE webhook.
7. Run rich menu setup if needed.
8. Register a test student through LINE.
9. Test the payment flow with one small schedule.
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
- The webhook URL points to the correct deployment.
- The request body is not modified before signature verification.

### LINE bot does not reply

Check:

- `LINE_CHANNEL_ACCESS_TOKEN`
- Webhook is enabled in LINE Developers.
- Vercel function logs for `/api/line/webhook`.
- The student has added the LINE Official Account.

### Student cannot pay

Check:

- The student has `line_user_id`.
- The student is included in the target schedule.
- The schedule still has unpaid remaining amount.
- No active request is stuck in `pending_slip_review`.

### Slip goes to review instead of auto approve

Check:

- QR is readable.
- QR contains enough data for the production checker.
- Expected amount equals selected amount.
- `SLIP_RECEIVER_ACCOUNT_NAME` is correct.
- `SLIP_RECEIVER_ACCOUNT_NUMBER` or `TRUEMONEY_RECEIVER_ACCOUNT_NUMBER` is correct.
- Duplicate metadata exists in `line_payment_requests` or `line_payment_slip_archives`.

Use:

```bash
node scripts/check-slip.js ./path/to/slip.jpg <amount>
```

The local checker is more diagnostic because it includes OCR output.

### Slip image cannot open in web review

Check:

- `SUPABASE_SLIP_BUCKET`
- Supabase Storage bucket exists.
- Server has `SUPABASE_SERVICE_ROLE_KEY`.
- `slip_pathname` exists in the request row or archive row.

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

- The rejected slip image from Supabase Storage.
- The rejected `line_payment_requests` row.

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
- Database row mapping lives in `src/lib/supabase/mappers.ts`.
- Server-only payment and slip logic lives in `src/lib/server`.
- Migrations are manually applied in numeric order.
- Keep financial side effects in server routes or server helpers.

## Known Engineering Notes

- `scripts/check-slip.js` uses OCR for local debugging.
- `src/lib/server/slipCheck.ts` currently does not OCR in the production webhook.
- If OCR auto approval is required in production, port the OCR extraction from `scripts/check-slip.js` into a server-only helper and account for runtime cost on Vercel.
- Some banks and TrueMoney mask account numbers. The local checker can match masked fragments, but this should be treated as weaker than full account verification.
- `expired` remains a valid historical status in the DB constraint, but the current cancel flow deletes active pre-review requests instead of marking them expired.

## License

Internal classroom or organization use.
