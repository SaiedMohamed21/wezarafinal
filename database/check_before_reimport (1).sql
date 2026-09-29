-- ══════════════════════════════════════════════════════════════════
-- استعلام تشخيصي فقط (قراءة بحتة - آمن 100%، مش بيغيّر ولا يحذف أي حاجة)
-- الهدف: نعرف إيه اللي فعلاً موجود في الجدولين قبل ما نقرر أي خطوة تالية
-- ══════════════════════════════════════════════════════════════════
USE NGO_System;
GO

PRINT N'── إجمالي عدد الصفوف في كل جدول ──';
SELECT 'AdminCases' AS TableName, COUNT(*) AS RowCount FROM AdminCases
UNION ALL
SELECT 'AdminCompanies', COUNT(*) FROM AdminCompanies;
GO

PRINT N'── هل في أكواد حالات مكررة (نفس الكود ليه أكتر من سطر)؟ ──';
SELECT CaseCode, COUNT(*) AS TimesRepeated
FROM AdminCases
WHERE CaseCode IS NOT NULL
GROUP BY CaseCode
HAVING COUNT(*) > 1
ORDER BY TimesRepeated DESC;
GO

PRINT N'── عيّنة من أول 5 حالات مسجَّلة (نتأكد شكل البيانات) ──';
SELECT TOP 5 CaseID, CaseCode, CaseName, DecisionNumber, DecisionDate, CreatedAt
FROM AdminCases ORDER BY CaseID;
GO
