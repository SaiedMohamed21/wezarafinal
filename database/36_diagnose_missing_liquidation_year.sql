-- ══════════════════════════════════════════════════════════════════
-- تشخيص 36: التراخيص اللي حالتها "متصفي" (نصيًا) لكن من غير تاريخ
-- تصفية فعلي مسجَّل (LiquidationDate/Month/Year = NULL).
-- ده سبب مختلف تمامًا عن باج الصافي (ترقية 35) - الترخيص هنا مش
-- بيظهر بقيمة صافي غلط، هو مش بيظهر في تقرير أي سنة خالص، لأن مفيش
-- سنة تصفية مسجَّلة له يتفلتر عليها.
--
-- الاسكريبت ده معاينة فقط (SELECT) - مفيش أي تعديل على القاعدة.
-- شغّليه وابعتيلي الناتج (أو عدد الصفوف بس) قبل ما نقرر إزاي نصلح.
-- ══════════════════════════════════════════════════════════════════
USE NGO_System;
GO

SELECT
  f.LicID, o.OrgName, f.LicenseNumber, f.IssueYear,
  f.LicenseStatus,                 -- الحالة النصية (متصفي..إلخ)
  f.StartDate, f.EndDate,          -- فترة الترخيص
  f.LiquidationDate,               -- تاريخ التصفية الفعلي - المتوقع يكون فاضي هنا
  f.LiquidationMonth, f.LiquidationYear,
  f.Revenue, f.Expenses, f.NetAmount
FROM FundraisingLicenses f
JOIN Organizations o ON f.OrgID = o.OrgID
WHERE ISNULL(f.IsDeleted,0) = 0
  AND f.LicenseStatus = N'متصفي'
  AND f.LiquidationYear IS NULL
ORDER BY f.EndDate;
GO

-- عدد سريع بس لو عايزة رقم إجمالي الأول
SELECT COUNT(*) AS LicensesMarkedLiquidatedWithoutYear
FROM FundraisingLicenses f
WHERE ISNULL(f.IsDeleted,0) = 0
  AND f.LicenseStatus = N'متصفي'
  AND f.LiquidationYear IS NULL;
GO
