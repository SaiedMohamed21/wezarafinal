-- ══════════════════════════════════════════════════════════════════
-- سكريبت اطمئنان 39: معاينة فقط (SELECT) - مفيش أي تعديل على القاعدة
-- الهدف: نتأكد إن بيانات التصفية والصافي محفوظة صح في القاعدة نفسها،
-- بعيدًا تمامًا عن أي مشكلة عرض في الموقع.
-- ══════════════════════════════════════════════════════════════════
USE NGO_System;
GO

-- (1) كام ترخيص "متصفي" ومسجل له سنة تصفية دلوقتي، وإجمالي الصافي بتاعهم
SELECT
  f.LiquidationYear,
  COUNT(*)                AS EdadElTaraakhees,
  SUM(f.Revenue)          AS EgmaliElHasela,
  SUM(f.Expenses)         AS EgmaliElMasroufat,
  SUM(f.NetAmount)        AS EgmaliElSafi
FROM FundraisingLicenses f
WHERE ISNULL(f.IsDeleted,0) = 0
  AND f.LicenseStatus = N'متصفي'
GROUP BY f.LiquidationYear
ORDER BY f.LiquidationYear;
GO

-- (2) عينة من 10 تراخيص سنة 2025 اتصفت فعليًا - عشان تتأكدي بعينك إن الصافي مسجل صح
SELECT TOP 10
  f.LicID, o.OrgName, f.LicenseNumber, f.IssueYear,
  f.StartDate, f.EndDate,
  f.LiquidationDate, f.LiquidationMonth, f.LiquidationYear,
  f.Revenue, f.Expenses, f.NetAmount
FROM FundraisingLicenses f
JOIN Organizations o ON f.OrgID = o.OrgID
WHERE ISNULL(f.IsDeleted,0) = 0
  AND f.IssueYear = 2025
  AND f.LiquidationDate IS NOT NULL
ORDER BY f.LiquidationDate;
GO
