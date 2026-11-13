import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Activity, ArrowDownLeft, ArrowUpLeft, BookOpen, BriefcaseBusiness, CalendarDays,
  Check, ChevronDown, CirclePlus, FileDown, FileText, LayoutDashboard,
  Pencil, Printer, ReceiptText, Search, ShieldCheck, Trash2, Wallet,
  X,
} from 'lucide-react';
import { Link, Route, Switch, useLocation } from 'wouter';
import {
  buildJournalEntries, calculateAmounts, formatDate, formatMoney,
  generateInvoiceNumber, getDashboardSummary, parseMoneyInput,
  type Transaction, type TransactionDraft, type TransactionType,
} from '@/core/accounting';
import {
  deleteTransaction, getStorageMode, initializeDatabase, listTransactions, saveTransaction,
} from '@/db/adapter';

type Page = 'dashboard' | 'ledger' | 'journal';
type FormValues = {
  date: string; description: string; type: TransactionType; category: string;
  contact: string; reference: string; amount: string; taxRate: string;
};

const navItems = [
  { href: '/', label: 'لوحة المتابعة', icon: LayoutDashboard },
  { href: '/ledger', label: 'سجل المعاملات', icon: ReceiptText },
  { href: '/journal', label: 'دفتر اليومية', icon: BookOpen },
];
const categories = ['مبيعات', 'خدمات', 'مشتريات', 'إيجار', 'رواتب', 'مرافق', 'نقل', 'أخرى'];
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const numberInput = (minor: number) => (minor / 1000).toFixed(3);

function App() {
  const [location, setLocation] = useLocation();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState('');
  const [toast, setToast] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [form, setForm] = useState<FormValues>(emptyForm());
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [selectedReceipt, setSelectedReceipt] = useState<Transaction | null>(null);
  const storageMode = getStorageMode();

  function emptyForm(type: TransactionType = 'income'): FormValues {
    return {
      date: today(), description: '', type, category: '', contact: '', reference: '',
      amount: '', taxRate: '0',
    };
  }

  async function refresh() {
    try {
      setDbError('');
      const rows = await listTransactions();
      setTransactions([...rows].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)));
    } catch {
      setDbError('تعذر قراءة السجل المحلي. أعد المحاولة.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    initializeDatabase().then(async () => {
      const rows = await listTransactions();
      if (active) {
        setTransactions([...rows].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)));
        setLoading(false);
      }
    }).catch(() => {
      if (active) { setDbError('تعذر تهيئة التخزين المحلي. أعد المحاولة.'); setLoading(false); }
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const match = location.match(/^\/receipt\/(.+)$/);
    if (match) setSelectedReceipt(transactions.find((t) => t.id === decodeURIComponent(match[1])) ?? null);
    else setSelectedReceipt(null);
  }, [location, transactions]);

  const page: Page = location === '/ledger' ? 'ledger' : location === '/journal' ? 'journal' : 'dashboard';
  const summary = useMemo(() => getDashboardSummary(transactions), [transactions]);
  const filtered = useMemo(() => transactions.filter((t) => {
    const search = query.trim().toLocaleLowerCase('ar');
    const matchesSearch = !search || [t.description, t.contact, t.reference, t.category].some((v) => v.toLocaleLowerCase('ar').includes(search));
    return matchesSearch && (typeFilter === 'all' || t.type === typeFilter)
      && (categoryFilter === 'all' || t.category === categoryFilter)
      && (!fromDate || t.date >= fromDate) && (!toDate || t.date <= toDate);
  }), [transactions, query, typeFilter, categoryFilter, fromDate, toDate]);

  function openCreate(type: TransactionType = 'income') {
    setEditing(null);
    setForm(emptyForm(type));
    setFormOpen(true);
  }

  function openEdit(t: Transaction) {
    setEditing(t);
    setForm({
      date: t.date, description: t.description, type: t.type, category: t.category,
      contact: t.contact, reference: t.reference, amount: numberInput(t.amountMinor),
      taxRate: String(t.taxRateBps / 100),
    });
    setFormOpen(true);
  }

async function submitTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let amountMinor: number;
    try {
      amountMinor = parseMoneyInput(form.amount);
    } catch {
      setToast('أدخل مبلغًا صحيحًا حتى ثلاث خانات عشرية.');
      return;
    }
    const taxRate = Number(form.taxRate);
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
      setToast('أدخل نسبة ضريبة بين صفر و100.');
      return;
    }
    const taxRateBps = Math.round(taxRate * 100);
    if (amountMinor <= 0 || !form.description.trim()) return;
    const calculated = calculateAmounts(amountMinor, taxRateBps);
    const draft: TransactionDraft = {
      ...(editing ? { id: editing.id } : {}),
      date: form.date, description: form.description.trim(), type: form.type,
      category: form.category || 'أخرى', contact: form.contact.trim(),
      reference: form.reference.trim() || generateInvoiceNumber(form.date, transactions.map((t) => t.reference)),
      amountMinor: calculated.subtotalMinor, taxRateBps, taxMinor: calculated.taxMinor,
      totalMinor: calculated.totalMinor,
    };
    try {
      await saveTransaction(draft);
      await refresh();
      setFormOpen(false);
      setToast(editing ? 'تم تحديث المعاملة وحفظها على هذا الجهاز' : 'تم حفظ المعاملة على هذا الجهاز');
    } catch {
      setToast('لم يتم الحفظ. تحقق من مساحة التخزين ثم أعد المحاولة.');
    }
  }

  async function removeTransaction(t: Transaction) {
    if (!window.confirm(`هل تريد حذف معاملة «${t.description}»؟ لا يمكن التراجع عن هذا الإجراء.`)) return;
    try {
      await deleteTransaction(t.id);
      await refresh();
      setToast('تم حذف المعاملة من السجل المحلي');
    } catch {
      setToast('تعذر حذف المعاملة. أعد المحاولة.');
    }
  }

  function exportCsv() {
    const header = ['التاريخ', 'النوع', 'الوصف', 'الفئة', 'الطرف', 'المرجع', 'المبلغ قبل الضريبة', 'الضريبة', 'الإجمالي'];
    const lines = filtered.map((t) => [
      t.date, t.type === 'income' ? 'إيراد' : 'مصروف', t.description, t.category, t.contact,
      t.reference, numberInput(t.amountMinor), numberInput(t.taxMinor), numberInput(t.totalMinor),
    ]);
    const csv = '\uFEFF' + [header, ...lines].map((r) => r.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `hisab-transactions-${today()}.csv`; anchor.click();
    URL.revokeObjectURL(url);
    setToast(`تم تصدير ${filtered.length} معاملة بصيغة CSV`);
  }

  const openPrint = (t: Transaction) => setLocation(`/receipt/${encodeURIComponent(t.id)}`);
  const closeReceipt = () => setLocation(page === 'ledger' ? '/ledger' : '/');

  return (
    <div className="app-shell" dir="rtl">
      <aside className="sidebar no-print">
        <Link href="/" className="flex items-center gap-3 px-2 text-inherit no-underline" data-testid="link-brand-home">
          <span className="brand-mark"><BriefcaseBusiness size={21} strokeWidth={1.8} /></span>
          <span>
            <strong className="block text-[17px] tracking-tight">منظومة حساب</strong>
            <span className="block text-[10px] text-white/50 mt-0.5">دفترك المالي، في مكانه</span>
          </span>
        </Link>
        <div className="mt-11 mb-3 px-3 text-[10px] font-semibold tracking-[.16em] text-white/35">مساحة العمل</div>
        <nav className="flex flex-col gap-1" aria-label="التنقل الرئيسي">
          {navItems.map(({ href, label, icon: Icon }) => (
            <Link href={href} key={href} className={`nav-link ${location === href ? 'active' : ''}`} data-testid={`nav-${href === '/' ? 'dashboard' : href.slice(1)}`}>
              <Icon size={18} strokeWidth={1.8} /><span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="mt-auto">
          <div className="rounded-xl border border-white/10 bg-white/[.045] p-4">
            <div className="flex items-center gap-2 text-[12px] font-semibold"><ShieldCheck size={16} className="text-[hsl(var(--sidebar-primary))]" />بياناتك على جهازك</div>
            <p className="mt-2 text-[11px] leading-5 text-white/55">يُحفظ كل قيد محلياً. لا يتطلب اتصالاً بالإنترنت.</p>
            <div className="mt-3 flex items-center gap-2 text-[10px] text-white/45" data-testid="status-storage-mode">
              <span className="h-1.5 w-1.5 rounded-full bg-[#91c8a3]" />
              {storageMode === 'sqlite' ? 'تخزين محلي آمن' : 'تخزين المتصفح المحلي'}
            </div>
          </div>
          <div className="mt-5 px-2 text-[10px] text-white/35">نسخة محلية · الدينار الليبي LYD</div>
        </div>
      </aside>
      <div className="main-area">
        <header className="topbar no-print">
          <div className="flex items-center gap-3">
            <span className="hidden sm:grid h-9 w-9 place-items-center rounded-lg bg-[hsl(var(--accent))] text-[hsl(var(--primary))]"><Activity size={17} /></span>
            <div><p className="text-[11px] text-[hsl(var(--muted-foreground))] mb-0.5">مساحة العمل / {pageTitle(page)}</p><h1 className="text-[15px] font-semibold">{pageTitle(page)}</h1></div>
          </div>
          <div className="flex items-center gap-3">
            <span className="storage-label flex items-center gap-2 text-[11px] text-[hsl(var(--muted-foreground))]"><span className="h-2 w-2 rounded-full bg-[#5e9b7c]" />حُفظ محلياً</span>
            <span className="hidden sm:block h-6 w-px bg-[hsl(var(--border))]" />
            <button className="btn btn-primary py-2.5" onClick={() => openCreate('income')} data-testid="button-add-transaction"><CirclePlus size={16} />قيد جديد</button>
          </div>
        </header>
        {dbError && <div className="mx-5 mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert" data-testid="status-database-error"><span>{dbError}</span><button className="btn btn-outline mr-3" onClick={() => { setLoading(true); void refresh(); }} data-testid="button-retry-database">إعادة المحاولة</button></div>}
        <Switch>
          <Route path="/receipt/:id">
            <ReceiptPage transaction={selectedReceipt} loading={loading} onClose={closeReceipt} />
          </Route>
          <Route path="/ledger">
            <LedgerPage
              transactions={filtered} loading={loading} query={query} setQuery={setQuery}
              typeFilter={typeFilter} setTypeFilter={setTypeFilter}
              categoryFilter={categoryFilter} setCategoryFilter={setCategoryFilter}
              fromDate={fromDate} setFromDate={setFromDate} toDate={toDate} setToDate={setToDate}
              openCreate={openCreate} openEdit={openEdit} remove={removeTransaction}
              exportCsv={exportCsv} print={openPrint} clearFilters={() => {
                setQuery(''); setTypeFilter('all'); setCategoryFilter('all'); setFromDate(''); setToDate('');
              }}
            />
          </Route>
          <Route path="/journal">
            <JournalPage transactions={transactions} loading={loading} />
          </Route>
          <Route path="/">
            <DashboardPage transactions={transactions} summary={summary} loading={loading} openCreate={openCreate} openLedger={() => setLocation('/ledger')} print={openPrint} />
          </Route>
          <Route>
            <DashboardPage transactions={transactions} summary={summary} loading={loading} openCreate={openCreate} openLedger={() => setLocation('/ledger')} print={openPrint} />
          </Route>
        </Switch>
        <nav className="mobile-nav no-print" aria-label="التنقل">
          {navItems.map(({ href, label, icon: Icon }) => (
            <Link href={href} key={href} className={`nav-link ${location === href ? 'active' : ''}`} data-testid={`mobile-nav-${href === '/' ? 'dashboard' : href.slice(1)}`}>
              <Icon size={19} /><span>{label}</span>
            </Link>
          ))}
        </nav>
      </div>
      {formOpen && <TransactionDialog form={form} setForm={setForm} editing={editing} onClose={() => setFormOpen(false)} onSubmit={submitTransaction} />}
      {toast && <div role="status" className="fixed bottom-24 left-5 z-[80] flex items-center gap-2 rounded-xl bg-[hsl(var(--sidebar))] px-4 py-3 text-sm text-white shadow-xl sm:bottom-6" data-testid="status-toast"><Check size={16} className="text-[#a9d4b4]" />{toast}</div>}
    </div>
  );
}

function pageTitle(page: Page) {
  return page === 'dashboard' ? 'نظرة عامة' : page === 'ledger' ? 'سجل المعاملات' : 'دفتر اليومية';
}

function DashboardPage({ transactions, summary, loading, openCreate, openLedger, print }: {
  transactions: Transaction[]; summary: ReturnType<typeof getDashboardSummary>; loading: boolean;
  openCreate: (type?: TransactionType) => void; openLedger: () => void; print: (t: Transaction) => void;
}) {
  const recent = transactions.slice(0, 5);
  const months = useMemo(() => makeMonthlyTrend(transactions), [transactions]);
  return (
    <main className="content-wrap enter">
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[11px] text-[hsl(var(--muted-foreground))]"><CalendarDays size={14} />{new Intl.DateTimeFormat('ar-LY', { dateStyle: 'full' }).format(new Date())}</div>
          <h2 className="text-[26px] font-semibold tracking-tight">أهلاً بك في حسابك</h2>
          <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">ملخص دقيق لما سُجّل على هذا الجهاز.</p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-outline" onClick={() => openCreate('expense')} data-testid="button-add-expense"><ArrowDownLeft size={16} />تسجيل مصروف</button>
          <button className="btn btn-primary" onClick={() => openCreate('income')} data-testid="button-add-income"><ArrowUpLeft size={16} />تسجيل إيراد</button>
        </div>
      </div>
      {loading ? <DashboardSkeleton /> : (
        <>
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="المؤشرات المالية">
            <StatCard label="إجمالي الإيرادات" value={summary.incomeMinor} icon={ArrowDownLeft} tone="income" testId="value-total-income" hint={`${transactions.filter((t) => t.type === 'income').length} قيد إيراد`} />
            <StatCard label="إجمالي المصروفات" value={summary.expenseMinor} icon={ArrowUpLeft} tone="expense" testId="value-total-expense" hint={`${transactions.filter((t) => t.type === 'expense').length} قيد مصروف`} />
            <StatCard label="صافي الرصيد" value={summary.balanceMinor} icon={Wallet} tone="balance" testId="value-net-balance" hint="الإيرادات ناقص المصروفات" />
            <StatCard label="صافي الضريبة المستحقة" value={summary.taxMinor} icon={FileText} tone="tax" testId="value-tax-total" hint="ضريبة الإيرادات بعد خصم ضريبة المصروفات" />
          </section>
          <section className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[1.55fr_1fr]">
            <div className="panel p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h3 className="font-semibold">حركة الإيرادات والمصروفات</h3><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">ملخص شهري حسب القيود المحفوظة</p></div>
                <div className="flex gap-4 text-[11px]">
                  <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#346f5b]" />إيرادات</span>
                  <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#d59a62]" />مصروفات</span>
                </div>
              </div>
              <TrendChart months={months} />
            </div>
            <div className="panel overflow-hidden">
              <div className="flex items-center justify-between px-5 py-5">
                <div><h3 className="font-semibold">آخر المعاملات</h3><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">أحدث ما أُضيف إلى السجل</p></div>
                <button className="btn btn-quiet text-xs" onClick={openLedger} data-testid="button-view-all-transactions">عرض السجل <ChevronDown size={14} className="rotate-90" /></button>
              </div>
              {recent.length ? <div className="divide-y divide-[hsl(var(--border))]">
                {recent.map((t) => <TransactionMini key={t.id} t={t} print={print} />)}
              </div> : <EmptyState icon={ReceiptText} title="سجلك يبدأ من هنا" detail="أضف أول معاملة لترى ملخص نشاطك المالي هنا." actionLabel="إضافة أول معاملة" onAction={() => openCreate('income')} />}
            </div>
          </section>
          <section className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1.2fr]">
            <div className="panel flex items-center justify-between gap-5 p-5">
              <div>
                <span className="mb-2 inline-flex items-center gap-2 rounded-full bg-[#e6efe9] px-2.5 py-1 text-[10px] font-semibold text-[#316b56]"><ShieldCheck size={13} />تخزين محلي</span>
                <h3 className="font-semibold">أرقامك محفوظة على جهازك</h3>
                <p className="mt-1 max-w-sm text-xs leading-5 text-[hsl(var(--muted-foreground))]">لا تعتمد منظومة حساب على اتصال بالشبكة. سجلاتك تبقى في مساحة التخزين المحلية.</p>
              </div>
              <div className="hidden h-12 w-12 shrink-0 place-items-center rounded-full bg-[hsl(var(--accent))] text-[hsl(var(--primary))] sm:grid"><ShieldCheck size={22} /></div>
            </div>
            <div className="panel flex flex-wrap items-center justify-between gap-3 p-5">
              <div><h3 className="font-semibold">توازن القيد</h3><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">تُبنى قيود اليومية تلقائياً وفق كل معاملة.</p></div>
              <Link href="/journal" className="btn btn-outline no-underline" data-testid="link-open-journal">فتح دفتر اليومية <BookOpen size={15} /></Link>
            </div>
          </section>
        </>
      )}
    </main>
  );
}

function StatCard({ label, value, icon: Icon, tone, testId, hint }: {
  label: string; value: number; icon: typeof Wallet; tone: string; testId: string; hint: string;
}) {
  return <div className="panel stat-card" data-testid={`card-${testId}`}>
    <div className="flex items-start justify-between">
      <span className="text-xs text-[hsl(var(--muted-foreground))]">{label}</span>
      <span className={`grid h-8 w-8 place-items-center rounded-lg ${tone === 'income' ? 'bg-[#e4f1eb] text-[#357760]' : tone === 'expense' ? 'bg-[#f8ebe5] text-[#b06d52]' : tone === 'tax' ? 'bg-[#f3eedb] text-[#9a8145]' : 'bg-[hsl(var(--accent))] text-[hsl(var(--primary))]'}`}><Icon size={16} /></span>
    </div>
    <div className="mono mt-4 text-[21px] font-semibold tracking-tight" data-testid={testId}>{formatMoney(value)} <span className="text-[10px] font-medium text-[hsl(var(--muted-foreground))]">د.ل</span></div>
    <div className="mt-1.5 text-[10px] text-[hsl(var(--muted-foreground))]">{hint}</div>
  </div>;
}

function makeMonthlyTrend(transactions: Transaction[]) {
  const now = new Date();
  return Array.from({ length: 6 }, (_, i) => {
    const date = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const matching = transactions.filter((t) => t.date.slice(0, 7) === key);
    return {
      label: new Intl.DateTimeFormat('ar-LY', { month: 'short' }).format(date),
      income: matching.filter((t) => t.type === 'income').reduce((sum, t) => sum + t.totalMinor, 0),
      expense: matching.filter((t) => t.type === 'expense').reduce((sum, t) => sum + t.totalMinor, 0),
    };
  });
}

function TrendChart({ months }: { months: ReturnType<typeof makeMonthlyTrend> }) {
  const hasData = months.some((month) => month.income || month.expense);
  const max = Math.max(...months.flatMap((m) => [m.income, m.expense]), 1000);
  const width = 620, height = 210, top = 15, bottom = 35;
  const plotH = height - top - bottom;
  const points = months.map((m, i) => ({ ...m, x: 48 + i * 108, iy: top + plotH - (m.income / max) * plotH, ey: top + plotH - (m.expense / max) * plotH }));
  const pathFor = (key: 'iy' | 'ey') => points.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p[key]}`).join(' ');
  return <div className="mt-5" data-testid="chart-monthly-trend">
    {hasData ? (
      <svg viewBox={`0 0 ${width} ${height}`} className="h-[220px] w-full overflow-visible" role="img" aria-label="مخطط اتجاه الإيرادات والمصروفات لآخر ستة أشهر">
        {[0, 1, 2, 3].map((i) => <line key={i} x1="28" x2="590" y1={top + (plotH / 3) * i} y2={top + (plotH / 3) * i} className="chart-grid" />)}
        {points.length > 1 && <><path d={pathFor('iy')} fill="none" stroke="#346f5b" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /><path d={pathFor('ey')} fill="none" stroke="#d59a62" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></>}
        {points.map((p, i) => <g key={i}>
          <circle cx={p.x} cy={p.iy} r="4" fill="#346f5b" stroke="hsl(var(--card))" strokeWidth="2" />
          <circle cx={p.x} cy={p.ey} r="4" fill="#d59a62" stroke="hsl(var(--card))" strokeWidth="2" />
          <text x={p.x} y={height - 9} textAnchor="middle" fill="hsl(var(--muted-foreground))" fontSize="11" fontFamily="var(--app-font-sans)">{p.label}</text>
        </g>)}
      </svg>
    ) : (
      <div className="flex h-[220px] items-center justify-center rounded-xl border border-dashed border-[hsl(var(--border))] text-center text-xs text-[hsl(var(--muted-foreground))]" data-testid="state-empty-monthly-trend">
        سيظهر اتجاه الإيرادات والمصروفات هنا بعد تسجيل أول معاملة.
      </div>
    )}
  </div>;
}

function TransactionMini({ t, print }: { t: Transaction; print: (t: Transaction) => void }) {
  const income = t.type === 'income';
  return <div className="flex items-center justify-between gap-3 px-5 py-3.5" data-testid={`recent-transaction-${t.id}`}>
    <div className="flex min-w-0 items-center gap-3">
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${income ? 'bg-[#e4f1eb] text-[#357760]' : 'bg-[#f8ebe5] text-[#b06d52]'}`}>{income ? <ArrowDownLeft size={16} /> : <ArrowUpLeft size={16} />}</span>
      <div className="min-w-0"><p className="truncate text-[12px] font-semibold">{t.description}</p><p className="mt-1 truncate text-[10px] text-[hsl(var(--muted-foreground))]">{formatDate(t.date)} · {t.category || 'أخرى'}</p></div>
    </div>
    <div className="flex shrink-0 items-center gap-1">
      <span className={`mono text-[12px] font-semibold ${income ? 'text-[#347660]' : 'text-[#af6953]'}`}>{income ? '+' : '−'}{formatMoney(t.totalMinor)}</span>
      <button className="btn btn-quiet" onClick={() => print(t)} title="طباعة الإيصال" data-testid={`button-print-recent-${t.id}`}><Printer size={14} /></button>
    </div>
  </div>;
}

function LedgerPage({ transactions, loading, query, setQuery, typeFilter, setTypeFilter, categoryFilter, setCategoryFilter, fromDate, setFromDate, toDate, setToDate, openCreate, openEdit, remove, exportCsv, print, clearFilters }: {
  transactions: Transaction[]; loading: boolean; query: string; setQuery: (v: string) => void;
  typeFilter: string; setTypeFilter: (v: string) => void; categoryFilter: string; setCategoryFilter: (v: string) => void;
  fromDate: string; setFromDate: (v: string) => void; toDate: string; setToDate: (v: string) => void;
  openCreate: (type?: TransactionType) => void; openEdit: (t: Transaction) => void; remove: (t: Transaction) => void;
  exportCsv: () => void; print: (t: Transaction) => void; clearFilters: () => void;
}) {
  const filteredIncome = transactions.filter((t) => t.type === 'income').reduce((sum, t) => sum + t.totalMinor, 0);
  const filteredExpense = transactions.filter((t) => t.type === 'expense').reduce((sum, t) => sum + t.totalMinor, 0);
  return <main className="content-wrap enter">
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 no-print">
      <div><div className="mb-2 text-[11px] text-[hsl(var(--muted-foreground))]">كل ما تم تسجيله على هذا الجهاز</div><h2 className="text-[25px] font-semibold">سجل المعاملات</h2><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">بحث، مراجعة، وتصدير قيودك المالية.</p></div>
      <div className="flex gap-2">
        <button className="btn btn-outline" onClick={exportCsv} data-testid="button-export-csv"><FileDown size={16} />تصدير CSV</button>
        <button className="btn btn-outline" onClick={() => window.print()} data-testid="button-export-pdf"><Printer size={16} />حفظ PDF</button>
        <button className="btn btn-primary" onClick={() => openCreate()} data-testid="button-ledger-add"><CirclePlus size={16} />إضافة معاملة</button>
      </div>
    </div>
    <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div className="panel flex items-center justify-between p-4"><span className="text-xs text-[hsl(var(--muted-foreground))]">معاملات ظاهرة</span><strong className="mono text-sm" data-testid="value-filtered-count">{transactions.length}</strong></div>
      <div className="panel flex items-center justify-between p-4"><span className="text-xs text-[hsl(var(--muted-foreground))]">الإيرادات الظاهرة</span><strong className="mono text-sm text-[#347660]" data-testid="value-filtered-income">{formatMoney(filteredIncome)} د.ل</strong></div>
      <div className="panel flex items-center justify-between p-4"><span className="text-xs text-[hsl(var(--muted-foreground))]">المصروفات الظاهرة</span><strong className="mono text-sm text-[#af6953]" data-testid="value-filtered-expense">{formatMoney(filteredExpense)} د.ل</strong></div>
    </div>
    <section className="panel">
      <div className="ledger-print-title">
        <h2>منظومة حساب — تقرير سجل المعاملات</h2>
        <p>تاريخ الطباعة: {formatDate(today())} · عدد المعاملات: {transactions.length}</p>
      </div>
      <div className="no-print flex flex-wrap items-center gap-2 border-b border-[hsl(var(--border))] p-4">
        <label className="relative min-w-[200px] flex-1">
          <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
          <input className="field pr-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث بالوصف أو الطرف أو المرجع" aria-label="بحث في المعاملات" data-testid="input-transaction-search" />
        </label>
        <select className="field w-auto min-w-[120px]" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="تصفية حسب النوع" data-testid="select-type-filter">
          <option value="all">كل الأنواع</option><option value="income">إيرادات</option><option value="expense">مصروفات</option>
        </select>
        <select className="field w-auto min-w-[120px]" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="تصفية حسب الفئة" data-testid="select-category-filter">
          <option value="all">كل الفئات</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <label className="flex items-center gap-2 text-[10px] text-[hsl(var(--muted-foreground))]">من<input className="field w-[145px] text-[11px]" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} aria-label="من تاريخ" data-testid="input-date-from" /></label>
        <label className="flex items-center gap-2 text-[10px] text-[hsl(var(--muted-foreground))]">إلى<input className="field w-[145px] text-[11px]" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} aria-label="إلى تاريخ" data-testid="input-date-to" /></label>
        <button className="btn btn-quiet text-xs" onClick={clearFilters} data-testid="button-clear-filters"><X size={14} />مسح</button>
      </div>
      {loading ? <TableSkeleton /> : transactions.length ? <div className="table-wrap">
        <table className="ledger-table">
          <thead><tr><th>التاريخ</th><th>الوصف / المرجع</th><th>الفئة</th><th>الطرف</th><th>النوع</th><th>الإجمالي</th><th className="no-print">إجراءات</th></tr></thead>
          <tbody>{transactions.map((t) => <LedgerRow key={t.id} t={t} openEdit={openEdit} remove={remove} print={print} />)}</tbody>
        </table>
      </div> : <EmptyState icon={Search} title={query || typeFilter !== 'all' || categoryFilter !== 'all' || fromDate || toDate ? 'لا توجد نتائج مطابقة' : 'لا توجد معاملات بعد'} detail={query || typeFilter !== 'all' || categoryFilter !== 'all' || fromDate || toDate ? 'جرّب تعديل البحث أو إزالة بعض عوامل التصفية.' : 'ابدأ بإضافة أول إيراد أو مصروف إلى سجلك.'} actionLabel={query || typeFilter !== 'all' || categoryFilter !== 'all' || fromDate || toDate ? 'إزالة التصفية' : 'إضافة معاملة'} onAction={query || typeFilter !== 'all' || categoryFilter !== 'all' || fromDate || toDate ? clearFilters : () => openCreate()} />}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[hsl(var(--border))] px-5 py-3 text-[10px] text-[hsl(var(--muted-foreground))]">
        <span>تُعرض النتائج وفق عوامل التصفية الحالية.</span><span className="mono">{transactions.length} معاملة</span>
      </div>
    </section>
  </main>;
}

function LedgerRow({ t, openEdit, remove, print }: { t: Transaction; openEdit: (t: Transaction) => void; remove: (t: Transaction) => void; print: (t: Transaction) => void }) {
  return <tr data-testid={`row-transaction-${t.id}`}>
    <td className="whitespace-nowrap text-[hsl(var(--muted-foreground))]" data-testid={`date-transaction-${t.id}`}>{formatDate(t.date)}</td>
    <td><div className="font-semibold" data-testid={`description-transaction-${t.id}`}>{t.description}</div><div className="mono mt-1 text-[10px] text-[hsl(var(--muted-foreground))]">{t.reference || '—'}</div></td>
    <td><span className="rounded-md bg-[hsl(var(--muted))] px-2 py-1 text-[10px]">{t.category || 'أخرى'}</span></td>
    <td className="text-[hsl(var(--muted-foreground))]">{t.contact || '—'}</td>
    <td><span className={`badge ${t.type === 'income' ? 'badge-income' : 'badge-expense'}`}>{t.type === 'income' ? 'إيراد' : 'مصروف'}</span></td>
    <td className={`mono whitespace-nowrap font-semibold ${t.type === 'income' ? 'text-[#347660]' : 'text-[#af6953]'}`} data-testid={`amount-transaction-${t.id}`}>{formatMoney(t.totalMinor)} د.ل</td>
    <td className="no-print"><div className="flex items-center gap-0.5">
      <button className="btn btn-quiet" title="طباعة الإيصال" onClick={() => print(t)} data-testid={`button-print-${t.id}`}><Printer size={15} /></button>
      <button className="btn btn-quiet" title="تعديل" onClick={() => openEdit(t)} data-testid={`button-edit-${t.id}`}><Pencil size={15} /></button>
      <button className="btn btn-quiet hover:text-red-600" title="حذف" onClick={() => remove(t)} data-testid={`button-delete-${t.id}`}><Trash2 size={15} /></button>
    </div></td>
  </tr>;
}

function JournalPage({ transactions, loading }: { transactions: Transaction[]; loading: boolean }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [, setLocation] = useLocation();
  const allLines = useMemo(() => transactions.map((t) => ({ t, lines: buildJournalEntries(t) })), [transactions]);
  return <main className="content-wrap enter">
    <div className="mb-6"><div className="mb-2 text-[11px] text-[hsl(var(--muted-foreground))]">القيد المزدوج لكل معاملة</div><h2 className="text-[25px] font-semibold">دفتر اليومية</h2><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">كل مبلغ مدين يقابله مبلغ دائن؛ لتبقى حساباتك متوازنة.</p></div>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#d6e5db] bg-[#e9f1eb] p-4 text-[#2f644f]">
      <div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-lg bg-white/70"><Check size={18} /></span><div><strong className="block text-sm">القيود متوازنة تلقائياً</strong><span className="mt-1 block text-[11px] opacity-75">يتم إنشاء الطرفين المحاسبيين من بيانات كل معاملة محفوظة.</span></div></div>
      <span className="text-[11px] font-semibold">{transactions.length} قيد</span>
    </div>
    {loading ? <TableSkeleton /> : allLines.length ? <div className="space-y-3">
      {allLines.map(({ t, lines }) => {
        const isOpen = expanded === t.id;
        const debit = lines.reduce((sum, line) => sum + line.debitMinor, 0);
        const credit = lines.reduce((sum, line) => sum + line.creditMinor, 0);
        return <section className="panel overflow-hidden" key={t.id} data-testid={`journal-entry-${t.id}`}>
          <button className="flex w-full items-center justify-between gap-4 p-5 text-right" onClick={() => setExpanded(isOpen ? null : t.id)} aria-expanded={isOpen} data-testid={`button-expand-journal-${t.id}`}>
            <div className="flex min-w-0 items-center gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[hsl(var(--accent))] text-[hsl(var(--primary))]"><BookOpen size={18} /></span><div className="min-w-0"><div className="truncate text-sm font-semibold">{t.description}</div><div className="mt-1 text-[10px] text-[hsl(var(--muted-foreground))]">{formatDate(t.date)} · {t.reference || 'بلا مرجع'}</div></div></div>
            <div className="flex items-center gap-4">
              <span className="hidden text-left sm:block"><small className="block text-[10px] text-[hsl(var(--muted-foreground))]">مدين = دائن</small><strong className="mono mt-1 block text-xs">{formatMoney(debit)} د.ل</strong></span>
              <span className="rounded-full bg-[#e5f0e9] px-2.5 py-1 text-[10px] font-semibold text-[#39745d]">متوازن</span>
              <ChevronDown size={16} className={`text-[hsl(var(--muted-foreground))] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </div>
          </button>
          {isOpen && <div className="border-t border-[hsl(var(--border))] p-4 sm:p-5">
            <div className="mb-3 text-xs text-[hsl(var(--muted-foreground))]">تفاصيل القيد المزدوج</div>
            <div className="table-wrap"><table className="ledger-table min-w-[550px]">
              <thead><tr><th>الحساب</th><th>مدين</th><th>دائن</th></tr></thead>
              <tbody>{lines.map((line, i) => <tr key={`${line.account}-${i}`} data-testid={`journal-line-${t.id}-${i}`}><td className="font-medium">{line.account}</td><td className="mono">{line.debitMinor ? `${formatMoney(line.debitMinor)} د.ل` : '—'}</td><td className="mono">{line.creditMinor ? `${formatMoney(line.creditMinor)} د.ل` : '—'}</td></tr>)}</tbody>
              <tfoot><tr className="bg-[hsl(var(--muted))] font-semibold"><td className="p-4">الإجمالي</td><td className="mono p-4">{formatMoney(debit)} د.ل</td><td className="mono p-4">{formatMoney(credit)} د.ل</td></tr></tfoot>
            </table></div>
            <div className="mt-3 flex items-center justify-between text-[10px] text-[hsl(var(--muted-foreground))]"><span>فارق التوازن</span><strong className="mono text-[#39745d]" data-testid={`journal-balance-${t.id}`}>{formatMoney(Math.abs(debit - credit))} د.ل</strong></div>
          </div>}
        </section>;
      })}
    </div> : <EmptyState icon={BookOpen} title="دفتر اليومية فارغ" detail="ستظهر القيود المحاسبية هنا تلقائياً بعد تسجيل المعاملات." actionLabel="الانتقال إلى السجل" onAction={() => setLocation('/ledger')} />}
  </main>;
}

function ReceiptPage({ transaction, loading, onClose }: { transaction: Transaction | null; loading: boolean; onClose: () => void }) {
  useEffect(() => {
    if (transaction) document.title = `إيصال ${transaction.reference || ''} — منظومة حساب`;
    return () => { document.title = 'منظومة حساب'; };
  }, [transaction]);
  return <main className="content-wrap enter">
    <div className="no-print mb-5 flex items-center justify-between">
      <div><h2 className="text-xl font-semibold">معاينة الإيصال</h2><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">جاهز للطباعة أو الحفظ بصيغة PDF.</p></div>
      <div className="flex gap-2"><button className="btn btn-outline" onClick={onClose} data-testid="button-close-receipt"><X size={15} />إغلاق</button><button className="btn btn-primary" onClick={() => window.print()} data-testid="button-print-receipt"><Printer size={15} />طباعة</button></div>
    </div>
    {loading || !transaction ? <div className="panel p-10 text-center text-sm text-[hsl(var(--muted-foreground))]" data-testid="status-receipt-empty">لم يتم العثور على الإيصال المطلوب.</div> : <article className="print-sheet panel mx-auto max-w-[760px] p-7 sm:p-12" data-testid="receipt-print-view">
      <header className="flex items-start justify-between border-b-2 border-[hsl(var(--primary))] pb-6">
        <div className="flex items-center gap-3"><span className="brand-mark print:hidden"><BriefcaseBusiness size={20} /></span><div><h1 className="text-xl font-bold">منظومة حساب</h1><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">إيصال معاملة مالية</p></div></div>
        <div className="text-left"><span className={`badge ${transaction.type === 'income' ? 'badge-income' : 'badge-expense'}`}>{transaction.type === 'income' ? 'إيصال قبض' : 'إيصال صرف'}</span><div className="mono mt-3 text-xs">{transaction.reference || '—'}</div></div>
      </header>
      <div className="my-7 grid grid-cols-2 gap-4 text-sm">
        <div><p className="text-[10px] text-[hsl(var(--muted-foreground))]">التاريخ</p><p className="mt-1 font-semibold">{formatDate(transaction.date)}</p></div>
        <div><p className="text-[10px] text-[hsl(var(--muted-foreground))]">الطرف</p><p className="mt-1 font-semibold">{transaction.contact || '—'}</p></div>
        <div><p className="text-[10px] text-[hsl(var(--muted-foreground))]">البيان</p><p className="mt-1 font-semibold">{transaction.description}</p></div>
        <div><p className="text-[10px] text-[hsl(var(--muted-foreground))]">الفئة</p><p className="mt-1 font-semibold">{transaction.category || 'أخرى'}</p></div>
      </div>
      <div className="overflow-hidden rounded-xl border border-[hsl(var(--border))]">
        <div className="flex justify-between border-b border-[hsl(var(--border))] px-4 py-3 text-xs"><span>المبلغ قبل الضريبة</span><span className="mono">{formatMoney(transaction.amountMinor)} د.ل</span></div>
        <div className="flex justify-between border-b border-[hsl(var(--border))] px-4 py-3 text-xs"><span>الضريبة ({(transaction.taxRateBps / 100).toFixed(2)}٪)</span><span className="mono">{formatMoney(transaction.taxMinor)} د.ل</span></div>
        <div className="flex justify-between bg-[hsl(var(--muted))] px-4 py-4 text-sm font-bold"><span>الإجمالي</span><span className="mono" data-testid="receipt-total">{formatMoney(transaction.totalMinor)} د.ل</span></div>
      </div>
      <footer className="mt-12 border-t border-dashed border-[hsl(var(--border))] pt-4 text-center text-[10px] text-[hsl(var(--muted-foreground))]">حُرر هذا الإيصال من منظومة حساب · نسخة محفوظة محلياً</footer>
    </article>}
  </main>;
}

function TransactionDialog({ form, setForm, editing, onClose, onSubmit }: {
  form: FormValues; setForm: (form: FormValues) => void; editing: Transaction | null;
  onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  let amountMinor = 0;
  try {
    amountMinor = parseMoneyInput(form.amount || '0');
  } catch {
    amountMinor = 0;
  }
  const taxRate = Number(form.taxRate || 0);
  const calculated = calculateAmounts(
    amountMinor,
    Number.isFinite(taxRate) && taxRate >= 0 ? Math.round(taxRate * 100) : 0,
  );
  const update = (key: keyof FormValues, value: string) => setForm({ ...form, [key]: value });
  return <div className="dialog-backdrop no-print" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <form className="dialog" onSubmit={onSubmit} aria-labelledby="transaction-dialog-title" data-testid="form-transaction">
      <div className="mb-6 flex items-start justify-between">
        <div><div className="mb-2 text-[10px] font-semibold tracking-wide text-[hsl(var(--primary))]">{editing ? 'تعديل قيد محفوظ' : 'قيد جديد'}</div><h2 id="transaction-dialog-title" className="text-xl font-semibold">{editing ? 'تحديث المعاملة' : 'تسجيل معاملة'}</h2><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">ستُحفظ البيانات محلياً على هذا الجهاز.</p></div>
        <button type="button" className="btn btn-quiet" onClick={onClose} aria-label="إغلاق" data-testid="button-close-transaction-form"><X size={18} /></button>
      </div>
      <div className="mb-5 grid grid-cols-2 gap-2 rounded-xl bg-[hsl(var(--muted))] p-1">
        <button type="button" className={`rounded-lg py-2.5 text-xs font-semibold ${form.type === 'income' ? 'bg-[hsl(var(--card))] text-[#347660] shadow-sm' : 'text-[hsl(var(--muted-foreground))]'}`} onClick={() => update('type', 'income')} data-testid="button-type-income"><ArrowDownLeft size={14} className="ml-1 inline" />إيراد</button>
        <button type="button" className={`rounded-lg py-2.5 text-xs font-semibold ${form.type === 'expense' ? 'bg-[hsl(var(--card))] text-[#af6953] shadow-sm' : 'text-[hsl(var(--muted-foreground))]'}`} onClick={() => update('type', 'expense')} data-testid="button-type-expense"><ArrowUpLeft size={14} className="ml-1 inline" />مصروف</button>
      </div>
      <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
        <label className="sm:col-span-2 text-xs font-medium">وصف المعاملة <span className="text-red-600">*</span><input className="field mt-2" required value={form.description} onChange={(e) => update('description', e.target.value)} placeholder="مثال: دفعة عن خدمات شهرية" data-testid="input-transaction-description" /></label>
        <label className="text-xs font-medium">المبلغ قبل الضريبة (د.ل)<input className="field mono mt-2" required type="number" min="0.001" step="0.001" value={form.amount} onChange={(e) => update('amount', e.target.value)} placeholder="0.000" data-testid="input-transaction-amount" /></label>
        <label className="text-xs font-medium">التاريخ<input className="field mt-2" required type="date" value={form.date} onChange={(e) => update('date', e.target.value)} data-testid="input-transaction-date" /></label>
        <label className="text-xs font-medium">الفئة<select className="field mt-2" value={form.category} onChange={(e) => update('category', e.target.value)} data-testid="select-transaction-category"><option value="">اختر الفئة</option>{categories.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="text-xs font-medium">الضريبة (%)<input className="field mono mt-2" type="number" min="0" max="100" step="0.01" value={form.taxRate} onChange={(e) => update('taxRate', e.target.value)} data-testid="input-transaction-tax" /></label>
        <label className="text-xs font-medium">الطرف / الجهة<input className="field mt-2" value={form.contact} onChange={(e) => update('contact', e.target.value)} placeholder="اختياري" data-testid="input-transaction-contact" /></label>
        <label className="text-xs font-medium">رقم المرجع<input className="field mt-2" value={form.reference} onChange={(e) => update('reference', e.target.value)} placeholder="يُنشأ تلقائياً إن تُرك فارغاً" data-testid="input-transaction-reference" /></label>
      </div>
      <div className="mt-5 rounded-xl bg-[hsl(var(--muted))] p-4">
        <div className="flex justify-between text-[11px] text-[hsl(var(--muted-foreground))]"><span>قيمة الضريبة التقديرية</span><span className="mono">{formatMoney(calculated.taxMinor)} د.ل</span></div>
        <div className="mt-2 flex justify-between text-sm font-semibold"><span>الإجمالي</span><span className="mono" data-testid="value-form-total">{formatMoney(calculated.totalMinor)} د.ل</span></div>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" className="btn btn-outline" onClick={onClose} data-testid="button-cancel-transaction">إلغاء</button>
        <button type="submit" className="btn btn-primary min-w-[135px]" data-testid="button-save-transaction"><Check size={15} />{editing ? 'حفظ التعديلات' : 'حفظ المعاملة'}</button>
      </div>
    </form>
  </div>;
}

function EmptyState({ icon: Icon, title, detail, actionLabel, onAction }: {
  icon: typeof ReceiptText; title: string; detail: string; actionLabel?: string; onAction?: () => void;
}) {
  return <div className="flex flex-col items-center px-5 py-12 text-center" data-testid="state-empty">
    <span className="mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))] text-[hsl(var(--primary))]"><Icon size={23} strokeWidth={1.7} /></span>
    <h3 className="text-sm font-semibold">{title}</h3><p className="mt-2 max-w-xs text-xs leading-5 text-[hsl(var(--muted-foreground))]">{detail}</p>
    {actionLabel && onAction && <button className="btn btn-outline mt-5" onClick={onAction} data-testid="button-empty-action">{actionLabel}<ArrowUpLeft size={14} /></button>}
  </div>;
}

function DashboardSkeleton() {
  return <div className="animate-pulse" data-testid="status-dashboard-loading"><div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <div key={i} className="panel h-[145px] bg-[hsl(var(--muted))]" />)}</div><div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[1.55fr_1fr]"><div className="panel h-[320px] bg-[hsl(var(--muted))]" /><div className="panel h-[320px] bg-[hsl(var(--muted))]" /></div></div>;
}

function TableSkeleton() {
  return <div className="space-y-3 p-5" data-testid="status-table-loading">{Array.from({ length: 5 }, (_, i) => <div className="h-10 animate-pulse rounded-lg bg-[hsl(var(--muted))]" key={i} />)}</div>;
}

export default App;
