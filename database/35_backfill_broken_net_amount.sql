-- ══════════════════════════════════════════════════════════════════
-- ترقية 35: تصحيح "صافي الحصيلة" (NetAmount) للتراخيص القديمة اللي
-- اتسجّلت أو اتعدّلت وهي لسه فيها باج السيرفر (server_v18 وما قبله):
--   • أي ترخيص جديد كان بيتسجّل بصافي = 0 دايمًا (بدل NULL) حتى لو
--     حصيلته حقيقية - بغض النظر عمّا إذا الموظف/ة دخّلت صافي يدوي أصلاً.
--   • أي تعديل لاحق على الصافي من شاشة "تعديل بيانات إدارية" كان بيُقبل
--     في الواجهة لكن مايتحفظش في القاعدة خالص (عمود NetAmount كان
--     ناقص من كويري الـ UPDATE)، فالصافي كان يفضل عالق على 0 مهما
--     اتعدّل.
-- النتيجة: أي سجل صافيه = 0 بينما حصيلته أو مصروفاته مش صفر، شبه
-- مؤكد إنه ضحية الباج ده مش قيمة مقصودة فعلاً (الباج كان بيمنع أي
-- قيمة صافي حقيقية من الاستقرار في القاعدة من الأساس).
--
-- الاستخدام:
--   1) شغّلي الجزء (1) بس الأول (SELECT) وراجعي عدد/قايمة السجلات
--      اللي هتتصحح قبل أي تعديل فعلي على القاعدة.
--   2) لو الناتج مطمئن، شغّلي الجزء (2) (UPDATE) - جوه ترانزاكشن
--      وبيطبع عدد الصفوف اللي اتصحّحت فعليًا في الآخر.
-- الاسكريبت آمن يتكرر أكتر من مرة (Idempotent) - تاني مرة تشغّليه
-- مش هيغيّر حاجة لأن الشرط بيبقى مستحيل يتحقق بعد التصحيح.
-- ══════════════════════════════════════════════════════════════════
USE NGO_System;
GO

-- ── (1) معاينة فقط - شوفي اللي هيتصحح قبل أي تعديل حقيقي ──
SELECT
  f.LicID, o.OrgName, f.LicenseNumber, f.IssueYear,
  f.Revenue, f.Expenses,
  f.NetAmount            AS NetAmount_Current,
  (f.Revenue - f.Expenses) AS NetAmount_WillBecome
FROM FundraisingLicenses f
JOIN Organizations o ON f.OrgID = o.OrgID
WHERE ISNULL(f.IsDeleted,0) = 0
  AND ISNULL(f.NetAmount,0) = 0
  AND (ISNULL(f.Revenue,0) <> 0 OR ISNULL(f.Expenses,0) <> 0)
ORDER BY o.OrgName;
GO

-- ── (2) التصحيح الفعلي - اتشغّل بس بعد ما تراجعي نتيجة المعاينة فوق ──
BEGIN TRANSACTION;

UPDATE FundraisingLicenses
SET NetAmount = Revenue - Expenses
WHERE ISNULL(IsDeleted,0) = 0
  AND ISNULL(NetAmount,0) = 0
  AND (ISNULL(Revenue,0) <> 0 OR ISNULL(Expenses,0) <> 0);

PRINT N'✅ تم تصحيح صافي الحصيلة لعدد ' + CAST(@@ROWCOUNT AS NVARCHAR(20)) + N' ترخيص.';

COMMIT TRANSACTION;
GO
