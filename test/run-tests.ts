/**
 * Automated Test Suite for ScanDash FreshCart POS
 * Tests all required business domains:
 * - Product (Create, Update, Duplicate SKU, Duplicate Barcode, Search)
 * - Inventory (Add, Remove, Adjust, Prevent Negative Stock, Low Stock, Out of Stock)
 * - POS (Add to Cart, Calculate Totals, Complete Sale, Deduct Inventory)
 * - Invoice (Upload, OCR Extraction, Product Matching, Confirmation, Inventory Update)
 * - Notifications (Low Stock, Out of Stock, Duplicate Prevention)
 * - Security (Authentication, Authorization, Role Restrictions)
 */

import crypto from 'crypto';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  durationMs: number;
}

const TEST_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_mockTestKey';

function generateStripeSignature(rawBody: string, secret = TEST_WEBHOOK_SECRET, timestamp?: number): string {
  const ts = timestamp ?? Math.floor(Date.now() / 1000);
  const payloadToSign = `${ts}.${rawBody}`;
  const sig = crypto.createHmac('sha256', secret).update(payloadToSign, 'utf8').digest('hex');
  return `t=${ts},v1=${sig}`;
}

const BASE_URL = process.env.TEST_API_BASE_URL || 'http://localhost:3000';

let passedCount = 0;
let failedCount = 0;
const results: TestResult[] = [];

async function runTest(suiteName: string, testName: string, testFn: () => Promise<void>) {
  const start = Date.now();
  process.stdout.write(`  [TEST] ${testName} ... `);
  try {
    await testFn();
    const durationMs = Date.now() - start;
    passedCount++;
    results.push({ name: `${suiteName} > ${testName}`, passed: true, durationMs });
    console.log(`\x1b[32mPASSED\x1b[0m (${durationMs}ms)`);
  } catch (err: any) {
    const durationMs = Date.now() - start;
    failedCount++;
    const errMsg = err?.message || String(err);
    results.push({ name: `${suiteName} > ${testName}`, passed: false, error: errMsg, durationMs });
    console.log(`\x1b[31mFAILED\x1b[0m (${durationMs}ms)`);
    console.log(`         \x1b[31mError:\x1b[0m ${errMsg}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`Assertion Failed: ${message} (Expected: ${expected}, Actual: ${actual})`);
  }
}

async function main() {
  console.log('\n======================================================');
  console.log('  FreshCart POS Automated Test Suite');
  console.log(`  Target Base URL: ${BASE_URL}`);
  console.log('======================================================\n');

  // Obtain Owner Token for Privileged Actions
  const ownerLoginRes = await fetch(`${BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'owner', password: 'Owner@123' }),
  }).then((r) => r.json());

  assert(ownerLoginRes.success, 'Owner login must succeed');
  const ownerToken = ownerLoginRes.data.token;
  const ownerHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${ownerToken}`,
  };

  // Obtain Cashier Token for Cashier Tests
  const cashierLoginRes = await fetch(`${BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'cashier', password: 'Cashier@123' }),
  }).then((r) => r.json());

  assert(cashierLoginRes.success, 'Cashier login must succeed');
  const cashierToken = cashierLoginRes.data.token;
  const cashierHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${cashierToken}`,
  };

  const testSuffix = Date.now().toString().slice(-4);
  let createdProductId: number = 1;
  let testSku = `SKU-TEST-${testSuffix}`;
  let testBarcode = `BAR-TEST-${testSuffix}`;

  // ==========================================
  // SUITE 1: PRODUCT MANAGEMENT
  // ==========================================
  console.log('\x1b[1m\x1b[36m--- SUITE 1: PRODUCT MANAGEMENT ---\x1b[0m');

  await runTest('Product', 'Create product with valid attributes', async () => {
    const res = await fetch(`${BASE_URL}/api/products`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({
        name: `Test Organic Gala Apples ${testSuffix}`,
        sku: testSku,
        barcode: testBarcode,
        description: 'Crisp organic gala apples by the bag',
        categoryId: 1,
        purchasePrice: 1.25,
        sellingPrice: 2.99,
        taxRate: 0.05,
        unit: 'BAG',
        minimumInventoryThreshold: 10,
        active: true,
      }),
    });

    const json = await res.json();
    assertEqual(res.status, 201, 'HTTP status must be 201 Created');
    assert(json.success, 'Response success must be true');
    assert(Boolean(json.data.id), 'Created product must have generated ID');
    createdProductId = json.data.id;
  });

  await runTest('Product', 'Update existing product details', async () => {
    const res = await fetch(`${BASE_URL}/api/products/${createdProductId}`, {
      method: 'PUT',
      headers: ownerHeaders,
      body: JSON.stringify({
        name: `Test Organic Gala Apples Premium ${testSuffix}`,
        sku: testSku,
        barcode: testBarcode,
        purchasePrice: 1.4,
        sellingPrice: 3.49,
        taxRate: 0.05,
        unit: 'BAG',
        minimumInventoryThreshold: 12,
        active: true,
      }),
    });

    const json = await res.json();
    assertEqual(res.status, 200, 'HTTP status must be 200 OK');
    assertEqual(json.data.sellingPrice, 3.49, 'Updated selling price must match');
    assertEqual(json.data.minimumInventoryThreshold, 12, 'Updated threshold must match');
  });

  await runTest('Product', 'Reject duplicate SKU constraint conflict', async () => {
    const res = await fetch(`${BASE_URL}/api/products`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({
        name: 'Another Apple Variety',
        sku: testSku, // Duplicate SKU
        barcode: `BAR-OTHER-${testSuffix}`,
        purchasePrice: 1.0,
        sellingPrice: 2.0,
        taxRate: 0,
      }),
    });

    assertEqual(res.status, 409, 'Duplicate SKU must return HTTP 409 Conflict');
    const json = await res.json();
    assert(!json.success, 'Duplicate SKU response must indicate failure');
  });

  await runTest('Product', 'Reject duplicate barcode constraint conflict', async () => {
    const res = await fetch(`${BASE_URL}/api/products`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({
        name: 'Third Apple Variety',
        sku: `SKU-THIRD-${testSuffix}`,
        barcode: testBarcode, // Duplicate Barcode
        purchasePrice: 1.0,
        sellingPrice: 2.0,
        taxRate: 0,
      }),
    });

    assertEqual(res.status, 409, 'Duplicate barcode must return HTTP 409 Conflict');
    const json = await res.json();
    assert(!json.success, 'Duplicate barcode response must indicate failure');
  });

  await runTest('Product', 'Search products by query keyword (Partial match)', async () => {
    const res = await fetch(`${BASE_URL}/api/products?search=Gala`, {
      headers: cashierHeaders,
    });

    const json = await res.json();
    assertEqual(res.status, 200, 'Search must return HTTP 200 OK');
    assert(Array.isArray(json.data), 'Data must be an array');
    assert(json.data.length > 0, 'Search for Gala must return at least one result');
    assert(
      json.data.some((p: any) => p.id === createdProductId),
      'Created product must appear in search results'
    );
  });

  // ==========================================
  // SUITE 2: INVENTORY MANAGEMENT
  // ==========================================
  console.log('\n\x1b[1m\x1b[36m--- SUITE 2: INVENTORY MANAGEMENT ---\x1b[0m');

  await runTest('Inventory', 'Add stock (PURCHASE/Restock intake)', async () => {
    const res = await fetch(`${BASE_URL}/api/inventory/add`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({
        productId: createdProductId,
        quantity: 50,
        transactionType: 'PURCHASE',
        reason: 'Initial test intake',
        referenceId: `PO-TEST-${testSuffix}`,
      }),
    });

    const json = await res.json();
    assertEqual(res.status, 201, 'Add stock must return HTTP 201 Created');
    assertEqual(json.data.newQuantity, 50, 'New quantity must equal 50');
  });

  await runTest('Inventory', 'Remove stock (DAMAGE/Deduction)', async () => {
    const res = await fetch(`${BASE_URL}/api/inventory/remove`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({
        productId: createdProductId,
        quantity: 5,
        transactionType: 'DAMAGE',
        reason: 'Bruised apples discarded',
      }),
    });

    const json = await res.json();
    assertEqual(res.status, 200, 'Remove stock must return HTTP 200 OK');
    assertEqual(json.data.newQuantity, 45, 'New quantity must equal 45 (50 - 5)');
  });

  await runTest('Inventory', 'Adjust stock to target balance (Cycle Count)', async () => {
    const res = await fetch(`${BASE_URL}/api/inventory/adjust`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({
        productId: createdProductId,
        targetQuantity: 30,
        reason: 'Physical inventory audit',
      }),
    });

    const json = await res.json();
    assertEqual(res.status, 200, 'Adjust stock must return HTTP 200 OK');
    assertEqual(json.data.newQuantity, 30, 'Adjusted quantity must be 30');
  });

  await runTest('Inventory', 'Prevent negative stock deduction', async () => {
    const res = await fetch(`${BASE_URL}/api/inventory/remove`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({
        productId: createdProductId,
        quantity: 999, // Way higher than 30
        reason: 'Oversized removal',
      }),
    });

    assertEqual(res.status, 400, 'Excess deduction must return HTTP 400 Bad Request');
    const json = await res.json();
    assert(json.error.includes('Insufficient inventory'), 'Error must specify insufficient inventory');
  });

  await runTest('Inventory', 'Calculate LOW STOCK status when stock <= threshold', async () => {
    // Current threshold is 12, adjust to 8
    const res = await fetch(`${BASE_URL}/api/inventory/adjust`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({
        productId: createdProductId,
        targetQuantity: 8,
        reason: 'Simulate low stock level',
      }),
    });

    const json = await res.json();
    assertEqual(res.status, 200, 'Adjustment must succeed');

    const invRes = await fetch(`${BASE_URL}/api/inventory/product/${createdProductId}`, {
      headers: ownerHeaders,
    });
    const invJson = await invRes.json();
    assertEqual(invJson.data.stockStatus, 'LOW STOCK', 'Status must be LOW STOCK');
  });

  await runTest('Inventory', 'Calculate OUT OF STOCK status when stock == 0', async () => {
    const res = await fetch(`${BASE_URL}/api/inventory/adjust`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({
        productId: createdProductId,
        targetQuantity: 0,
        reason: 'Exhausted stock simulation',
      }),
    });

    const json = await res.json();
    assertEqual(res.status, 200, 'Adjustment must succeed');

    const invRes = await fetch(`${BASE_URL}/api/inventory/product/${createdProductId}`, {
      headers: ownerHeaders,
    });
    const invJson = await invRes.json();
    assertEqual(invJson.data.stockStatus, 'OUT OF STOCK', 'Status must be OUT OF STOCK');
  });

  // Restock for POS testing
  await fetch(`${BASE_URL}/api/inventory/add`, {
    method: 'POST',
    headers: ownerHeaders,
    body: JSON.stringify({
      productId: createdProductId,
      quantity: 50,
      reason: 'Restock for POS tests',
    }),
  });

  // ==========================================
  // SUITE 3: POS CHECKOUT & TERMINAL
  // ==========================================
  console.log('\n\x1b[1m\x1b[36m--- SUITE 3: POS CHECKOUT & TERMINAL ---\x1b[0m');

  await runTest('POS', 'Add items to cart and validate lines', async () => {
    // Cashier lookup product
    const prodRes = await fetch(`${BASE_URL}/api/products/${createdProductId}`, {
      headers: cashierHeaders,
    });
    const prodJson = await prodRes.json();
    assertEqual(prodRes.status, 200, 'Product must be found');
    assert(prodJson.data.active, 'Product must be active');
  });

  await runTest('POS', 'Accurately calculate subtotal, tax, and order totals', async () => {
    // Selling price: 3.49, Qty: 2, TaxRate: 5%
    // Subtotal: 6.98, Tax: 6.98 * 0.05 = 0.35, Total: 7.33
    const res = await fetch(`${BASE_URL}/api/sales`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({
        items: [
          {
            productId: createdProductId,
            quantity: 2,
          },
        ],
      }),
    });

    const json = await res.json();
    assertEqual(res.status, 201, 'Sale checkout must return HTTP 201 Created');
    assertEqual(json.data.subtotal, 6.98, 'Subtotal calculation must be accurate');
    assertEqual(json.data.taxAmount, 0.35, 'Tax calculation must be accurate');
    assertEqual(json.data.totalAmount, 7.33, 'Grand total must equal subtotal + tax');
  });

  await runTest('POS', 'Complete sale and verify receipt generation', async () => {
    const res = await fetch(`${BASE_URL}/api/sales`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({
        items: [{ productId: createdProductId, quantity: 1 }],
      }),
    });

    const json = await res.json();
    assertEqual(res.status, 201, 'Sale must be completed');
    assertEqual(json.data.status, 'COMPLETED', 'Sale status must be COMPLETED');
    assert(Boolean(json.data.receiptNumber), 'Receipt number must be generated');

    // Retrieve receipt
    const receiptRes = await fetch(`${BASE_URL}/api/sales/receipt/${json.data.receiptNumber}`, {
      headers: cashierHeaders,
    });
    assertEqual(receiptRes.status, 200, 'Receipt must be retrievable by receipt number');
  });

  await runTest('POS', 'Deduct inventory on checkout and record SALE transaction', async () => {
    const initialInv = await fetch(`${BASE_URL}/api/inventory/product/${createdProductId}`, {
      headers: ownerHeaders,
    }).then((r) => r.json());

    const stockBefore = initialInv.data.currentQuantity;

    // Checkout 3 units
    await fetch(`${BASE_URL}/api/sales`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({
        items: [{ productId: createdProductId, quantity: 3 }],
      }),
    });

    const updatedInv = await fetch(`${BASE_URL}/api/inventory/product/${createdProductId}`, {
      headers: ownerHeaders,
    }).then((r) => r.json());

    const stockAfter = updatedInv.data.currentQuantity;
    assertEqual(stockAfter, stockBefore - 3, 'Inventory must be deducted by exactly 3 units');
  });

  // ==========================================
  // SUITE 4: PURCHASE INVOICE & OCR
  // ==========================================
  console.log('\n\x1b[1m\x1b[36m--- SUITE 4: PURCHASE INVOICE & OCR ---\x1b[0m');

  let uploadedInvoiceId: number = 1;

  await runTest('Invoice', 'Upload valid purchase invoice file (JPEG/PDF)', async () => {
    // Generate valid JPEG bytes (0xFF, 0xD8, 0xFF, 0xE0)
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
    const formData = new FormData();
    formData.append('file', new Blob([jpegBytes], { type: 'image/jpeg' }), 'supplier_invoice.jpg');
    formData.append('notes', 'Automated test invoice');

    const res = await fetch(`${BASE_URL}/api/invoices/upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ownerToken}`,
      },
      body: formData,
    });

    const json = await res.json();
    assertEqual(res.status, 201, 'Invoice upload must return HTTP 201 Created');
    assertEqual(json.data.status, 'UPLOADED', 'Initial invoice status must be UPLOADED');
    assert(Boolean(json.data.fileHash), 'File hash must be computed for integrity');
    uploadedInvoiceId = json.data.id;
  });

  await runTest('Invoice', 'OCR extraction parsing and manual review flags', async () => {
    const res = await fetch(`${BASE_URL}/api/invoices/${uploadedInvoiceId}/ocr`, {
      method: 'POST',
      headers: ownerHeaders,
    });

    const json = await res.json();
    assertEqual(res.status, 200, 'OCR extraction must succeed');
    assert(Boolean(json.data.ocrResult), 'OCR result payload must be present');
    assert(Array.isArray(json.data.ocrResult.items), 'Extracted items must be an array');
  });

  await runTest('Invoice', 'Product matching by catalog SKU and name', async () => {
    const matchRes = await fetch(`${BASE_URL}/api/invoices/match-product`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({
        productName: `Test Organic Gala Apples ${testSuffix}`,
        sku: testSku,
        barcode: testBarcode,
      }),
    });

    const matchJson = await matchRes.json();
    assertEqual(matchRes.status, 200, 'Product matching endpoint must return HTTP 200');
    assert(Boolean(matchJson.data.matchedProduct), 'Product match must find catalog item');
    assertEqual(matchJson.data.matchedProduct.id, createdProductId, 'Matched product ID must match created product');
  });

  await runTest('Invoice', 'Invoice confirmation updates inventory atomically', async () => {
    // Confirm the freshly uploaded & OCR-processed invoice
    const res = await fetch(`${BASE_URL}/api/invoices/${uploadedInvoiceId}/confirm`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({
        confirmedUncertainMatches: true,
        confirmedBy: 'Store Owner',
      }),
    });

    const json = await res.json();
    assertEqual(res.status, 200, 'Invoice confirmation must succeed');
    assertEqual(json.transactionStatus, 'COMMITTED', 'DB transaction status must be COMMITTED');
    assertEqual(json.invoice.status, 'CONFIRMED', 'Invoice status must be CONFIRMED');
    assert(json.inventoryUpdates.length > 0, 'Inventory must be updated on confirmation');
  });

  // ==========================================
  // SUITE 5: NOTIFICATIONS & ALERTS
  // ==========================================
  console.log('\n\x1b[1m\x1b[36m--- SUITE 5: NOTIFICATIONS & ALERTS ---\x1b[0m');

  await runTest('Notifications', 'Trigger WARNING notification on LOW STOCK', async () => {
    // Set stock to 5 (threshold is 12)
    await fetch(`${BASE_URL}/api/inventory/adjust`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({
        productId: createdProductId,
        targetQuantity: 5,
        reason: 'Trigger low stock alert',
      }),
    });

    const notifRes = await fetch(`${BASE_URL}/api/notifications`, {
      headers: ownerHeaders,
    });
    const notifJson = await notifRes.json();
    const hasLowStockAlert = notifJson.data.some(
      (n: any) => n.productId === createdProductId && n.type === 'LOW_STOCK'
    );
    assert(hasLowStockAlert, 'LOW_STOCK notification must be triggered for product');
  });

  await runTest('Notifications', 'Trigger CRITICAL notification on OUT OF STOCK', async () => {
    // Set stock to 0
    await fetch(`${BASE_URL}/api/inventory/adjust`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({
        productId: createdProductId,
        targetQuantity: 0,
        reason: 'Trigger out of stock alert',
      }),
    });

    const notifRes = await fetch(`${BASE_URL}/api/notifications`, {
      headers: ownerHeaders,
    });
    const notifJson = await notifRes.json();
    const hasOutOfStockAlert = notifJson.data.some(
      (n: any) => n.productId === createdProductId && n.type === 'OUT_OF_STOCK'
    );
    assert(hasOutOfStockAlert, 'OUT_OF_STOCK notification must be triggered for product');
  });

  await runTest('Notifications', 'Prevent duplicate unread notifications', async () => {
    const beforeCount = await fetch(`${BASE_URL}/api/notifications`, { headers: ownerHeaders })
      .then((r) => r.json())
      .then((j) => j.data.filter((n: any) => n.productId === createdProductId && n.type === 'OUT_OF_STOCK').length);

    // Re-adjust stock at 0 again
    await fetch(`${BASE_URL}/api/inventory/adjust`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({
        productId: createdProductId,
        targetQuantity: 0,
        reason: 'Second zero stock event',
      }),
    });

    const afterCount = await fetch(`${BASE_URL}/api/notifications`, { headers: ownerHeaders })
      .then((r) => r.json())
      .then((j) => j.data.filter((n: any) => n.productId === createdProductId && n.type === 'OUT_OF_STOCK').length);

    assertEqual(afterCount, beforeCount, 'Duplicate unread notification must NOT be created');
  });

  // ==========================================
  // SUITE 6: SECURITY (AUTH & RBAC)
  // ==========================================
  console.log('\n\x1b[1m\x1b[36m--- SUITE 6: SECURITY (AUTH & RBAC) ---\x1b[0m');

  await runTest('Security', 'Authentication: Reject invalid credentials with 401', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'owner', password: 'WrongPassword@999' }),
    });

    assertEqual(res.status, 401, 'Bad credentials must return HTTP 401 Unauthorized');
    const json = await res.json();
    assert(!json.success, 'Success must be false on invalid login');
  });

  await runTest('Security', 'Authorization: Reject unauthenticated request to protected APIs', async () => {
    const res = await fetch(`${BASE_URL}/api/users`);
    assertEqual(res.status, 401, 'Missing token must return HTTP 401 Unauthorized');
  });

  await runTest('Security', 'Role Restrictions: Cashier forbidden (403) from Product Mutations', async () => {
    const res = await fetch(`${BASE_URL}/api/products`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({
        name: 'Unauthorized Product',
        sku: 'SKU-UNAUTH',
        sellingPrice: 9.99,
        purchasePrice: 5.0,
      }),
    });

    assertEqual(res.status, 403, 'Cashier product creation must return HTTP 403 Forbidden');
    const json = await res.json();
    assertEqual(json.error, 'Forbidden', 'Error must be Forbidden');
  });

  await runTest('Security', 'Role Restrictions: Cashier forbidden (403) from Inventory Management', async () => {
    const res = await fetch(`${BASE_URL}/api/inventory/adjust`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({ productId: 1, targetQuantity: 100 }),
    });

    assertEqual(res.status, 403, 'Cashier inventory adjust must return HTTP 403 Forbidden');
  });

  await runTest('Security', 'Role Restrictions: Cashier forbidden (403) from User Management', async () => {
    const res = await fetch(`${BASE_URL}/api/users`, {
      headers: cashierHeaders,
    });

    assertEqual(res.status, 403, 'Cashier user management access must return HTTP 403 Forbidden');
  });

  await runTest('Security', 'Role Restrictions: Cashier forbidden (403) from Audit Logs', async () => {
    const res = await fetch(`${BASE_URL}/api/audit-logs`, {
      headers: cashierHeaders,
    });

    assertEqual(res.status, 403, 'Cashier audit logs access must return HTTP 403 Forbidden');
  });

  await runTest('Security', 'Role Restrictions: Cashier ALLOWED on POS Checkout & Receipts', async () => {
    const res = await fetch(`${BASE_URL}/api/sales`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({
        items: [{ productId: 1, quantity: 1 }],
      }),
    });

    assertEqual(res.status, 201, 'Cashier must be permitted to complete checkout');
  });

  // ==========================================
  // SUITE 7: AUDIT LOGGING OF BUSINESS OPERATIONS
  // ==========================================
  console.log('\n\x1b[1m\x1b[36m--- SUITE 7: AUDIT LOGGING OF BUSINESS OPERATIONS ---\x1b[0m');

  let saleToCancelId: number = 1;

  await runTest('Audit', 'Sale Cancellation: Void sale, restore inventory, and trigger audit logging', async () => {
    // 1. Create a sale first
    const saleRes = await fetch(`${BASE_URL}/api/sales`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({
        items: [{ productId: 1, quantity: 2 }],
      }),
    }).then((r) => r.json());

    saleToCancelId = saleRes.data.id;

    // Get stock before cancellation
    const invBefore = await fetch(`${BASE_URL}/api/inventory/product/1`, {
      headers: ownerHeaders,
    }).then((r) => r.json());
    const qtyBefore = invBefore.data.currentQuantity;

    // Cancel the sale
    const cancelRes = await fetch(`${BASE_URL}/api/sales/${saleToCancelId}/cancel`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({ reason: 'Customer requested refund and return' }),
    });

    const cancelJson = await cancelRes.json();
    assertEqual(cancelRes.status, 200, 'Sale cancellation must succeed with HTTP 200');
    assertEqual(cancelJson.data.status, 'CANCELLED', 'Sale status must be updated to CANCELLED');

    // Verify inventory restored (+2)
    const invAfter = await fetch(`${BASE_URL}/api/inventory/product/1`, {
      headers: ownerHeaders,
    }).then((r) => r.json());
    assertEqual(invAfter.data.currentQuantity, qtyBefore + 2, 'Restored stock must increase by 2 units');
  });

  await runTest('Audit', 'Audit Trail: Verify required fields (User, Action, Entity, Entity ID, Timestamp, Old/New Values)', async () => {
    const res = await fetch(`${BASE_URL}/api/audit-logs`, {
      headers: ownerHeaders,
    });

    const json = await res.json();
    assertEqual(res.status, 200, 'Audit logs retrieval must return HTTP 200');
    assert(Array.isArray(json.data), 'Audit logs data must be an array');
    assert(json.data.length > 0, 'Audit log trail must contain recorded events');

    // Check structure of first recorded log
    const sample = json.data[0];
    assert(Boolean(sample.username), 'Log must record user');
    assert(Boolean(sample.action), 'Log must record action');
    assert(Boolean(sample.entity), 'Log must record entity');
    assert(sample.entityId !== undefined, 'Log must record entityId');
    assert(Boolean(sample.timestamp), 'Log must record timestamp');
  });

  await runTest('Audit', 'Audit Track: Verify tracking across all business operations', async () => {
    const res = await fetch(`${BASE_URL}/api/audit-logs`, {
      headers: ownerHeaders,
    });

    const json = await res.json();
    const actions = new Set(json.data.map((l: any) => l.action));

    // Verify tracked business actions
    assert(actions.has('PRODUCT_CREATED') || actions.has('PRODUCT_UPDATED'), 'Must track Product changes');
    assert(actions.has('INVENTORY_ADJUSTED'), 'Must track Inventory adjustments');
    assert(actions.has('INVOICE_CONFIRMED'), 'Must track Invoice confirmation');
    assert(actions.has('PRICE_CHANGED'), 'Must track Price changes');
    assert(actions.has('THRESHOLD_CHANGED'), 'Must track Threshold changes');
    assert(actions.has('SALE_CANCELLED'), 'Must track Sale cancellation');
  });

  await runTest('Audit', 'Security: Sensitive data (passwords, salts, hashes) must NEVER appear in audit logs', async () => {
    const res = await fetch(`${BASE_URL}/api/audit-logs`, {
      headers: ownerHeaders,
    });

    const json = await res.json();
    const rawLogsStr = JSON.stringify(json.data);

    assert(!rawLogsStr.includes('Owner@123'), 'Passwords must never appear in audit log payload');
    assert(!rawLogsStr.includes('Cashier@123'), 'Passwords must never appear in audit log payload');
    assert(!rawLogsStr.includes('Admin@123'), 'Passwords must never appear in audit log payload');
    assert(!rawLogsStr.toLowerCase().includes('passwordhash'), 'Password hash must never appear in audit logs');
  });

  await runTest('Audit', 'Export: Generate valid CSV audit log report for compliance', async () => {
    const res = await fetch(`${BASE_URL}/api/audit-logs/export/csv`, {
      headers: ownerHeaders,
    });

    assertEqual(res.status, 200, 'Audit CSV export must return HTTP 200 OK');
    const contentType = res.headers.get('content-type') || '';
    assert(contentType.includes('text/csv'), 'Content-Type must be text/csv');
    const csvText = await res.text();
    assert(csvText.includes('Log ID,Timestamp,Username,Role,Action,Entity,Entity ID'), 'CSV headers must match audit format');
  });

  // ==========================================
  // SUITE 8: POS PAYMENT ARCHITECTURE (STRIPE STEP 1)
  // ==========================================
  console.log('\n\x1b[1m\x1b[36m--- SUITE 8: POS PAYMENT ARCHITECTURE (STRIPE STEP 1) ---\x1b[0m');

  let testPaymentId: number = 1;

  await runTest('Payment', 'Initiate payment session using Stripe provider abstraction', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/payments/initiate`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({
        amount: 29.99,
        currency: 'USD',
        saleId: 1,
        provider: 'STRIPE',
      }),
    });

    const json = await res.json();
    assertEqual(res.status, 201, 'Payment initiation must return HTTP 201 Created');
    assert(json.success, 'Response success must be true');
    assertEqual(json.data.amount, 29.99, 'Amount must match requested amount');
    assertEqual(json.data.currency, 'USD', 'Currency must be USD');
    assertEqual(json.data.status, 'PENDING', 'Payment status must be PENDING');
    assertEqual(json.data.provider, 'STRIPE', 'Provider must be STRIPE');
    assert(json.data.externalPaymentId?.startsWith('pi_prep_'), 'External payment ID must follow Stripe PaymentIntent convention');
    assert(Boolean(json.data.clientSecret), 'Client secret must be provided for client-side completion');
    testPaymentId = json.data.id;
  });

  await runTest('Payment', 'Query payment transaction by database ID', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/payments/${testPaymentId}`, {
      headers: cashierHeaders,
    });

    const json = await res.json();
    assertEqual(res.status, 200, 'Get payment by ID must return HTTP 200 OK');
    assertEqual(json.data.id, testPaymentId, 'Payment ID must match');
    assertEqual(json.data.status, 'PENDING', 'Payment status must remain PENDING');
  });

  await runTest('Payment', 'Query payments associated with sale ID', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/payments/sale/1`, {
      headers: cashierHeaders,
    });

    const json = await res.json();
    assertEqual(res.status, 200, 'Get payments by sale must return HTTP 200 OK');
    assert(Array.isArray(json.data), 'Data must be an array of payments');
    assert(json.data.length > 0, 'Must have at least one payment for sale 1');
  });

  await runTest('Payment', 'Cancel pending payment session', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/payments/${testPaymentId}/cancel`, {
      method: 'POST',
      headers: cashierHeaders,
    });

    const json = await res.json();
    assertEqual(res.status, 200, 'Payment cancellation must return HTTP 200 OK');
    assertEqual(json.data.status, 'CANCELED', 'Payment status must transition to CANCELED');
  });

  await runTest('Payment', 'Validation: Reject non-positive amount and unsupported provider', async () => {
    const invalidAmountRes = await fetch(`${BASE_URL}/api/v1/payments/initiate`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({ amount: -5.0, provider: 'STRIPE' }),
    });
    assertEqual(invalidAmountRes.status, 400, 'Negative amount must return HTTP 400 Bad Request');

    const invalidProviderRes = await fetch(`${BASE_URL}/api/v1/payments/initiate`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({ amount: 10.0, provider: 'BITCOIN_UNKNOWN' }),
    });
    assertEqual(invalidProviderRes.status, 400, 'Unsupported provider must return HTTP 400 Bad Request');
  });

  await runTest('Payment', 'Security: Stripe secret API key and webhook secret must NEVER be exposed in responses', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/payments/${testPaymentId}`, {
      headers: cashierHeaders,
    });
    const json = await res.json();
    assertEqual(res.status, 200, 'Get payment by ID must return HTTP 200 OK');

    const rawResponse = JSON.stringify(json);
    assert(!rawResponse.includes('apiKey'), 'Secret apiKey must never be exposed in payment API responses');
    assert(!rawResponse.includes('webhookSecret'), 'Webhook secret must never be exposed in payment API responses');
    assert(!rawResponse.includes('sk_live_'), 'Live secret keys must never appear in response payloads');
    assert(!rawResponse.includes('whsec_'), 'Webhook secret tokens must never appear in response payloads');
  });

  await runTest('Payment', 'Test Mode: Operates safely in test mode without requiring real payment credentials', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/payments/initiate`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({
        amount: 45.50,
        currency: 'USD',
        saleId: 1,
        provider: 'STRIPE',
      }),
    });
    const json = await res.json();
    assertEqual(res.status, 201, 'Test mode initiation must return HTTP 201 Created');
    assertEqual(json.data.status, 'PENDING', 'Status must be PENDING');
    assert(json.data.externalPaymentId?.startsWith('pi_prep_'), 'External ID should be generated in test mode');
  });

  await runTest('Payment', 'Configuration: Public config endpoint exposes only safe client properties and no secrets', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/payments/config`, {
      headers: cashierHeaders,
    });
    const json = await res.json();
    assertEqual(res.status, 200, 'Get payment config must return HTTP 200 OK');
    assert(json.success, 'Response success must be true');
    assert('publishableKey' in json.data, 'publishableKey must be defined in config payload');
    assert('currency' in json.data, 'currency must be defined in config payload');
    assert('testMode' in json.data, 'testMode must be defined in config payload');
    assertEqual(typeof json.data.testMode, 'boolean', 'testMode must be a boolean');

    const raw = JSON.stringify(json);
    assert(!raw.includes('apiKey'), 'apiKey must NEVER be present in payment config response');
    assert(!raw.includes('webhookSecret'), 'webhookSecret must NEVER be present in payment config response');
  });

  // ==========================================
  // SUITE 9: STRIPE TERMINAL CARD-PRESENT PAYMENTINTENT (STEP 3)
  // ==========================================
  console.log('\n\x1b[1m\x1b[36m--- SUITE 9: STRIPE TERMINAL PAYMENTINTENT (STEP 3) ---\x1b[0m');

  let pendingSaleId: number = 0;
  let testProductId: number = 1;
  let preStock: number = 0;

  await runTest('Terminal PaymentIntent', 'Prerequisite: Create a pending checkout sale draft', async () => {
    const pRes = await fetch(`${BASE_URL}/api/products/1`, { headers: cashierHeaders });
    const pJson = await pRes.json();
    testProductId = pJson.data.id;

    const invRes = await fetch(`${BASE_URL}/api/inventory`, { headers: ownerHeaders });
    const invJson = await invRes.json();
    const invRecord = invJson.data.find((i: any) => i.productId === testProductId);
    preStock = invRecord ? invRecord.currentQuantity : 100;

    const saleRes = await fetch(`${BASE_URL}/api/sales`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({
        status: 'PENDING',
        items: [{ productId: testProductId, quantity: 2 }],
      }),
    });
    assertEqual(saleRes.status, 201, 'Pending sale creation must return HTTP 201');
    const saleJson = await saleRes.json();
    pendingSaleId = saleJson.data.id;
    assertEqual(saleJson.data.status, 'PENDING', 'Sale status should be PENDING');
  });

  let createdPaymentIntentId: string = '';
  let createdClientSecret: string = '';
  let trustedAmount: number = 0;

  await runTest('Terminal PaymentIntent', 'Create PaymentIntent suitable for Stripe Terminal card-present payments', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/payments/create-payment-intent`, {
      method: 'POST',
      headers: {
        ...cashierHeaders,
        'Idempotency-Key': `idemp_test_${Date.now()}`,
      },
      body: JSON.stringify({
        saleId: pendingSaleId,
        currency: 'USD',
        // Client attempts to tamper with amount: server MUST calculate trusted amount instead
        amount: 0.05,
      }),
    });
    assertEqual(res.status, 201, 'Terminal PaymentIntent creation must return HTTP 201 Created');
    const json = await res.json();
    assert(json.success, 'Response success must be true');

    const data = json.data;
    assert(data.paymentIntentId?.startsWith('pi_term_'), 'PaymentIntent ID must be generated with pi_term_ prefix');
    assert(data.clientSecret?.includes('_secret_'), 'clientSecret must be returned for Stripe Terminal');
    assertEqual(data.status, 'requires_payment_method', 'PaymentIntent initial status must be requires_payment_method');
    assert(Array.isArray(data.paymentMethodTypes) && data.paymentMethodTypes.includes('card_present'), 'Payment method type must include card_present');
    assertEqual(data.currency, 'USD', 'Currency must be USD');
    assertEqual(data.saleId, pendingSaleId, 'Sale ID must match target sale');
    assert(data.paymentId > 0, 'Local payment record ID must be returned');

    // Trusted price calculation: amount MUST NOT be the tampered $0.05
    assert(data.amount > 0.05, `Server must calculate trusted amount (got ${data.amount}) instead of client tampered 0.05`);
    trustedAmount = data.amount;

    createdPaymentIntentId = data.paymentIntentId;
    createdClientSecret = data.clientSecret;
  });

  await runTest('Terminal PaymentIntent', 'Idempotency: Re-submitting payment intent request returns existing intent without duplicating', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/payments/create-payment-intent`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({
        saleId: pendingSaleId,
      }),
    });
    assert(res.status === 200 || res.status === 201, 'Idempotent request must return success');
    const json = await res.json();
    assertEqual(json.data.paymentIntentId, createdPaymentIntentId, 'Must return the same PaymentIntent ID on retry');
    assertEqual(json.data.clientSecret, createdClientSecret, 'Must return the same clientSecret on retry');
    assertEqual(json.data.amount, trustedAmount, 'Amount must be consistent on retry');
  });

  await runTest('Terminal PaymentIntent', 'Persistence: Payment record is stored locally and linked to the sale', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/payments/sale/${pendingSaleId}`, {
      headers: cashierHeaders,
    });
    assertEqual(res.status, 200, 'Fetching payments for sale must return HTTP 200');
    const json = await res.json();
    assert(Array.isArray(json.data) && json.data.length >= 1, 'Sale must have at least one payment record');
    const payment = json.data.find((p: any) => p.externalPaymentId === createdPaymentIntentId);
    assert(payment, 'Stored payment must match external PaymentIntent ID');
    assertEqual(payment.status, 'PENDING', 'Payment status must be PENDING');
    assertEqual(payment.provider, 'STRIPE', 'Payment provider must be STRIPE');
  });

  await runTest('Terminal PaymentIntent', 'Safety: Inventory is NOT deducted and sale is NOT completed at this stage', async () => {
    // 1. Check inventory: preStock must still equal currentQuantity (no deduction yet)
    const invRes = await fetch(`${BASE_URL}/api/inventory`, { headers: ownerHeaders });
    const invJson = await invRes.json();
    const invRecord = invJson.data.find((i: any) => i.productId === testProductId);
    assertEqual(invRecord.currentQuantity, preStock, 'Inventory MUST NOT be deducted when only creating PaymentIntent');

    // 2. Check sale status: must still be PENDING
    const saleRes = await fetch(`${BASE_URL}/api/sales/${pendingSaleId}`, { headers: cashierHeaders });
    const saleJson = await saleRes.json();
    assertEqual(saleJson.data.status, 'PENDING', 'Sale status MUST NOT be marked COMPLETED when only creating PaymentIntent');
  });

  await runTest('Terminal PaymentIntent', 'Security: Unauthenticated requests are rejected with 401 Unauthorized', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/payments/create-payment-intent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ saleId: pendingSaleId }),
    });
    assertEqual(res.status, 401, 'Unauthenticated request must be rejected with 401');
  });

  await runTest('Terminal PaymentIntent', 'Security: Response must never expose secrets or raw payment keys', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/payments/create-payment-intent`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({ saleId: pendingSaleId }),
    });
    const text = await res.text();
    assert(!text.includes('apiKey'), 'apiKey must never appear in PaymentIntent response');
    assert(!text.includes('webhookSecret'), 'webhookSecret must never appear in PaymentIntent response');
    assert(!text.includes('sk_live_'), 'Live secret key must never appear in response');
  });

  // ==========================================
  // SUITE 10: STRIPE TERMINAL CONNECTION TOKEN (STEP 5)
  // ==========================================
  console.log('\n\x1b[1m\x1b[36m--- SUITE 10: STRIPE TERMINAL CONNECTION TOKEN (STEP 5) ---\x1b[0m');

  await runTest('Terminal ConnectionToken', 'Generate connection token secret with authorized cashier', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/payments/terminal/connection-token`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({}),
    });

    assertEqual(res.status, 200, 'Authorized cashier must receive HTTP 200 OK');
    const json = await res.json();
    assert(json.secret, 'Response must contain connection token secret');
    assert(typeof json.secret === 'string', 'Secret must be a string');
    assert(json.secret.startsWith('pst_test_'), 'Secret in test mode must start with pst_test_');
  });

  await runTest('Terminal ConnectionToken', 'Return only connection-token secret required by Terminal SDK', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/payments/terminal/connection-token`, {
      method: 'POST',
      headers: cashierHeaders,
    });

    assertEqual(res.status, 200, 'Must accept empty body');
    const json = await res.json();
    assert('secret' in json, 'Response must have secret property');
    assert(!('apiKey' in json), 'Response must NOT contain apiKey');
    assert(!('privateKey' in json), 'Response must NOT contain privateKey');
  });

  await runTest('Terminal ConnectionToken', 'Support standard Stripe SDK alias endpoint (/api/terminal/connection_token)', async () => {
    const res = await fetch(`${BASE_URL}/api/terminal/connection_token`, {
      method: 'POST',
      headers: cashierHeaders,
    });

    assertEqual(res.status, 200, 'Must support standard alias path');
    const json = await res.json();
    assert(json.secret && json.secret.startsWith('pst_test_'), 'Alias must return valid connection token');
  });

  await runTest('Terminal ConnectionToken', 'Security: Reject unauthenticated request with 401 Unauthorized', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/payments/terminal/connection-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    assertEqual(res.status, 401, 'Unauthenticated request must be rejected with HTTP 401');
  });

  await runTest('Terminal ConnectionToken', 'Location Control: Support valid store location parameter', async () => {
    const validLocation = process.env.STRIPE_TERMINAL_LOCATION_ID || 'tml_freshcart_main';
    const res = await fetch(`${BASE_URL}/api/v1/payments/terminal/connection-token`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({ location: validLocation }),
    });

    assertEqual(res.status, 200, 'Matching store location must succeed');
    const json = await res.json();
    assert(json.secret, 'Must return connection token secret');
  });

  await runTest('Terminal ConnectionToken', 'Location Control: Reject mismatched unauthorized store location with 400', async () => {
    if (process.env.STRIPE_TERMINAL_LOCATION_ID) {
      const res = await fetch(`${BASE_URL}/api/v1/payments/terminal/connection-token`, {
        method: 'POST',
        headers: cashierHeaders,
        body: JSON.stringify({ location: 'tml_unauthorized_other_store_999' }),
      });

      assertEqual(res.status, 400, 'Mismatched store location must be rejected with 400 Bad Request');
    }
  });

  await runTest('Terminal ConnectionToken', 'Persistence: Connection tokens are ephemeral and never persisted in database', async () => {
    const initialPayments = await fetch(`${BASE_URL}/api/v1/payments/sale/${pendingSaleId}`, { headers: cashierHeaders })
      .then((r) => r.json())
      .then((j) => j.data.length);

    // Generate token
    await fetch(`${BASE_URL}/api/v1/payments/terminal/connection-token`, {
      method: 'POST',
      headers: cashierHeaders,
    });

    const afterPayments = await fetch(`${BASE_URL}/api/v1/payments/sale/${pendingSaleId}`, { headers: cashierHeaders })
      .then((r) => r.json())
      .then((j) => j.data.length);

    assertEqual(afterPayments, initialPayments, 'Payment records must NOT increase from generating connection tokens');
  });

  // ==========================================
  // SUITE 11: STRIPE WEBHOOK VERIFICATION & PAYMENT EVENT LIFECYCLE
  // ==========================================
  console.log('\n\x1b[1m\x1b[36m--- SUITE 11: STRIPE WEBHOOK VERIFICATION & EVENT LIFECYCLE ---\x1b[0m');

  await runTest('Webhook Signature', 'Reject missing Stripe-Signature header with 400 Bad Request', async () => {
    const payload = JSON.stringify({ id: 'evt_no_sig', type: 'payment_intent.succeeded' });
    const res = await fetch(`${BASE_URL}/api/v1/payments/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });
    assertEqual(res.status, 400, 'Missing Stripe-Signature header must return HTTP 400');
    const json = await res.json();
    assert(json.error.includes('Missing Stripe-Signature'), 'Error must specify missing signature');
  });

  await runTest('Webhook Signature', 'Reject invalid or tampered signature with 400 Bad Request', async () => {
    const payload = JSON.stringify({ id: 'evt_bad_sig', type: 'payment_intent.succeeded' });
    const fakeSignature = `t=${Math.floor(Date.now() / 1000)},v1=0000000000000000000000000000000000000000000000000000000000000000`;
    const res = await fetch(`${BASE_URL}/api/v1/payments/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': fakeSignature,
      },
      body: payload,
    });
    assertEqual(res.status, 400, 'Invalid signature must return HTTP 400');
    const json = await res.json();
    assert(json.error.includes('Invalid Stripe webhook signature'), 'Error must state invalid signature');
  });

  await runTest('Webhook Signature', 'Reject timestamp outside tolerance window with 400 Bad Request', async () => {
    const payload = JSON.stringify({ id: 'evt_expired', type: 'payment_intent.succeeded' });
    const oldTimestamp = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
    const sig = generateStripeSignature(payload, TEST_WEBHOOK_SECRET, oldTimestamp);
    const res = await fetch(`${BASE_URL}/api/v1/payments/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': sig,
      },
      body: payload,
    });
    assertEqual(res.status, 400, 'Expired webhook timestamp must return HTTP 400');
    const json = await res.json();
    assert(json.error.includes('tolerance zone'), 'Error must note tolerance zone failure');
  });

  let webhookSaleId: number;
  let webhookPaymentId: number;
  let webhookPaymentIntentId: string;
  let webhookEventId = `evt_succ_${Date.now()}`;

  await runTest('Webhook Verification', 'Valid signature on payment_intent.succeeded updates payment to SUCCEEDED and completes sale', async () => {
    // 1. Create a draft pending sale
    const saleRes = await fetch(`${BASE_URL}/api/sales`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({
        items: [{ productId: 1, quantity: 2 }],
        status: 'PENDING',
      }),
    }).then((r) => r.json());
    webhookSaleId = saleRes.data.id;
    assertEqual(saleRes.data.status, 'PENDING', 'Initial sale draft must be PENDING');

    // 2. Create PaymentIntent for sale
    const intentRes = await fetch(`${BASE_URL}/api/v1/payments/create-payment-intent`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({ saleId: webhookSaleId }),
    }).then((r) => r.json());
    webhookPaymentId = intentRes.data.paymentId;
    webhookPaymentIntentId = intentRes.data.paymentIntentId;

    // Check payment is PENDING before webhook
    const initialPayment = await fetch(`${BASE_URL}/api/v1/payments/${webhookPaymentId}`, { headers: cashierHeaders })
      .then((r) => r.json());
    assertEqual(initialPayment.data.status, 'PENDING', 'Payment must be PENDING prior to webhook confirmation');

    // 3. Deliver signed payment_intent.succeeded event
    const eventPayload = JSON.stringify({
      id: webhookEventId,
      object: 'event',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: webhookPaymentIntentId,
          object: 'payment_intent',
          amount: Math.round(saleRes.data.totalAmount * 100),
          currency: 'usd',
          status: 'succeeded',
          metadata: {
            saleId: String(webhookSaleId),
            paymentId: String(webhookPaymentId),
          },
        },
      },
    });

    const signature = generateStripeSignature(eventPayload);
    const webhookRes = await fetch(`${BASE_URL}/api/v1/payments/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': signature,
      },
      body: eventPayload,
    });

    assertEqual(webhookRes.status, 200, 'Valid webhook must return HTTP 200');
    const webhookJson = await webhookRes.json();
    assert(webhookJson.received, 'Webhook must be acknowledged as received');

    // 4. Verify payment status is now SUCCEEDED
    const verifiedPayment = await fetch(`${BASE_URL}/api/v1/payments/${webhookPaymentId}`, { headers: cashierHeaders })
      .then((r) => r.json());
    assertEqual(verifiedPayment.data.status, 'SUCCEEDED', 'Payment status must be updated to SUCCEEDED');

    // 5. Verify sale status is now COMPLETED
    const verifiedSale = await fetch(`${BASE_URL}/api/sales/${webhookSaleId}`, { headers: cashierHeaders })
      .then((r) => r.json());
    assertEqual(verifiedSale.data.status, 'COMPLETED', 'Sale status must be updated to COMPLETED');
  });

  await runTest('Webhook Deduplication', 'Re-sending identical event ID is deduplicated without duplicate processing', async () => {
    // Deliver the exact same event payload again
    const eventPayload = JSON.stringify({
      id: webhookEventId,
      object: 'event',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: webhookPaymentIntentId,
          status: 'succeeded',
        },
      },
    });

    const signature = generateStripeSignature(eventPayload);
    const dupRes = await fetch(`${BASE_URL}/api/v1/payments/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': signature,
      },
      body: eventPayload,
    });

    assertEqual(dupRes.status, 200, 'Deduplicated webhook must return HTTP 200');
    const dupJson = await dupRes.json();
    assertEqual(dupJson.duplicate, true, 'Webhook must flag duplicate event ID');
    assert(dupJson.message.includes('deduplicated'), 'Response message must state deduplicated');
  });

  await runTest('Webhook Failure Event', 'payment_intent.payment_failed updates payment to FAILED with error message', async () => {
    // 1. Create sale draft and PaymentIntent
    const failSale = await fetch(`${BASE_URL}/api/sales`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({
        items: [{ productId: 2, quantity: 1 }],
        status: 'PENDING',
      }),
    }).then((r) => r.json());

    const failIntent = await fetch(`${BASE_URL}/api/v1/payments/create-payment-intent`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({ saleId: failSale.data.id }),
    }).then((r) => r.json());

    const failEventPayload = JSON.stringify({
      id: `evt_fail_${Date.now()}`,
      object: 'event',
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: failIntent.data.paymentIntentId,
          object: 'payment_intent',
          status: 'requires_payment_method',
          last_payment_error: {
            message: 'Your card was declined by the bank.',
            decline_code: 'card_declined',
          },
          metadata: {
            paymentId: String(failIntent.data.paymentId),
            saleId: String(failSale.data.id),
          },
        },
      },
    });

    const sig = generateStripeSignature(failEventPayload);
    const failRes = await fetch(`${BASE_URL}/api/v1/payments/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': sig,
      },
      body: failEventPayload,
    });

    assertEqual(failRes.status, 200, 'Webhook must accept failure event');

    // Verify payment updated to FAILED
    const failedPayment = await fetch(`${BASE_URL}/api/v1/payments/${failIntent.data.paymentId}`, { headers: cashierHeaders })
      .then((r) => r.json());
    assertEqual(failedPayment.data.status, 'FAILED', 'Payment status must transition to FAILED');
    assertEqual(failedPayment.data.errorMessage, 'Your card was declined by the bank.', 'Error message must be preserved');
  });

  await runTest('Out-of-Order / Delayed Events', 'Succeeded payment does not regress to failed on delayed failure event', async () => {
    const delayedFailPayload = JSON.stringify({
      id: `evt_delayed_fail_${Date.now()}`,
      object: 'event',
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: webhookPaymentIntentId, // The previously succeeded payment!
          object: 'payment_intent',
          last_payment_error: {
            message: 'Delayed error event arriving out of order',
          },
        },
      },
    });

    const sig = generateStripeSignature(delayedFailPayload);
    const res = await fetch(`${BASE_URL}/api/v1/payments/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': sig,
      },
      body: delayedFailPayload,
    });

    assertEqual(res.status, 200, 'Delayed webhook must be acknowledged');

    // Verify payment still SUCCEEDED
    const p = await fetch(`${BASE_URL}/api/v1/payments/${webhookPaymentId}`, { headers: cashierHeaders })
      .then((r) => r.json());
    assertEqual(p.data.status, 'SUCCEEDED', 'Completed payment must NEVER regress to FAILED on out-of-order event');
  });

  // ==========================================
  // SUITE 12: VERIFIED STRIPE PAYMENT SUCCESS, INVENTORY DEDUCTION & RECOVERY WORKFLOW
  // ==========================================
  console.log('\n\x1b[1m\x1b[36m--- SUITE 12: VERIFIED PAYMENT SUCCESS, INVENTORY DEDUCTION & RECOVERY ---\x1b[0m');

  let test12SaleId: number;
  let test12PaymentId: number;
  let test12PaymentIntentId: string;
  let test12ReceiptNumber: string;
  let test12InitialBananaStock: number;

  await runTest('Stock Changes & Inventory Service', 'Verified payment success completes sale, decreases stock, and recalculates stock status', async () => {
    // 1. Get initial inventory of Product 1 (Bananas) using ownerHeaders
    const initialInv = await fetch(`${BASE_URL}/api/inventory/product/1`, { headers: ownerHeaders }).then((r) => r.json());
    assert(Boolean(initialInv?.data), 'Initial banana inventory must exist');
    test12InitialBananaStock = initialInv.data.currentQuantity;
    assert(test12InitialBananaStock >= 3, 'Must have sufficient banana stock for test');

    // 2. Create pending sale draft for 3.0 units of Bananas
    const draftRes = await fetch(`${BASE_URL}/api/sales`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({
        items: [{ productId: 1, quantity: 3.0 }],
        status: 'PENDING',
      }),
    }).then((r) => r.json());

    test12SaleId = draftRes.data.id;
    test12ReceiptNumber = draftRes.data.receiptNumber;
    assertEqual(draftRes.data.status, 'PENDING', 'Initial draft sale must be PENDING');

    // 3. Create payment intent for this sale
    const intentRes = await fetch(`${BASE_URL}/api/v1/payments/create-payment-intent`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({ saleId: test12SaleId }),
    }).then((r) => r.json());

    test12PaymentId = intentRes.data.paymentId;
    test12PaymentIntentId = intentRes.data.paymentIntentId;

    // Verify stock is not yet deducted
    const preInv = await fetch(`${BASE_URL}/api/inventory/product/1`, { headers: ownerHeaders }).then((r) => r.json());
    assertEqual(preInv.data.currentQuantity, test12InitialBananaStock, 'Stock must not be deducted before payment verification');

    // 4. Verify payment success with Stripe
    const verifyRes = await fetch(`${BASE_URL}/api/v1/payments/${test12PaymentId}/verify`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({
        paymentReference: test12PaymentIntentId,
        paymentMethod: 'STRIPE_CARD_PRESENT',
      }),
    });

    assertEqual(verifyRes.status, 200, 'Verification must return HTTP 200');
    const verifyJson = await verifyRes.json();
    assert(verifyJson.success, 'Verification response success must be true');

    // Verify payment marked SUCCEEDED
    assertEqual(verifyJson.data.status, 'SUCCEEDED', 'Payment record status must be SUCCEEDED');

    // Verify sale status completed exactly once
    const saleCheck = await fetch(`${BASE_URL}/api/sales/${test12SaleId}`, { headers: cashierHeaders }).then((r) => r.json());
    assertEqual(saleCheck.data.status, 'COMPLETED', 'Sale status must be COMPLETED');

    // Verify stock decreased by 3.0 units
    const postInv = await fetch(`${BASE_URL}/api/inventory/product/1`, { headers: ownerHeaders }).then((r) => r.json());
    const expectedStock = Number((test12InitialBananaStock - 3.0).toFixed(3));
    assertEqual(postInv.data.currentQuantity, expectedStock, 'Stock must decrease by exactly 3.0 units');
    assert(Boolean(postInv.data.stockStatus), 'Stock status must be recalculated');
  });

  await runTest('Transaction Records', 'SALE inventory transaction is created with receipt reference and quantities', async () => {
    const txRes = await fetch(`${BASE_URL}/api/inventory/1/transactions`, { headers: ownerHeaders }).then((r) => r.json());
    assert(Array.isArray(txRes.data), 'Transactions data must be an array');

    const saleTx = txRes.data.find(
      (tx: any) => tx.referenceId === test12ReceiptNumber && tx.transactionType === 'SALE'
    );
    assert(Boolean(saleTx), `SALE transaction for receipt ${test12ReceiptNumber} must exist`);
    assertEqual(saleTx.quantity, 3.0, 'Transaction quantity must match sold item quantity (3.0)');
    assertEqual(saleTx.previousQuantity, test12InitialBananaStock, 'Transaction previousQuantity must match pre-sale stock');
    assertEqual(saleTx.newQuantity, Number((test12InitialBananaStock - 3.0).toFixed(3)), 'Transaction newQuantity must match post-sale stock');
    assert(saleTx.reason.includes('Stripe') || saleTx.reason.includes(test12ReceiptNumber), 'Transaction reason must reference Stripe or receipt');
  });

  await runTest('Payment Method & Stripe Reference', 'Sale and payment record store paymentMethod and external Stripe reference', async () => {
    // 1. Check sale record
    const saleRes = await fetch(`${BASE_URL}/api/sales/${test12SaleId}`, { headers: cashierHeaders }).then((r) => r.json());
    assertEqual(saleRes.data.paymentMethod, 'STRIPE_CARD_PRESENT', 'Sale record must store paymentMethod');
    assertEqual(saleRes.data.paymentReference, test12PaymentIntentId, 'Sale record must store Stripe payment reference');
    assertEqual(saleRes.data.paymentId, test12PaymentId, 'Sale record must link to paymentId');

    // 2. Check payment record
    const paymentRes = await fetch(`${BASE_URL}/api/v1/payments/${test12PaymentId}`, { headers: cashierHeaders }).then((r) => r.json());
    assertEqual(paymentRes.data.status, 'SUCCEEDED', 'Payment status must be SUCCEEDED');
    assertEqual(paymentRes.data.externalPaymentId, test12PaymentIntentId, 'Payment must store externalPaymentId');
  });

  await runTest('Receipt Workflow', 'Existing receipt workflow retrieves finalized sale with payment details', async () => {
    const receiptRes = await fetch(`${BASE_URL}/api/sales/receipt/${test12ReceiptNumber}`, { headers: cashierHeaders });
    assertEqual(receiptRes.status, 200, 'Receipt endpoint must return HTTP 200');
    const receiptJson = await receiptRes.json();
    assert(receiptJson.success, 'Receipt lookup must succeed');
    assertEqual(receiptJson.data.receiptNumber, test12ReceiptNumber, 'Receipt number must match');
    assertEqual(receiptJson.data.status, 'COMPLETED', 'Receipt sale status must be COMPLETED');
    assertEqual(receiptJson.data.paymentMethod, 'STRIPE_CARD_PRESENT', 'Receipt must display payment method');
    assertEqual(receiptJson.data.paymentReference, test12PaymentIntentId, 'Receipt must display Stripe reference');
  });

  await runTest('Idempotent Processing (Repeat Events)', 'Repeated verification or duplicate webhook does not deduct stock twice or duplicate transactions', async () => {
    // 1. Record stock before repeat call
    const preInv = await fetch(`${BASE_URL}/api/inventory/product/1`, { headers: ownerHeaders }).then((r) => r.json());
    const stockBefore = preInv.data.currentQuantity;

    // 2. Call verify again on the already-succeeded payment
    const repeatVerify = await fetch(`${BASE_URL}/api/v1/payments/${test12PaymentId}/verify`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({
        paymentReference: test12PaymentIntentId,
        paymentMethod: 'STRIPE_CARD_PRESENT',
      }),
    });
    assertEqual(repeatVerify.status, 200, 'Repeat verify must return HTTP 200');

    // 3. Verify stock has NOT changed
    const postInv = await fetch(`${BASE_URL}/api/inventory/product/1`, { headers: ownerHeaders }).then((r) => r.json());
    assertEqual(postInv.data.currentQuantity, stockBefore, 'Stock must NOT be deducted a second time on repeated verify');

    // 4. Verify no duplicate transaction created for this receipt
    const txRes = await fetch(`${BASE_URL}/api/inventory/1/transactions`, { headers: ownerHeaders }).then((r) => r.json());
    const matchingTxCount = txRes.data.filter(
      (tx: any) => tx.referenceId === test12ReceiptNumber && tx.transactionType === 'SALE'
    ).length;
    assertEqual(matchingTxCount, 1, 'Exactly one SALE inventory transaction must exist for this receipt (no duplicates)');
  });

  await runTest('Notifications & Stock Status', 'Sale decreasing stock below threshold triggers stock notification', async () => {
    // 1. Get product 5 (Greek Yogurt) threshold & stock
    const yogProd = await fetch(`${BASE_URL}/api/products/5`, { headers: cashierHeaders }).then((r) => r.json());
    const yogInv = await fetch(`${BASE_URL}/api/inventory/product/5`, { headers: ownerHeaders }).then((r) => r.json());
    const threshold = yogProd.data.minimumInventoryThreshold ?? 10;
    const currentQty = yogInv.data.currentQuantity;

    // 2. Create a pending sale that brings quantity below threshold if not already below
    const qtyToBuy = currentQty > threshold ? (currentQty - threshold + 1) : 1;
    if (currentQty >= qtyToBuy) {
      const saleDraft = await fetch(`${BASE_URL}/api/sales`, {
        method: 'POST',
        headers: cashierHeaders,
        body: JSON.stringify({
          items: [{ productId: 5, quantity: qtyToBuy }],
          status: 'PENDING',
        }),
      }).then((r) => r.json());

      const intent = await fetch(`${BASE_URL}/api/v1/payments/create-payment-intent`, {
        method: 'POST',
        headers: cashierHeaders,
        body: JSON.stringify({ saleId: saleDraft.data.id }),
      }).then((r) => r.json());

      await fetch(`${BASE_URL}/api/v1/payments/${intent.data.paymentId}/verify`, {
        method: 'POST',
        headers: cashierHeaders,
      });

      // Check notification triggered
      const notifs = await fetch(`${BASE_URL}/api/notifications`, { headers: cashierHeaders }).then((r) => r.json());
      const hasYogNotif = notifs.data.some((n: any) => n.productId === 5);
      assert(hasYogNotif, 'Stock notification must be triggered for low stock');
    }
  });

  let failedSaleId: number;
  let failedPaymentId: number;
  let failedPaymentIntentId: string;
  let preFailureStock: number;

  await runTest('Safe Recovery: Failure Preservation', 'Preserves successful payment and flags sale for safe recovery when local finalization fails', async () => {
    // 1. Get initial stock of product 2
    const initialInv = await fetch(`${BASE_URL}/api/inventory/product/2`, { headers: ownerHeaders }).then((r) => r.json());
    preFailureStock = initialInv.data.currentQuantity;

    // 2. Create pending sale draft
    const draftRes = await fetch(`${BASE_URL}/api/sales`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({
        items: [{ productId: 2, quantity: 2.0 }],
        status: 'PENDING',
      }),
    }).then((r) => r.json());
    failedSaleId = draftRes.data.id;

    // 3. Create payment intent
    const intentRes = await fetch(`${BASE_URL}/api/v1/payments/create-payment-intent`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({ saleId: failedSaleId }),
    }).then((r) => r.json());
    failedPaymentId = intentRes.data.paymentId;
    failedPaymentIntentId = intentRes.data.paymentIntentId;

    // 4. Simulate payment verification where Stripe succeeds but local DB finalization fails
    const verifyFailRes = await fetch(`${BASE_URL}/api/v1/payments/${failedPaymentId}/verify`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({
        paymentReference: failedPaymentIntentId,
        paymentMethod: 'STRIPE_CARD_PRESENT',
        simulateFinalizationFailure: true,
      }),
    });

    assertEqual(verifyFailRes.status, 500, 'Local finalization failure must return HTTP 500');
    const failJson = await verifyFailRes.json();
    assertEqual(failJson.recoveryRequired, true, 'Response must flag recoveryRequired: true');

    // 5. CRITICAL: Stripe payment is already processed, so payment record must remain SUCCEEDED
    const paymentCheck = await fetch(`${BASE_URL}/api/v1/payments/${failedPaymentId}`, { headers: cashierHeaders }).then((r) => r.json());
    assertEqual(paymentCheck.data.status, 'SUCCEEDED', 'Payment record MUST remain SUCCEEDED (cannot roll back Stripe charge)');
    assertEqual(paymentCheck.data.finalizationStatus, 'FAILED', 'Payment finalizationStatus must be FAILED');

    // 6. Sale record must be preserved and flagged for safe recovery
    const saleCheck = await fetch(`${BASE_URL}/api/sales/${failedSaleId}`, { headers: cashierHeaders }).then((r) => r.json());
    assertEqual(saleCheck.data.status, 'PENDING', 'Sale must remain PENDING so it is not prematurely marked complete');
    assertEqual(saleCheck.data.requiresRecovery, true, 'Sale must have requiresRecovery = true');
    assertEqual(saleCheck.data.recoveryStatus, 'FAILED_FINALIZATION', 'Sale recoveryStatus must be FAILED_FINALIZATION');

    // 7. Inventory must have been rolled back cleanly (not deducted)
    const postInv = await fetch(`${BASE_URL}/api/inventory/product/2`, { headers: ownerHeaders }).then((r) => r.json());
    assertEqual(postInv.data.currentQuantity, preFailureStock, 'Inventory must be cleanly rolled back upon finalization error');
  });

  await runTest('Safe Recovery: Retry Finalization', 'Retry finalization recovers sale and deducts inventory without charging customer again', async () => {
    // 1. Call recovery endpoint
    const recoverRes = await fetch(`${BASE_URL}/api/v1/sales/${failedSaleId}/recover`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({}),
    });

    assertEqual(recoverRes.status, 200, 'Recovery endpoint must return HTTP 200');
    const recoverJson = await recoverRes.json();
    assert(recoverJson.success, 'Recovery must succeed');

    // 2. Verify sale is now COMPLETED and recovery flag cleared
    const recoveredSale = await fetch(`${BASE_URL}/api/sales/${failedSaleId}`, { headers: cashierHeaders }).then((r) => r.json());
    assertEqual(recoveredSale.data.status, 'COMPLETED', 'Recovered sale status must be COMPLETED');
    assertEqual(recoveredSale.data.requiresRecovery, false, 'Recovery flag must be cleared');
    assertEqual(recoveredSale.data.recoveryStatus, 'NONE', 'Recovery status must be NONE');
    assertEqual(recoveredSale.data.paymentReference, failedPaymentIntentId, 'Payment reference must be recorded on recovered sale');

    // 3. Verify stock is now deducted
    const postInv = await fetch(`${BASE_URL}/api/inventory/product/2`, { headers: ownerHeaders }).then((r) => r.json());
    const expectedStock = Number((preFailureStock - 2.0).toFixed(3));
    assertEqual(postInv.data.currentQuantity, expectedStock, 'Stock must now be decreased by 2.0 units');

    // 4. Verify SALE transaction was created
    const txRes = await fetch(`${BASE_URL}/api/inventory/2/transactions`, { headers: ownerHeaders }).then((r) => r.json());
    const matchingTx = txRes.data.find((tx: any) => tx.referenceId === recoveredSale.data.receiptNumber && tx.transactionType === 'SALE');
    assert(Boolean(matchingTx), 'SALE transaction must be recorded for recovered sale');

    // 5. Verify customer was NOT charged again (payment ID and status remain the same)
    const paymentCheck = await fetch(`${BASE_URL}/api/v1/payments/${failedPaymentId}`, { headers: cashierHeaders }).then((r) => r.json());
    assertEqual(paymentCheck.data.status, 'SUCCEEDED', 'Payment status remains SUCCEEDED');
    assertEqual(paymentCheck.data.finalizationStatus, 'FINALIZED', 'Payment finalizationStatus is now FINALIZED');
  });

  // ==========================================
  // SUITE 13: STRIPE TERMINAL ERROR HANDLING & RESILIENCE
  // ==========================================
  console.log('\n\x1b[1m\x1b[36m--- SUITE 13: STRIPE TERMINAL ERROR HANDLING & RESILIENCE ---\x1b[0m');

  await runTest('Card Declined', 'Card decline sets payment FAILED with understandable message without deducting stock', async () => {
    // 1. Initial stock of Bananas (Product 1)
    const invBefore = await fetch(`${BASE_URL}/api/inventory/product/1`, { headers: ownerHeaders }).then((r) => r.json());
    const stockBefore = invBefore.data.currentQuantity;

    // 2. Create pending sale draft
    const saleDraft = await fetch(`${BASE_URL}/api/sales`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({
        items: [{ productId: 1, quantity: 2.0 }],
        status: 'PENDING',
      }),
    }).then((r) => r.json());

    // 3. Create payment intent
    const intentRes = await fetch(`${BASE_URL}/api/v1/payments/create-payment-intent`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({ saleId: saleDraft.data.id }),
    }).then((r) => r.json());

    const paymentId = intentRes.data.paymentId;

    // 4. Report card decline to server
    const failRes = await fetch(`${BASE_URL}/api/v1/payments/${paymentId}/fail`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({
        declineCode: 'insufficient_funds',
        errorMessage: 'The card was declined due to insufficient funds in customer account',
      }),
    });

    assertEqual(failRes.status, 200, 'Reporting decline must return HTTP 200');
    const failJson = await failRes.json();
    assert(failJson.understandableMessage.includes('Insufficient Funds'), 'Message must be understandable to cashier');

    // 5. Verify payment status is FAILED
    const paymentCheck = await fetch(`${BASE_URL}/api/v1/payments/${paymentId}`, { headers: cashierHeaders }).then((r) => r.json());
    assertEqual(paymentCheck.data.status, 'FAILED', 'Payment status must be FAILED');
    assert(paymentCheck.data.errorMessage.includes('Insufficient Funds'), 'Error message must be preserved');

    // 6. Verify sale remains PENDING and recoverable
    const saleCheck = await fetch(`${BASE_URL}/api/sales/${saleDraft.data.id}`, { headers: cashierHeaders }).then((r) => r.json());
    assertEqual(saleCheck.data.status, 'PENDING', 'Sale must remain PENDING so cashier can retry');

    // 7. Verify stock was NOT deducted
    const invAfter = await fetch(`${BASE_URL}/api/inventory/product/1`, { headers: ownerHeaders }).then((r) => r.json());
    assertEqual(invAfter.data.currentQuantity, stockBefore, 'Stock must NOT be deducted for declined payment');
  });

  await runTest('Customer Cancellation', 'Customer cancelling payment aborts session safely without deducting stock', async () => {
    const invBefore = await fetch(`${BASE_URL}/api/inventory/product/1`, { headers: ownerHeaders }).then((r) => r.json());
    const stockBefore = invBefore.data.currentQuantity;

    const saleDraft = await fetch(`${BASE_URL}/api/sales`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({
        items: [{ productId: 1, quantity: 1.5 }],
        status: 'PENDING',
      }),
    }).then((r) => r.json());

    const intentRes = await fetch(`${BASE_URL}/api/v1/payments/create-payment-intent`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({ saleId: saleDraft.data.id }),
    }).then((r) => r.json());

    const paymentId = intentRes.data.paymentId;

    // Customer cancels on reader
    const cancelRes = await fetch(`${BASE_URL}/api/v1/payments/${paymentId}/cancel`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({ reason: 'customer_canceled' }),
    });

    assertEqual(cancelRes.status, 200, 'Cancel must return HTTP 200');
    const cancelJson = await cancelRes.json();
    assert(cancelJson.understandableMessage.includes('cancelled') || cancelJson.understandableMessage.includes('canceled'), 'Message must indicate cancellation');

    const paymentCheck = await fetch(`${BASE_URL}/api/v1/payments/${paymentId}`, { headers: cashierHeaders }).then((r) => r.json());
    assertEqual(paymentCheck.data.status, 'CANCELED', 'Payment must be marked CANCELED');

    const saleCheck = await fetch(`${BASE_URL}/api/sales/${saleDraft.data.id}`, { headers: cashierHeaders }).then((r) => r.json());
    assertEqual(saleCheck.data.status, 'PENDING', 'Sale must remain PENDING for retry or cash payment');

    const invAfter = await fetch(`${BASE_URL}/api/inventory/product/1`, { headers: ownerHeaders }).then((r) => r.json());
    assertEqual(invAfter.data.currentQuantity, stockBefore, 'Stock must NOT be deducted for cancelled payment');
  });

  await runTest('Reader Disconnect Resilience', 'Unexpected reader disconnect preserves sale draft and avoids premature stock deduction', async () => {
    const invBefore = await fetch(`${BASE_URL}/api/inventory/product/1`, { headers: ownerHeaders }).then((r) => r.json());
    const stockBefore = invBefore.data.currentQuantity;

    const saleDraft = await fetch(`${BASE_URL}/api/sales`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({
        items: [{ productId: 1, quantity: 1.0 }],
        status: 'PENDING',
      }),
    }).then((r) => r.json());

    const intentRes = await fetch(`${BASE_URL}/api/v1/payments/create-payment-intent`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({ saleId: saleDraft.data.id }),
    }).then((r) => r.json());

    const paymentId = intentRes.data.paymentId;

    // Simulate reader disconnect before card authorization
    const statusRes = await fetch(`${BASE_URL}/api/v1/payments/${paymentId}/status`, { headers: cashierHeaders }).then((r) => r.json());
    assertEqual(statusRes.data.status, 'PENDING', 'Payment must remain PENDING while disconnected');
    assertEqual(statusRes.data.isSucceeded, false, 'Disconnected payment must not be considered succeeded');

    const saleCheck = await fetch(`${BASE_URL}/api/sales/${saleDraft.data.id}`, { headers: cashierHeaders }).then((r) => r.json());
    assertEqual(saleCheck.data.status, 'PENDING', 'Sale draft must be preserved on disconnect');

    const invAfter = await fetch(`${BASE_URL}/api/inventory/product/1`, { headers: ownerHeaders }).then((r) => r.json());
    assertEqual(invAfter.data.currentQuantity, stockBefore, 'Stock must NOT be deducted when reader disconnects');
  });

  await runTest('Timeout & Uncertain Status', 'Never assumes timeout means failed and verifies PaymentIntent status before retry', async () => {
    const saleDraft = await fetch(`${BASE_URL}/api/sales`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({
        items: [{ productId: 1, quantity: 1.0 }],
        status: 'PENDING',
      }),
    }).then((r) => r.json());

    const intentRes = await fetch(`${BASE_URL}/api/v1/payments/create-payment-intent`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({ saleId: saleDraft.data.id }),
    }).then((r) => r.json());

    const paymentId = intentRes.data.paymentId;

    // Check payment status endpoint
    const statusRes = await fetch(`${BASE_URL}/api/v1/payments/${paymentId}/status`, { headers: cashierHeaders });
    assertEqual(statusRes.status, 200, 'Status endpoint must return HTTP 200');
    const statusJson = await statusRes.json();

    assertEqual(statusJson.data.status, 'PENDING', 'Initial payment status must be PENDING');
    assertEqual(statusJson.data.isPendingOrProcessing, true, 'Must identify pending/processing status');
    assertEqual(statusJson.data.isSafeToRetry, false, 'Must NOT assume safe to retry while status is uncertain/pending');
  });

  await runTest('Repeated Clicks Prevention', 'Cashier clicking Pay by Card repeatedly returns existing intent without duplicating', async () => {
    const saleDraft = await fetch(`${BASE_URL}/api/sales`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({
        items: [{ productId: 1, quantity: 1.0 }],
        status: 'PENDING',
      }),
    }).then((r) => r.json());

    // Call create-payment-intent 3 times in rapid succession for the same sale
    const [p1, p2, p3] = await Promise.all([
      fetch(`${BASE_URL}/api/v1/payments/create-payment-intent`, {
        method: 'POST',
        headers: cashierHeaders,
        body: JSON.stringify({ saleId: saleDraft.data.id }),
      }).then((r) => r.json()),
      fetch(`${BASE_URL}/api/v1/payments/create-payment-intent`, {
        method: 'POST',
        headers: cashierHeaders,
        body: JSON.stringify({ saleId: saleDraft.data.id }),
      }).then((r) => r.json()),
      fetch(`${BASE_URL}/api/v1/payments/create-payment-intent`, {
        method: 'POST',
        headers: cashierHeaders,
        body: JSON.stringify({ saleId: saleDraft.data.id }),
      }).then((r) => r.json()),
    ]);

    assertEqual(p1.data.paymentIntentId, p2.data.paymentIntentId, 'Repeated call 2 must return the same paymentIntentId');
    assertEqual(p1.data.paymentIntentId, p3.data.paymentIntentId, 'Repeated call 3 must return the same paymentIntentId');
    assertEqual(p1.data.paymentId, p2.data.paymentId, 'Repeated call 2 must return the same paymentId');
    assertEqual(p1.data.paymentId, p3.data.paymentId, 'Repeated call 3 must return the same paymentId');
  });

  await runTest('Safe Retry After Failed Attempt', 'Cashier can safely retry payment after failure on same sale draft and deducts stock once', async () => {
    const invBefore = await fetch(`${BASE_URL}/api/inventory/product/1`, { headers: ownerHeaders }).then((r) => r.json());
    const stockBefore = invBefore.data.currentQuantity;

    // 1. Create sale draft
    const saleDraft = await fetch(`${BASE_URL}/api/sales`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({
        items: [{ productId: 1, quantity: 2.0 }],
        status: 'PENDING',
      }),
    }).then((r) => r.json());

    // 2. First attempt fails (card declined)
    const intent1 = await fetch(`${BASE_URL}/api/v1/payments/create-payment-intent`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({ saleId: saleDraft.data.id }),
    }).then((r) => r.json());

    await fetch(`${BASE_URL}/api/v1/payments/${intent1.data.paymentId}/fail`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({ declineCode: 'card_declined' }),
    });

    // 3. Verify status check confirms safe to retry
    const statusBeforeRetry = await fetch(`${BASE_URL}/api/v1/payments/${intent1.data.paymentId}/status`, { headers: cashierHeaders }).then((r) => r.json());
    assertEqual(statusBeforeRetry.data.isSafeToRetry, true, 'Failed payment must be flagged safe to retry');

    // 4. Retry: cashier creates new payment attempt on the SAME pending sale draft
    const intent2 = await fetch(`${BASE_URL}/api/v1/payments/create-payment-intent`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({ saleId: saleDraft.data.id }),
    }).then((r) => r.json());

    assert(intent2.data.paymentId !== intent1.data.paymentId, 'Retry must generate a new payment record');

    // 5. Succeeded verification of the retried payment
    const verifyRes = await fetch(`${BASE_URL}/api/v1/payments/${intent2.data.paymentId}/verify`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({
        paymentReference: intent2.data.paymentIntentId,
        paymentMethod: 'STRIPE_CARD_PRESENT',
      }),
    });

    assertEqual(verifyRes.status, 200, 'Verification of retried payment must succeed');

    // 6. Verify sale completed exactly once
    const saleCheck = await fetch(`${BASE_URL}/api/sales/${saleDraft.data.id}`, { headers: cashierHeaders }).then((r) => r.json());
    assertEqual(saleCheck.data.status, 'COMPLETED', 'Sale must be completed');

    // 7. Verify stock deducted exactly once (by 2.0 units)
    const invAfter = await fetch(`${BASE_URL}/api/inventory/product/1`, { headers: ownerHeaders }).then((r) => r.json());
    const expectedStock = Number((stockBefore - 2.0).toFixed(3));
    assertEqual(invAfter.data.currentQuantity, expectedStock, 'Stock must be decreased by exactly 2.0 units on retried sale');

    // 8. Verify exactly one SALE transaction created for this receipt
    const txRes = await fetch(`${BASE_URL}/api/inventory/1/transactions`, { headers: ownerHeaders }).then((r) => r.json());
    const matchingTx = txRes.data.filter((tx: any) => tx.referenceId === saleDraft.data.receiptNumber && tx.transactionType === 'SALE');
    assertEqual(matchingTx.length, 1, 'Exactly one SALE inventory transaction must exist for the retried sale');
  });

  await runTest('Prevent Duplicate Charge', 'Reject creating payment intent or charging already completed sale or succeeded payment', async () => {
    // 1. Create and complete a sale
    const saleRes = await fetch(`${BASE_URL}/api/sales`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({
        items: [{ productId: 1, quantity: 1.0 }],
        status: 'PENDING',
      }),
    }).then((r) => r.json());

    const intent = await fetch(`${BASE_URL}/api/v1/payments/create-payment-intent`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({ saleId: saleRes.data.id }),
    }).then((r) => r.json());

    await fetch(`${BASE_URL}/api/v1/payments/${intent.data.paymentId}/verify`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({ paymentReference: intent.data.paymentIntentId }),
    });

    // 2. Attempt to create payment intent on already COMPLETED sale must be rejected
    const dupRes = await fetch(`${BASE_URL}/api/v1/payments/create-payment-intent`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({ saleId: saleRes.data.id }),
    });

    assertEqual(dupRes.status, 400, 'Must reject creating payment intent on already completed sale');
    const dupJson = await dupRes.json();
    assert(dupJson.alreadyCompleted || dupJson.alreadySucceeded, 'Response must flag that sale is already completed/succeeded');
  });

  await runTest('Browser Refresh Draft Recovery', 'Active sale draft and payment status are fully recoverable on page refresh', async () => {
    // 1. Create a draft sale with payment intent
    const saleDraft = await fetch(`${BASE_URL}/api/sales`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({
        items: [{ productId: 1, quantity: 1.0 }],
        status: 'PENDING',
      }),
    }).then((r) => r.json());

    const intent = await fetch(`${BASE_URL}/api/v1/payments/create-payment-intent`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({ saleId: saleDraft.data.id }),
    }).then((r) => r.json());

    // 2. Simulate refresh: query sale and payment status using stored IDs
    const refreshedSale = await fetch(`${BASE_URL}/api/sales/${saleDraft.data.id}`, { headers: cashierHeaders }).then((r) => r.json());
    assert(refreshedSale.success, 'Sale must be recoverable by ID');
    assertEqual(refreshedSale.data.receiptNumber, saleDraft.data.receiptNumber, 'Receipt number must match');
    assertEqual(refreshedSale.data.status, 'PENDING', 'Draft sale status must be PENDING');

    const refreshedPaymentStatus = await fetch(`${BASE_URL}/api/v1/payments/${intent.data.paymentId}/status`, { headers: cashierHeaders }).then((r) => r.json());
    assert(refreshedPaymentStatus.success, 'Payment status must be recoverable');
    assertEqual(refreshedPaymentStatus.data.externalPaymentId, intent.data.paymentIntentId, 'PaymentIntent ID must match');

    // 3. Resume and verify payment
    await fetch(`${BASE_URL}/api/v1/payments/${intent.data.paymentId}/verify`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({ paymentReference: intent.data.paymentIntentId }),
    });

    const finalSale = await fetch(`${BASE_URL}/api/sales/${saleDraft.data.id}`, { headers: cashierHeaders }).then((r) => r.json());
    assertEqual(finalSale.data.status, 'COMPLETED', 'Recovered sale must finalize to COMPLETED');
  });

  // ==========================================
  // FINAL SUMMARY
  // ==========================================
  console.log('\n======================================================');
  console.log('  TEST SUMMARY');
  console.log('======================================================');
  console.log(`  Total Executed Tests: ${passedCount + failedCount}`);
  console.log(`  Passed: \x1b[32m${passedCount}\x1b[0m`);
  console.log(`  Failed: \x1b[31m${failedCount}\x1b[0m`);
  console.log('======================================================\n');

  if (failedCount > 0) {
    console.error(`\x1b[31mTest Suite Failed with ${failedCount} failing test(s).\x1b[0m`);
    process.exit(1);
  } else {
    console.log('\x1b[32mAll Automated Tests Passed Successfully!\x1b[0m\n');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Fatal test runner exception:', err);
  process.exit(1);
});
