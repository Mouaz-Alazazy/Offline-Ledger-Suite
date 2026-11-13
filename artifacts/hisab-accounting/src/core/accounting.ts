export type TransactionType = 'income' | 'expense';

export const LYD_MINOR_UNITS_PER_UNIT = 1_000;
export const DEFAULT_CURRENCY = 'LYD';

export interface Transaction {
  id: string;
  date: string;
  description: string;
  type: TransactionType;
  category: string;
  contact: string;
  reference: string;
  /** Amount before tax, stored as integer dirhams (1 LYD = 1,000 dirhams). */
  amountMinor: number;
  /** Tax percentage in basis points: 500 = 5%. */
  taxRateBps: number;
  taxMinor: number;
  totalMinor: number;
  createdAt: string;
  updatedAt: string;
}

export type TransactionDraft = Omit<
  Transaction,
  'id' | 'taxMinor' | 'totalMinor' | 'createdAt' | 'updatedAt'
> & {
  id?: string;
  taxMinor?: number;
  totalMinor?: number;
  createdAt?: string;
  updatedAt?: string;
};

export interface JournalEntryLine {
  account: string;
  debitMinor: number;
  creditMinor: number;
}

export interface DashboardSummary {
  incomeMinor: number;
  expenseMinor: number;
  balanceMinor: number;
  /** Net tax collected after input tax on expenses. */
  taxMinor: number;
}

export function calculateAmounts(
  amountMinor: number,
  taxRateBps: number,
): { subtotalMinor: number; taxMinor: number; totalMinor: number } {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new RangeError('المبلغ يجب أن يكون رقمًا صحيحًا غير سالب.');
  }
  if (!Number.isSafeInteger(taxRateBps) || taxRateBps < 0) {
    throw new RangeError('نسبة الضريبة غير صالحة.');
  }

  const taxResult =
    (BigInt(amountMinor) * BigInt(taxRateBps) + 5_000n) / 10_000n;
  const taxMinor = Number(taxResult);
  if (!Number.isSafeInteger(taxMinor) || !Number.isSafeInteger(amountMinor + taxMinor)) {
    throw new RangeError('قيمة المعاملة تتجاوز الحد الحسابي الآمن.');
  }
  return {
    subtotalMinor: amountMinor,
    taxMinor,
    totalMinor: amountMinor + taxMinor,
  };
}

export function buildJournalEntries(
  transaction: Transaction,
): JournalEntryLine[] {
  const { subtotalMinor, taxMinor, totalMinor } = calculateAmounts(
    transaction.amountMinor,
    transaction.taxRateBps,
  );

  if (transaction.type === 'income') {
    return [
      {
        account: 'النقدية / الصندوق',
        debitMinor: totalMinor,
        creditMinor: 0,
      },
      {
        account: 'إيرادات المبيعات',
        debitMinor: 0,
        creditMinor: subtotalMinor,
      },
      ...(taxMinor > 0
        ? [
            {
              account: 'ضريبة مخرجات مستحقة',
              debitMinor: 0,
              creditMinor: taxMinor,
            },
          ]
        : []),
    ];
  }

  return [
    {
      account: 'مصروفات التشغيل',
      debitMinor: subtotalMinor,
      creditMinor: 0,
    },
    ...(taxMinor > 0
      ? [
          {
            account: 'ضريبة مدخلات قابلة للاسترداد',
            debitMinor: taxMinor,
            creditMinor: 0,
          },
        ]
      : []),
    {
      account: 'النقدية / الصندوق',
      debitMinor: 0,
      creditMinor: totalMinor,
    },
  ];
}

export function getDashboardSummary(
  transactions: Transaction[],
): DashboardSummary {
  return transactions.reduce<DashboardSummary>(
    (summary, transaction) => {
      const { taxMinor, totalMinor } = calculateAmounts(
        transaction.amountMinor,
        transaction.taxRateBps,
      );

      if (transaction.type === 'income') {
        summary.incomeMinor += totalMinor;
        summary.taxMinor += taxMinor;
      } else {
        summary.expenseMinor += totalMinor;
        summary.taxMinor -= taxMinor;
      }
      summary.balanceMinor = summary.incomeMinor - summary.expenseMinor;
      return summary;
    },
    { incomeMinor: 0, expenseMinor: 0, balanceMinor: 0, taxMinor: 0 },
  );
}

export function formatMoney(amountMinor: number): string {
  return new Intl.NumberFormat('ar-LY', {
    style: 'currency',
    currency: DEFAULT_CURRENCY,
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(amountMinor / LYD_MINOR_UNITS_PER_UNIT);
}

export function formatDate(date: string): string {
  const parsed = new Date(`${date.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat('ar-LY', { dateStyle: 'medium' }).format(
    parsed,
  );
}

export function parseMoneyInput(value: string): number {
  const normalized = value
    .trim()
    .replace(/[٠-٩]/g, (digit) =>
      String.fromCharCode(digit.charCodeAt(0) - 0x0660 + 0x30),
    )
    .replace(/[۰-۹]/g, (digit) =>
      String.fromCharCode(digit.charCodeAt(0) - 0x06f0 + 0x30),
    )
    .replace(/[٬,]/g, '')
    .replace('٫', '.');

  const match = normalized.match(/^(\d+)(?:\.(\d{0,3}))?$/);
  if (!match) {
    throw new RangeError('أدخل مبلغًا صحيحًا حتى ثلاث خانات عشرية.');
  }

  const whole = Number(match[1]);
  const fractional = Number((match[2] ?? '').padEnd(3, '0'));
  const amountMinor = whole * LYD_MINOR_UNITS_PER_UNIT + fractional;
  if (!Number.isSafeInteger(amountMinor)) {
    throw new RangeError('المبلغ أكبر من الحد المسموح.');
  }
  return amountMinor;
}

export function generateInvoiceNumber(
  date: string,
  existingReferences: string[] = [],
): string {
  const day = date.replaceAll('-', '').slice(0, 8);
  if (!/^\d{8}$/.test(day)) {
    throw new RangeError('تاريخ الفاتورة غير صالح.');
  }

  const prefix = `INV-${day}-`;
  const usedNumbers = new Set(
    existingReferences
      .filter((reference) => reference.startsWith(prefix))
      .map((reference) => Number(reference.slice(prefix.length)))
      .filter(Number.isSafeInteger),
  );
  let sequence = 1;
  while (usedNumbers.has(sequence)) sequence += 1;
  return `${prefix}${String(sequence).padStart(3, '0')}`;
}
