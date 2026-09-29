USE NGO_System;
GO

-- توزيع تاريخ التصفية الفعلي (بعد الاسترجاع) حسب السنة - لكل التراخيص
-- بغض النظر عن سنة إصدارها، عشان نتأكد سنة 2025 فعلاً معندهاش تصفيات
-- واقعة جواها، ولا فيه مشكلة تانية.
SELECT
  YEAR(LiquidationDate) AS LiquidationYearActual,
  COUNT(*) AS Count,
  SUM(ISNULL(NetAmount,0)) AS TotalNet
FROM FundraisingLicenses
WHERE ISNULL(IsDeleted,0) = 0
  AND LiquidationDate IS NOT NULL
GROUP BY YEAR(LiquidationDate)
ORDER BY LiquidationYearActual;
GO

-- تحديدًا: هل فيه أي رخصة صادرة سنة 2025 (IssueYear=2025) وتصفيتها
-- الفعلية وقعت هي كمان في نفس سنة 2025؟
SELECT COUNT(*) AS LicensesIssued2025_LiquidatedSameYear2025
FROM FundraisingLicenses
WHERE ISNULL(IsDeleted,0) = 0
  AND IssueYear = 2025
  AND LiquidationDate IS NOT NULL
  AND YEAR(LiquidationDate) = 2025;
GO
