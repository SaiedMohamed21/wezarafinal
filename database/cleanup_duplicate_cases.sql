-- ══════════════════════════════════════════════════════════════════
-- تنظيف: توحيد الحالات المكررة (18 حالة) - كل حالة ترجع سطر واحد بس
-- الاستراتيجية: نسيب السطر اللي فيه أحدث قرار (أعلى DecisionDate) لكل CaseCode،
-- ونحذف الباقي. نص القرار الكامل (بكل التجديدات) محفوظ أصلاً في DecisionText
-- في كل الأسطر بالتساوي - فمفيش أي معلومة هتضيع.
-- ══════════════════════════════════════════════════════════════════
USE NGO_System;
GO

-- ═══ خطوة 1: معاينة فقط - إيه اللي هيتحذف بالظبط (قبل أي تنفيذ فعلي) ═══
PRINT N'── الأسطر اللي هتتحذف (معاينة فقط) ──';
;WITH ranked AS (
  SELECT CaseID, CaseCode, CaseName, DecisionNumber, DecisionDate,
         ROW_NUMBER() OVER (PARTITION BY CaseCode ORDER BY DecisionDate DESC, CaseID DESC) AS rn
  FROM AdminCases
  WHERE CaseCode IN (
    SELECT CaseCode FROM AdminCases WHERE CaseCode IS NOT NULL GROUP BY CaseCode HAVING COUNT(*) > 1
  )
)
SELECT CaseID, CaseCode, CaseName, DecisionNumber, DecisionDate,
       CASE WHEN rn=1 THEN N'✅ هيفضل (أحدث قرار)' ELSE N'🗑️ هيتحذف' END AS Action
FROM ranked
ORDER BY CaseCode, rn;
GO

-- ═══ خطوة 2: التنفيذ الفعلي - حذف الأسطر الزيادة بس ═══
;WITH ranked AS (
  SELECT CaseID, CaseCode,
         ROW_NUMBER() OVER (PARTITION BY CaseCode ORDER BY DecisionDate DESC, CaseID DESC) AS rn
  FROM AdminCases
  WHERE CaseCode IN (
    SELECT CaseCode FROM AdminCases WHERE CaseCode IS NOT NULL GROUP BY CaseCode HAVING COUNT(*) > 1
  )
)
DELETE FROM AdminCases WHERE CaseID IN (SELECT CaseID FROM ranked WHERE rn > 1);
GO

-- ═══ خطوة 3: تأكيد النتيجة النهائية (المفروض يبقى 338 بالظبط) ═══
PRINT N'── العدد النهائي بعد التنظيف (المفروض 338) ──';
SELECT COUNT(*) AS TotalCasesAfterCleanup FROM AdminCases;
GO

PRINT N'── تأكيد: مفيش أي كود متكرر تاني ──';
SELECT CaseCode, COUNT(*) AS TimesRepeated
FROM AdminCases WHERE CaseCode IS NOT NULL
GROUP BY CaseCode HAVING COUNT(*) > 1;
GO
