# منظومة حساب

منظومة حساب تطبيق محاسبي عربي يعمل محلياً. يستخدم محرك حسابات واحداً في الويب وسطح المكتب: IndexedDB في المتصفح، وSQLite عبر Tauri 2 على سطح المكتب. لا توجد حسابات مستخدمين أو مزامنة سحابية أو بيانات تجريبية.

## ما يتضمنه التطبيق

- لوحة متابعة لإجمالي الإيرادات والمصروفات والرصيد وصافي الضريبة، مع حركة شهرية.
- سجل معاملات لإنشاء الإيرادات والمصروفات وتعديلها وحذفها والبحث فيها وتصفية النتائج.
- دفتر يومية مزدوج يولّد قيود المدين والدائن من كل معاملة.
- إنشاء رقم مرجعي تلقائي، وحساب الضريبة، وإيصالات قابلة للطباعة.
- تصدير السجل إلى CSV أو فتح تقرير/إيصال للطباعة والحفظ بصيغة PDF.
- تخزين محلي، وواجهة RTL عربية، ونسخة ويب قابلة للتشغيل دون اتصال بعد تحميلها أول مرة.

تُخزّن المبالغ كأعداد صحيحة من أجزاء الدينار الليبي (1 دينار = 1,000 درهم) لتجنّب أخطاء الكسور العشرية. تبقى بيانات الويب في ملف تعريف المتصفح، وبيانات تطبيق سطح المكتب في قاعدة SQLite على الجهاز؛ لا تتم مزامنتها تلقائياً بينهما.

## بنية الملفات

```text
src/
  App.tsx                     واجهة لوحة المتابعة والسجل واليومية والإيصالات
  core/accounting.ts          الحسابات والضرائب والقيود المزدوجة والتنسيق
  db/adapter.ts               اختيار SQLite أو IndexedDB وحفظ المعاملات
  pwa/registerOffline.ts      تسجيل عامل الخدمة للنسخة المنشورة
  index.css                   الألوان والتخطيط والطباعة والاستجابة للشاشات
  main.tsx                    نقطة تشغيل React
src-tauri/
  tauri.conf.json             إعداد نافذة Tauri والبناء وإضافة SQLite
  Cargo.toml                  تبعيات Rust الخاصة بتطبيق Tauri
  src/lib.rs                  تشغيل نافذة التطبيق وإضافة SQL
  capabilities/default.json   صلاحيات SQLite اللازمة للتطبيق
  app-icon.svg                المصدر المفتوح لأيقونة التطبيق
```

## تشغيل نسخة الويب

من جذر المشروع:

```bash
pnpm install
pnpm --filter @workspace/hisab-accounting run dev:web
```

افتح `http://localhost:5173`. بعد بناء نسخة الإنتاج وتشغيلها على عنوان ثابت عبر HTTPS، يخزّن عامل الخدمة واجهة التطبيق لتعمل دون اتصال بعد أول زيارة:

```bash
pnpm --filter @workspace/hisab-accounting run build:web
```

## تطوير تطبيق سطح المكتب

ثبّت متطلبات Tauri مرة واحدة على Ubuntu/Debian:

```bash
sudo apt update
sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev librsvg2-dev libayatana-appindicator3-dev
```

ثبّت Rust stable 1.90 أو أحدث وpnpm إذا لم يكونا مثبتين، ثم ثبّت تبعيات المشروع:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup default stable
pnpm install
```

شغّل نافذة سطح المكتب أثناء التطوير:

```bash
pnpm --filter @workspace/hisab-accounting run tauri:dev
```

ابنِ تطبيق سطح المكتب للمنصة الحالية:

```bash
pnpm --filter @workspace/hisab-accounting run tauri:build
```

تُحفظ ملفات التثبيت التنفيذية في `artifacts/hisab-accounting/src-tauri/target/release/bundle/`. يتطلب بناء Windows أو macOS تشغيل أمر البناء على نظام التشغيل المستهدف وإعداده بمتطلبات Tauri الرسمية؛ بناء Linux ينتج حزم Linux.

## تحقق سريع

```bash
pnpm --filter @workspace/hisab-accounting run typecheck
pnpm --filter @workspace/hisab-accounting run build:web
```
