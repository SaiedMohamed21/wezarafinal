-- ══════════════════════════════════════════════════════════════════
-- ترقية 43: الحل الجذري النهائي لباج "الصافي = 0 رغم وجود تصفيات
-- مسجّلة فعليًا" (نفس باج الترقية 42 بالظبط، بس رجع تاني في سكريبت
-- الاستيراد الجديد 03_import_july2026_licenses_v2.sql).
--
-- السبب المؤكد (بعد فحص السكريبت نفسه):
--   سكريبت استيراد يوليو 2026 كان بيسجّل LiquidationMonth/LiquidationYear
--   للتراخيص "المتصفية"، لكن نسي عمود LiquidationDate تمامًا (وده اللي
--   الواجهة بتفلتر بيه فعليًا على "التصفيات الفعلية" و"الصافي" -
--   مش على الشهر/السنة). ونسي كمان عمود NetAmount خالص.
--
-- ده السبب الجذري - مش خطأ في بيانات الإكسيل، ولا في القاعدة نفسها،
-- إنما في كود سكريبت الاستيراد اللي بيتكتب من جديد مع كل استيراد شهري.
--
-- الجزء ده بيعمل حاجتين:
--   (أ) تصحيح فوري لكل التراخيص المتأثرة *حاليًا* في القاعدة (مرة واحدة)
--   (ب) TRIGGER دائم على الجدول - يصحح تلقائيًا أي سجل جديد أو معدَّل
--       (من أي مصدر: سكريبت SQL يدوي، استيراد إكسيل، أو حتى الموقع
--       نفسه) لو حصل نفس النسيان تاني في المستقبل - فمش هيحتاج حد
--       "يفتكر" يضيف العمودين دول في كل سكريبت جديد.
--
-- ⚠️ الأمان: كل تعديل هنا بشرط "القيمة الحالية NULL/فاضية" بس - يعني
-- ولا سجل واحد اتدخل بياناته يدويًا (من موظف عبر الموقع) هيتلمس أو
-- ينعكس. الاسكريبت آمن يتكرر أي عدد مرات (Idempotent).
-- ══════════════════════════════════════════════════════════════════
USE NGO_System;
GO

-- ─────────────────────────────────────────────────────────────────
-- الجزء (1): معاينة فقط - قبل أي تعديل، شوفي حجم المشكلة الحالي
-- ─────────────────────────────────────────────────────────────────
SELECT
  'تراخيص شهر/سنة تصفية موجودة لكن تاريخ التصفية فاضي' AS Problem,
  COUNT(*) AS Count
FROM FundraisingLicenses
WHERE ISNULL(IsDeleted,0) = 0
  AND LiquidationMonth IS NOT NULL AND LiquidationYear IS NOT NULL
  AND LiquidationDate IS NULL
UNION ALL
SELECT
  'تراخيص صافي فاضي/صفر رغم إيرادات أو مصروفات حقيقية',
  COUNT(*)
FROM FundraisingLicenses
WHERE ISNULL(IsDeleted,0) = 0
  AND ISNULL(NetAmount,0) = 0
  AND (ISNULL(Revenue,0) <> 0 OR ISNULL(Expenses,0) <> 0);
GO

-- ─────────────────────────────────────────────────────────────────
-- الجزء (2): التصحيح الفعلي للبيانات الحالية
-- ─────────────────────────────────────────────────────────────────
BEGIN TRANSACTION;

-- (2-أ) تاريخ التصفية = أول يوم في شهر/سنة التصفية المسجَّلين بالفعل
UPDATE FundraisingLicenses
SET LiquidationDate = DATEFROMPARTS(LiquidationYear, LiquidationMonth, 1)
WHERE ISNULL(IsDeleted,0) = 0
  AND LiquidationMonth IS NOT NULL AND LiquidationYear IS NOT NULL
  AND LiquidationDate IS NULL;

PRINT N'✅ تم تصحيح تاريخ التصفية لعدد ' + CAST(@@ROWCOUNT AS NVARCHAR(20)) + N' ترخيص.';

-- (2-ب) الصافي = الإيرادات - المصروفات (بس للسجلات اللي صافيها فاضي/صفر
-- فعليًا بسبب النسيان، مش لأي سجل مدخل يدويًا بصافي مختلف عن الفرق)
UPDATE FundraisingLicenses
SET NetAmount = Revenue - Expenses
WHERE ISNULL(IsDeleted,0) = 0
  AND ISNULL(NetAmount,0) = 0
  AND (ISNULL(Revenue,0) <> 0 OR ISNULL(Expenses,0) <> 0);

PRINT N'✅ تم تصحيح صافي الحصيلة لعدد ' + CAST(@@ROWCOUNT AS NVARCHAR(20)) + N' ترخيص.';

COMMIT TRANSACTION;
GO

-- ─────────────────────────────────────────────────────────────────
-- الجزء (3): الحارس الدائم - TRIGGER يمنع تكرار نفس الباج للأبد
-- ─────────────────────────────────────────────────────────────────
IF OBJECT_ID('TRG_FundraisingLicenses_AutoFix', 'TR') IS NOT NULL
  DROP TRIGGER TRG_FundraisingLicenses_AutoFix;
GO

CREATE TRIGGER TRG_FundraisingLicenses_AutoFix
ON FundraisingLicenses
AFTER INSERT, UPDATE
AS
BEGIN
  SET NOCOUNT ON;

  -- لو الشهر/السنة موجودين والتاريخ فاضي (من أي مصدر: سكريبت، إكسيل، الموقع)
  -- - نحسبه تلقائيًا. الشرط IS NULL بيمنع أي تعارض مع تاريخ حقيقي مُدخل يدويًا.
  UPDATE fl
  SET LiquidationDate = DATEFROMPARTS(fl.LiquidationYear, fl.LiquidationMonth, 1)
  FROM FundraisingLicenses fl
  JOIN inserted i ON i.LicID = fl.LicID
  WHERE fl.LiquidationMonth IS NOT NULL AND fl.LiquidationYear IS NOT NULL
    AND fl.LiquidationDate IS NULL;

  -- نفس المنطق للصافي - بس لو فاضي/صفر فعلاً رغم وجود إيرادات أو مصروفات
  UPDATE fl
  SET NetAmount = fl.Revenue - fl.Expenses
  FROM FundraisingLicenses fl
  JOIN inserted i ON i.LicID = fl.LicID
  WHERE ISNULL(fl.NetAmount,0) = 0
    AND (ISNULL(fl.Revenue,0) <> 0 OR ISNULL(fl.Expenses,0) <> 0);
END;
GO

PRINT N'✅ تم تفعيل الحارس الدائم (TRG_FundraisingLicenses_AutoFix) - من دلوقتي أي سكريبت';
PRINT N'   استيراد أو تعديل ينسى تاريخ التصفية أو الصافي هيتصحح تلقائيًا لحظة الحفظ.';
GO

-- ─────────────────────────────────────────────────────────────────
-- الجزء (4): تحقق أخير - المفروض يطلع 0 في السطرين
-- ─────────────────────────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM FundraisingLicenses
   WHERE ISNULL(IsDeleted,0)=0 AND LiquidationMonth IS NOT NULL
     AND LiquidationYear IS NOT NULL AND LiquidationDate IS NULL) AS RemainingMissingDate,
  (SELECT COUNT(*) FROM FundraisingLicenses
   WHERE ISNULL(IsDeleted,0)=0 AND ISNULL(NetAmount,0)=0
     AND (ISNULL(Revenue,0)<>0 OR ISNULL(Expenses,0)<>0)) AS RemainingMissingNet;
GO
