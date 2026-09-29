-- ══════════════════════════════════════════════════════════════════
-- ترقية 42: تصحيح "تاريخ التصفية" (LiquidationDate) الفاضي لتراخيص
-- عندها فعلاً شهر/سنة التصفية (LiquidationMonth/LiquidationYear) مسجّلين.
--
-- السبب المكتشف: اسكريبت 38 كان بيصحح بس التراخيص اللي LiquidationYear
-- عندها NULL. لكن جزء كبير من الـ437 ترخيص (نادي هيئة تدريس الأزهر رقم
-- 171 من ضمنهم) كان الاستيراد الأصلي (30) حط له شهر/سنة التصفية من
-- الاستيراد الأول نفسه - فشرط "WHERE LiquidationYear IS NULL" في
-- اسكريبت 38 استبعدهم، وفضل عمود LiquidationDate فاضي للأبد رغم إن كل
-- بيانات التصفية التانية (الشهر/السنة/الحصيلة/الصافي) صح ومسجّلة.
--
-- الأثر: أي ترخيص من دول:
--   • بيظهر "ساري" بدل "متصفي" في فورم "تعديل بيانات إدارية" (لحد ما
--     نضيف "متصفي" لدروب داون الحالة - ده تصحيح منفصل في الواجهة)
--   • "تاريخ التصفية" فاضي في نفس الفورم
--   • بيتشال بالكامل من عدّاد "تصفيات فعلية" ومن مجموع "صافي الحصيلة"
--     في شاشة الإحصاء (اللي بتفلتر بـ liqDate في الفرونت إند)
-- رغم إنه فعلاً متصفي وحصيلته/صافيه محفوظين صح في القاعدة.
--
-- الحل: نحسب LiquidationDate من LiquidationMonth/LiquidationYear
-- الموجودين بالفعل (أول يوم في الشهر - نفس المنطق اللي استخدمه
-- اسكريبت 38 في حالاته اللي لمسها، هنا بس بنوسّع الشرط عشان يمسك
-- الحالات اللي فاتته).
--
-- ⚠️ الاسكريبت بيلمس بس التراخيص اللي:
--   • عندها LiquidationMonth و LiquidationYear مسجّلين بالفعل (مش NULL)
--   • وعمود LiquidationDate لسه فاضي (NULL)
-- يعني منضربش في أي تعديل يدوي حديث من الموظفين (لو حد دخل تاريخ
-- تصفية يدوي بالفعل، العمود مش NULL فمش هيتلمس).
--
-- الاستخدام:
--   1) شغّلي الجزء (1) بس الأول (SELECT) وراجعي عدد/قايمة السجلات
--      اللي هتتصحح قبل أي تعديل فعلي على القاعدة.
--   2) لو الناتج مطمئن، شغّلي الجزء (2) (UPDATE) - جوه ترانزاكشن
--      وبيطبع عدد الصفوف اللي اتصحّحت فعليًا في الآخر.
-- الاسكريبت آمن يتكرر أكتر من مرة (Idempotent) - تاني مرة تشغّليه مش
-- هيغيّر حاجة لأن الشرط بيبقى مستحيل يتحقق بعد التصحيح
-- (LiquidationDate مش هيبقى NULL تاني).
-- ══════════════════════════════════════════════════════════════════
USE NGO_System;
GO

-- ── (1) معاينة فقط - شوفي اللي هيتصحح قبل أي تعديل حقيقي ──
SELECT
  f.LicID, o.OrgName, f.LicenseNumber, f.IssueYear,
  f.LicenseStatus, f.LiquidationMonth, f.LiquidationYear,
  f.LiquidationDate                                   AS LiquidationDate_Current,
  DATEFROMPARTS(f.LiquidationYear, f.LiquidationMonth, 1) AS LiquidationDate_WillBecome,
  f.Revenue, f.Expenses, f.NetAmount
FROM FundraisingLicenses f
JOIN Organizations o ON f.OrgID = o.OrgID
WHERE ISNULL(f.IsDeleted,0) = 0
  AND f.LiquidationMonth IS NOT NULL
  AND f.LiquidationYear  IS NOT NULL
  AND f.LiquidationDate  IS NULL
ORDER BY o.OrgName;
GO

-- ── (2) التصحيح الفعلي - اتشغّل بس بعد ما تراجعي نتيجة المعاينة فوق ──
BEGIN TRANSACTION;

UPDATE FundraisingLicenses
SET LiquidationDate = DATEFROMPARTS(LiquidationYear, LiquidationMonth, 1)
WHERE ISNULL(IsDeleted,0) = 0
  AND LiquidationMonth IS NOT NULL
  AND LiquidationYear  IS NOT NULL
  AND LiquidationDate  IS NULL;

PRINT N'✅ تم تصحيح تاريخ التصفية لعدد ' + CAST(@@ROWCOUNT AS NVARCHAR(20)) + N' ترخيص.';

COMMIT TRANSACTION;
GO

-- ── (3) تحقق أخير - لازم يطلع 0 لو كل حاجة اتصححت صح ──
SELECT COUNT(*) AS RemainingBroken
FROM FundraisingLicenses
WHERE ISNULL(IsDeleted,0) = 0
  AND LiquidationMonth IS NOT NULL
  AND LiquidationYear  IS NOT NULL
  AND LiquidationDate  IS NULL;
GO
