# Imali AI Ledger Export Format

## Overview

This document describes the export format for ledger data from the Imali AI feature-phone ledger. When a shop owner upgrades to a smartphone, their ledger history is exported in this standardized JSON format so that Imali AI's WhatsApp business assistant can import the data and continue tracking their finances.

## File Format

Exports are JSON files with a `.json` extension, encoded in UTF-8. The root object contains metadata and the complete ledger data.

## Schema

### Root Object

```json
{
  "format": "imali-ai-ledger-export",
  "version": 1,
  "exportedAt": "2025-11-03T10:30:00Z",
  "shop": { ... },
  "records": [ ... ]
}
```

### Top-Level Fields

| Field | Type | Description |
|-------|------|-------------|
| `format` | string | Always `"imali-ai-ledger-export"` to identify this format |
| `version` | number | Always `1` for this version |
| `exportedAt` | string | ISO 8601 UTC timestamp when the export was generated |
| `shop` | object | The shop data (see Shop Object below) |
| `records` | array | All ledger records in chronological order (see Record Objects below) |

### Shop Object

```json
{
  "id": "shop_abc12345def",
  "name": "Mama's Spaza",
  "phone": "+27 00 000 1234",
  "currency": "ZAR",
  "timeZone": "Africa/Johannesburg",
  "createdAt": "2025-10-01T08:00:00Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier for the shop |
| `name` | string | Display name of the shop (≤24 characters) |
| `phone` | string | Phone number in E.164 format |
| `currency` | string | Currency code: `ZAR`, `USD`, `KES`, `NGN`, `GHS`, `ZMW`, or `BWP` |
| `timeZone` | string | IANA time zone (e.g., `Africa/Johannesburg`) |
| `createdAt` | string | ISO 8601 UTC timestamp when the shop was created |

### Record Objects

All records appear in the `records` array in strict chronological order (the order they were recorded). Records represent the five types of ledger entries.

#### Common Fields

All record objects share these fields:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier for the record |
| `shopId` | string | ID of the shop this record belongs to |
| `kind` | string | Type of record: `sale`, `expense`, `debt`, `payment`, or `reversal` |
| `amount` | number | Amount in minor units (cents for ZAR, USD, KES, NGN, GHS, ZMW, BWP). Always an integer. Always ≥ 0. |
| `createdAt` | string | ISO 8601 UTC timestamp when the record was created |
| `channel` | string | How the record was entered: `ussd` (dialled menu), `sms` (text message), or `web` |
| `originalWords` | string | The exact text the owner typed to create this record (unmodified, for audit trail) |

#### Sale Record

A sale is money received from a customer (goods or services provided).

```json
{
  "id": "rec_abc12345_def56789",
  "shopId": "shop_abc12345def",
  "kind": "sale",
  "amount": 4500,
  "item": "bread",
  "createdAt": "2025-11-03T08:15:00Z",
  "channel": "sms",
  "originalWords": "sold 45 bread"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `item` | string (optional) | What was sold (e.g., `bread`, `drinks`) |

#### Expense Record

An expense is money paid out from the till.

```json
{
  "id": "rec_def67890_ghi12345",
  "shopId": "shop_abc12345def",
  "kind": "expense",
  "amount": 2000,
  "item": "transport",
  "createdAt": "2025-11-03T09:00:00Z",
  "channel": "ussd",
  "originalWords": "2"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `item` | string (optional) | What the money was spent on (e.g., `transport`, `stock`) |

#### Debt Record

A debt is goods given to a customer who will pay later.

```json
{
  "id": "rec_ghi23456_jkl78901",
  "shopId": "shop_abc12345def",
  "kind": "debt",
  "amount": 3000,
  "customerDisplayName": "Tendai",
  "customerKey": "tendai",
  "item": "sugar",
  "createdAt": "2025-11-03T10:00:00Z",
  "channel": "sms",
  "originalWords": "Tendai owes 30 sugar"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `customerDisplayName` | string | The customer's name as the owner typed it (trimmed, inner spaces normalized to one) |
| `customerKey` | string | Lowercase version of `customerDisplayName` for matching identical customers across records |
| `item` | string (optional) | What was given to the customer on credit |

#### Payment Record

A payment is money received from a customer to settle a debt.

```json
{
  "id": "rec_jkl34567_mno89012",
  "shopId": "shop_abc12345def",
  "kind": "payment",
  "amount": 1000,
  "customerDisplayName": "Tendai",
  "customerKey": "tendai",
  "createdAt": "2025-11-03T10:30:00Z",
  "channel": "sms",
  "originalWords": "Tendai paid 10"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `customerDisplayName` | string | The customer's name as the owner typed it (trimmed, inner spaces normalized to one) |
| `customerKey` | string | Lowercase version of `customerDisplayName` for matching identical customers |
| `item` | string (optional) | Description or reference (rarely used for payments) |

#### Reversal Record

A reversal is used when the owner taps "Undo" or "Undo last entry". It does not delete the original record; instead, it creates a new record that conceptually cancels it out.

```json
{
  "id": "rec_mno45678_pqr90123",
  "shopId": "shop_abc12345def",
  "kind": "reversal",
  "amount": 0,
  "reversesRecordId": "rec_abc12345_def56789",
  "createdAt": "2025-11-03T10:31:00Z",
  "channel": "sms",
  "originalWords": "undo"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `amount` | number | Always `0` for reversal records |
| `reversesRecordId` | string | The ID of the record being reversed |

## Importing Guide for Developers

When importing this data, follow these rules to maintain data integrity:

### Records and Reversals

- **Do not delete the original record.** Instead, treat the entire sequence (original record + reversal) as a logical pair.
- **Process records in order.** Records appear in strict chronological order by creation time. Maintain this order.
- **Handle reversals correctly.** A reversal record means the owner changed their mind about the corresponding record. When calculating balances or summaries, exclude both the original record and its reversal from computations.
- **Reversed records can only be reversed once.** If a record appears with two different reversal records pointing to it, that is invalid data and should be rejected with an error.

### Customer Names and Keys

- **Use `customerKey` for matching.** Customers are matched using the `customerKey` field, which is always lowercase.
- **Preserve `customerDisplayName` for display.** The `customerDisplayName` field preserves the owner's original capitalization and spacing (trimmed and normalized). Use this for showing the customer's name to users.
- **Handle name variations.** If two records have different `customerDisplayName` values but the same `customerKey`, they refer to the same customer. For example, "Tendai" and "TENDAI" have the same key and should be treated as one person.
- **Respect the owner's spelling.** Never "correct" or modify customer names. Use the `customerDisplayName` exactly as recorded.

### Currency and Amounts

- **Amounts are in minor units (cents).** The `amount` field is always an integer representing the smallest currency unit (cents for ZAR, USD, KES, NGN, GHS, ZMW, BWP).
- **Use the shop's currency for context.** All amounts in the `records` array use the currency specified in the `shop.currency` field.
- **Perform arithmetic on cents only.** Never convert to floating-point. Add and subtract using integer arithmetic.

### Timestamps

- **All timestamps are UTC (ISO 8601).** Timestamps use the format `YYYY-MM-DDTHH:MM:SSZ`.
- **Use the shop's time zone for display.** When showing dates to the owner (e.g., "Today's sales"), convert timestamps to the shop's local time using the `shop.timeZone` field.
- **Respect the export time.** The `exportedAt` timestamp indicates when the export was generated. Records with `createdAt` after `exportedAt` are future records and may indicate a clock issue.

### Validation

- **Reject invalid currency codes.** Only accept: `ZAR`, `USD`, `KES`, `NGN`, `GHS`, `ZMW`, `BWP`.
- **Validate time zones.** The `timeZone` field should be a valid IANA time zone identifier (e.g., `Africa/Johannesburg`).
- **Check record integrity.** Every record should have all required fields. Missing or null fields indicate corruption.
- **Verify safe integers.** Amounts must be safe JavaScript integers (within the range -(2^53 - 1) to 2^53 - 1).

## Example Export

Here is a complete minimal export with a few records:

```json
{
  "format": "imali-ai-ledger-export",
  "version": 1,
  "exportedAt": "2025-11-03T11:00:00Z",
  "shop": {
    "id": "shop_x4k7m2n9p1",
    "name": "Mama's Spaza",
    "phone": "+27 00 000 1234",
    "currency": "ZAR",
    "timeZone": "Africa/Johannesburg",
    "createdAt": "2025-10-01T08:00:00Z"
  },
  "records": [
    {
      "id": "rec_a1b2c3d4_e5f6g7h8",
      "shopId": "shop_x4k7m2n9p1",
      "kind": "sale",
      "amount": 5000,
      "item": "bread",
      "createdAt": "2025-11-03T08:15:00Z",
      "channel": "sms",
      "originalWords": "sold 50 bread"
    },
    {
      "id": "rec_i9j0k1l2_m3n4o5p6",
      "shopId": "shop_x4k7m2n9p1",
      "kind": "debt",
      "amount": 3000,
      "customerDisplayName": "Tendai",
      "customerKey": "tendai",
      "item": "sugar",
      "createdAt": "2025-11-03T09:30:00Z",
      "channel": "sms",
      "originalWords": "Tendai owes 30 sugar"
    },
    {
      "id": "rec_q7r8s9t0_u1v2w3x4",
      "shopId": "shop_x4k7m2n9p1",
      "kind": "payment",
      "amount": 1500,
      "customerDisplayName": "Tendai",
      "customerKey": "tendai",
      "createdAt": "2025-11-03T10:00:00Z",
      "channel": "ussd",
      "originalWords": "4"
    },
    {
      "id": "rec_y5z6a7b8_c9d0e1f2",
      "shopId": "shop_x4k7m2n9p1",
      "kind": "expense",
      "amount": 2000,
      "item": "transport",
      "createdAt": "2025-11-03T10:15:00Z",
      "channel": "sms",
      "originalWords": "spent 20 transport"
    },
    {
      "id": "rec_g3h4i5j6_k7l8m9n0",
      "shopId": "shop_x4k7m2n9p1",
      "kind": "reversal",
      "amount": 0,
      "reversesRecordId": "rec_y5z6a7b8_c9d0e1f2",
      "createdAt": "2025-11-03T10:20:00Z",
      "channel": "sms",
      "originalWords": "undo"
    }
  ]
}
```

## Versioning

The current version is `1`. If the format changes in the future:
- The `version` field will be incremented.
- New fields will be added at the end of objects to maintain backward compatibility where possible.
- Importers should check the `version` field and handle version mismatches gracefully.

## Questions?

This export format is designed for [Imali AI](https://imali.ai), a WhatsApp business assistant for small shop owners. For questions about importing this data, contact Imali AI's development team.
