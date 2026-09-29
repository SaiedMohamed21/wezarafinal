-- ══════════════════════════════════════════════════════════════════
-- ترقية 45: استرجاع تاريخ التصفية الحقيقي المفقود، عن طريق استخراجه
-- حسابيًا من عمود LiquidationStatus النصي.
--
-- السبب المكتشف (بعد فحص سكريبت الاستيراد الأصلي 30_import_fundraising
-- _licenses_2025 نفسه): وقت إعداد بيان 2025، كان فيه تاريخ تصفية حقيقي
-- لكل ترخيص، واتحسب منه نص مثل "بعد مهلة التصفية بـ 185 يوم" وكُتب في
-- LiquidationStatus - لكن سكريبت الاستيراد نقل النص المحسوب بس، ونسي
-- ينقل التاريخ الأصلي اللي اتحسب منه، ولا حتى الشهر/السنة.
--
-- الحل: التاريخ الحقيقي مش ضايع فعليًا - ممكن نرجّعه حسابيًا بمعادلة:
--   LiquidationDate = Deadline60 + عدد الأيام المذكور في النص
-- (Deadline60 = EndDate + 60 يوم، عمود محسوب أصلاً وموجود في الجدول)
--
-- ⚠️ الاسكريبت بيلمس بس التراخيص اللي:
--   • حالتها "متصفي"
--   • وتاريخ/شهر/سنة التصفية التلاتة فاضيين خالص (متأثرة بالباج فعلاً)
--   • ونصها بالظبط بالصيغة "بعد مهلة التصفية بـ N يوم"
-- أي تعديل يدوي حديث (تاريخ مُدخل فعلاً) هيفضل زي ما هو تمامًا.
-- ══════════════════════════════════════════════════════════════════
USE NGO_System;
GO

-- ─────────────────────────────────────────────────────────────────
-- الجزء (1): معاينة - التواريخ اللي هتترجع، قبل أي تعديل فعلي
-- ─────────────────────────────────────────────────────────────────
SELECT
  fl.LicID, o.OrgName, fl.LicenseNumber, fl.EndDate, fl.Deadline60,
  fl.LiquidationStatus,
  x.Days                                          AS ExtractedDays,
  DATEADD(DAY, x.Days, fl.Deadline60)             AS LiquidationDate_WillBecome,
  fl.Revenue, fl.Expenses
FROM FundraisingLicenses fl
JOIN Organizations o ON o.OrgID = fl.OrgID
CROSS APPLY (
  SELECT CAST(
    SUBSTRING(
      fl.LiquidationStatus,
      PATINDEX('%[0-9]%', fl.LiquidationStatus),
      CHARINDEX(N' يوم', fl.LiquidationStatus, PATINDEX('%[0-9]%', fl.LiquidationStatus))
        - PATINDEX('%[0-9]%', fl.LiquidationStatus)
    ) AS INT
  ) AS Days
) x
WHERE ISNULL(fl.IsDeleted,0) = 0
  AND fl.LicenseStatus = N'متصفي'
  AND fl.LiquidationDate IS NULL AND fl.LiquidationMonth IS NULL AND fl.LiquidationYear IS NULL
  AND fl.LiquidationStatus LIKE N'بعد مهلة التصفية بـ%يوم'
  AND fl.Deadline60 IS NOT NULL
ORDER BY o.OrgName;
GO

-- ─────────────────────────────────────────────────────────────────
-- الجزء (2): التصحيح الفعلي - اتشغّل بس بعد ما تراجعي المعاينة فوق
-- ─────────────────────────────────────────────────────────────────
BEGIN TRANSACTION;

UPDATE fl
SET
  LiquidationDate  = DATEADD(DAY, x.Days, fl.Deadline60),
  LiquidationMonth = MONTH(DATEADD(DAY, x.Days, fl.Deadline60)),
  LiquidationYear  = YEAR(DATEADD(DAY, x.Days, fl.Deadline60))
FROM FundraisingLicenses fl
CROSS APPLY (
  SELECT CAST(
    SUBSTRING(
      fl.LiquidationStatus,
      PATINDEX('%[0-9]%', fl.LiquidationStatus),
      CHARINDEX(N' يوم', fl.LiquidationStatus, PATINDEX('%[0-9]%', fl.LiquidationStatus))
        - PATINDEX('%[0-9]%', fl.LiquidationStatus)
    ) AS INT
  ) AS Days
) x
WHERE ISNULL(fl.IsDeleted,0) = 0
  AND fl.LicenseStatus = N'متصفي'
  AND fl.LiquidationDate IS NULL AND fl.LiquidationMonth IS NULL AND fl.LiquidationYear IS NULL
  AND fl.LiquidationStatus LIKE N'بعد مهلة التصفية بـ%يوم'
  AND fl.Deadline60 IS NOT NULL;

PRINT N'✅ تم استرجاع تاريخ التصفية الحقيقي لعدد ' + CAST(@@ROWCOUNT AS NVARCHAR(20)) + N' ترخيص.';
-- ملحوظة: مفيش تعديل هنا على NetAmount - الحارس الدائم (TRG_FundraisingLicenses_AutoFix
-- من ترقية 43) هيحسبه تلقائيًا فور ما يشوف الصفوف دي اتحدّثت.

COMMIT TRANSACTION;
GO

-- ─────────────────────────────────────────────────────────────────
-- الجزء (3): للمراجعة فقط - التراخيص "داخل مهلة التصفية" (60 يوم) اللي
-- معندهاش رقم يوم محدد في النص، فمينفعش نحسب تاريخها الدقيق حسابيًا.
-- كل اللي نعرفه أكيد: تاريخها بين EndDate و Deadline60 (بدون تحديد أي
-- يوم بالظبط جواها). محتاجة قرار منك: تسيبيها للمراجعة اليدوية (الأدق)،
-- أو تحطي ليها تاريخ تقريبي (مثلاً EndDate كحد أدنى آمن).
-- ─────────────────────────────────────────────────────────────────
SELECT
  fl.LicID, o.OrgName, fl.LicenseNumber, fl.EndDate, fl.Deadline60,
  fl.LiquidationStatus, fl.Revenue, fl.Expenses
FROM FundraisingLicenses fl
JOIN Organizations o ON o.OrgID = fl.OrgID
WHERE ISNULL(fl.IsDeleted,0) = 0
  AND fl.LicenseStatus = N'متصفي'
  AND fl.LiquidationDate IS NULL AND fl.LiquidationMonth IS NULL AND fl.LiquidationYear IS NULL
  AND fl.LiquidationStatus = N'داخل مهلة التصفية (60 يوم)'
ORDER BY o.OrgName;
GO

-- ─────────────────────────────────────────────────────────────────
-- الجزء (4): أي تراخيص "متصفي" لسه فاضية بعد كل التصحيحات السابقة (43+45)
-- ولا واحدة من الحالتين فوق - محتاجة تشخيص يدوي منفصل
-- ─────────────────────────────────────────────────────────────────
SELECT
  fl.LicID, o.OrgName, fl.LicenseNumber, fl.EndDate, fl.Deadline60,
  fl.LiquidationStatus, fl.Revenue, fl.Expenses, fl.DataType, fl.Department
FROM FundraisingLicenses fl
JOIN Organizations o ON o.OrgID = fl.OrgID
WHERE ISNULL(fl.IsDeleted,0) = 0
  AND fl.LicenseStatus = N'متصفي'
  AND fl.LiquidationDate IS NULL AND fl.LiquidationMonth IS NULL AND fl.LiquidationYear IS NULL
ORDER BY o.OrgName;
GO
