-- ══════════════════════════════════════════════════════════════════
-- استعلام تشخيصي فقط (قراءة بحتة - آمن 100%، مش بيغيّر ولا يحذف أي حاجة)
-- نسخة مصححة (المشكلة كانت إن "RowCount" كلمة محجوزة في SQL Server)
-- ══════════════════════════════════════════════════════════════════
USE NGO_System;
GO

PRINT N'── إجمالي عدد الصفوف في كل جدول ──';
SELECT 'AdminCases' AS TableName, COUNT(*) AS TotalRows FROM AdminCases
UNION ALL
SELECT 'AdminCompanies', COUNT(*) FROM AdminCompanies;
GO

PRINT N'── تفاصيل الأكواد المكررة كاملة (كل سطر من كل حالة مكررة، مرتبة بجانب بعض) ──';
SELECT CaseID, CaseCode, CaseName, DecisionNumber, DecisionDate, DecisionText, CreatedAt
FROM AdminCases
WHERE CaseCode IN (
  SELECT CaseCode FROM AdminCases WHERE CaseCode IS NOT NULL GROUP BY CaseCode HAVING COUNT(*) > 1
)
ORDER BY CaseCode, CaseID;
GO
