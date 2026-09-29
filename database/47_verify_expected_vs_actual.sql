USE NGO_System;
GO

SELECT
  o.OrgName, fl.LicenseNumber, fl.IssueYear,
  fl.EndDate, fl.Deadline60,
  fl.LiquidationDate, YEAR(fl.LiquidationDate) AS LiquidationYearActual,
  fl.Revenue, fl.Expenses, fl.NetAmount
FROM FundraisingLicenses fl
JOIN Organizations o ON o.OrgID = fl.OrgID
WHERE ISNULL(fl.IsDeleted,0) = 0
  AND fl.IssueYear = 2025
  AND fl.LicenseNumber IN (122,123,162,163)
ORDER BY fl.LicenseNumber;
GO
